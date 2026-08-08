import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	type ContextExcerpt,
	RevueChaptersFileSchema,
	RUN_ENDPOINT_KIND,
	type RunContextFile,
} from "@revue/types";
import { digest, loadPreparedRun, type PreparedRun } from "../src/artifact.ts";
import { freezeRunContext, loadRunContext, runContextPath } from "../src/context.ts";
import { prepareRun } from "../src/prep.ts";

const repositories: string[] = [];
afterEach(async () => {
	await Promise.all(
		repositories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

const git = async (root: string, ...args: string[]): Promise<string> => {
	const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
	return stdout.trim();
};

const write = async (root: string, path: string, content: string): Promise<void> => {
	await mkdir(join(root, path, ".."), { recursive: true });
	await writeFile(join(root, path), content);
};

const numbered = (prefix: string, count: number): string =>
	`${Array.from({ length: count }, (_, index) => `${prefix} line ${index + 1}`).join("\n")}\n`;

/** A repository whose `src/caller.ts` is never touched by any change under review. */
const repository = async (): Promise<string> => {
	const root = await mkdtemp(join(tmpdir(), "revue-freeze-"));
	repositories.push(root);
	await git(root, "init", "-b", "main");
	await git(root, "config", "user.email", "revue@example.com");
	await git(root, "config", "user.name", "Revue Test");
	await write(root, "src/value.ts", numbered("value", 6));
	await write(root, "src/caller.ts", numbered("caller", 8));
	await git(root, "add", "-A");
	await git(root, "commit", "-m", "Baseline");
	return root;
};

const narration = (excerpts: ContextExcerpt[]) =>
	RevueChaptersFileSchema.parse({
		chapters: [
			{
				id: "chapter-1",
				order: 1,
				title: "Change the value",
				summary: "The value now reflects the new behaviour.",
				hunkRefs: [],
				keyChanges: [],
				excerpts,
			},
		],
		depth: { kind: "partial", label: "10,000ft" },
	});

const artifactBytes = async (run: PreparedRun): Promise<Record<string, string>> =>
	Object.fromEntries(
		await Promise.all(
			["run.json", "diff.patch", "hunks.txt"].map(async (name) => [
				name,
				digest(await readFile(join(run.directory, name), "utf8")),
			]),
		),
	);

test("freezing pins cited code, including from a file no change touched", async () => {
	const root = await repository();
	await git(root, "checkout", "-b", "feature");
	await write(root, "src/value.ts", numbered("value", 6).replace("value line 2", "value line two"));
	await git(root, "add", "-A");
	await git(root, "commit", "-m", "Change the value");
	const run = await prepareRun(["main", "HEAD"], root);
	const before = await artifactBytes(run);

	const result = await freezeRunContext(
		run,
		narration([
			{ filePath: "src/caller.ts", startLine: 3, endLine: 5, caption: "the caller it satisfies" },
			{ filePath: "src/value.ts", startLine: 1, endLine: 2 },
		]),
	);

	expect(result.unverifiable).toEqual([]);
	expect(result.context.unresolved).toEqual([]);
	expect(result.context.source).toEqual({
		kind: RUN_ENDPOINT_KIND.COMMIT,
		revision: run.manifest.scope.newEndpoint.revision,
	});
	expect(result.context.excerpts.map((excerpt) => excerpt.lines)).toEqual([
		["caller line 3", "caller line 4", "caller line 5"],
		["value line 1", "value line two"],
	]);
	// Provenance: the digest names the exact file version, and matches the run's pinned new blob
	// for a file the run does contain.
	const valueExcerpt = result.context.excerpts.at(1);
	expect(valueExcerpt?.fileSha256).toBe(
		run.manifest.files.find((file) => file.path === "src/value.ts")?.newBlob ?? "",
	);
	expect(result.context.runId).toBe(run.manifest.runId);

	// Narration-side: the prepared input the run ID hashes is untouched, so the run is still itself.
	const reloaded = await loadPreparedRun(run.directory);
	expect(reloaded.manifest.runId).toBe(run.manifest.runId);
	expect(await artifactBytes(reloaded)).toEqual(before);
	expect(await loadRunContext(reloaded)).toEqual(result.context);
});

test("freezing the same run twice writes the same bytes", async () => {
	const root = await repository();
	await git(root, "checkout", "-b", "feature");
	await write(root, "src/value.ts", numbered("changed", 6));
	await git(root, "add", "-A");
	await git(root, "commit", "-m", "Change the value");
	const run = await prepareRun(["main", "HEAD"], root);
	const cited = narration([
		{ filePath: "src/value.ts", startLine: 2, endLine: 3 },
		{ filePath: "src/caller.ts", startLine: 1, endLine: 1 },
	]);

	await freezeRunContext(run, cited);
	const first = await readFile(runContextPath(run.directory), "utf8");
	await freezeRunContext(run, cited);

	expect(await readFile(runContextPath(run.directory), "utf8")).toBe(first);
});

test("a worktree run refuses to freeze a cited file that moved after prep captured it", async () => {
	const root = await repository();
	await write(root, "src/value.ts", numbered("working", 6));
	const run = await prepareRun(["--ref", "work", "--base", "main"], root);
	expect(run.manifest.scope.newEndpoint.kind).toBe(RUN_ENDPOINT_KIND.WORKTREE);

	await write(root, "src/value.ts", numbered("moved on", 6));

	expect(
		freezeRunContext(run, narration([{ filePath: "src/value.ts", startLine: 1, endLine: 2 }])),
	).rejects.toThrow(
		"The worktree file src/value.ts changed after revue prep captured this run; prep a new run before freezing its context",
	);
	expect(await loadRunContext(run)).toBeNull();
});

test("a worktree run reports that it cannot check drift for a file it never captured", async () => {
	const root = await repository();
	await write(root, "src/value.ts", numbered("working", 6));
	const run = await prepareRun(["--ref", "work", "--base", "main"], root);

	const result = await freezeRunContext(
		run,
		narration([{ filePath: "src/caller.ts", startLine: 2, endLine: 3 }]),
	);

	expect(result.unverifiable).toEqual(["src/caller.ts"]);
	expect(result.context.excerpts.at(0)?.lines).toEqual(["caller line 2", "caller line 3"]);
});

test("a citation nothing can be read for is recorded rather than pinned", async () => {
	const root = await repository();
	await git(root, "checkout", "-b", "feature");
	await write(root, "src/value.ts", numbered("changed", 6));
	await git(root, "add", "-A");
	await git(root, "commit", "-m", "Change the value");
	const run = await prepareRun(["main", "HEAD"], root);

	const result = await freezeRunContext(
		run,
		narration([
			{ filePath: "src/ghost.ts", startLine: 1, endLine: 2 },
			{ filePath: "src/value.ts", startLine: 5, endLine: 9 },
		]),
	);

	expect(result.context.excerpts).toEqual([]);
	expect(result.context.unresolved).toEqual([
		{
			filePath: "src/ghost.ts",
			startLine: 1,
			endLine: 2,
			reason: "the run's endpoint has no file at that path",
		},
		{ filePath: "src/value.ts", startLine: 5, endLine: 9, reason: "the file has 6 lines" },
	]);
});

test("a citation that climbs out of the repository quotes nothing", async () => {
	const root = await repository();
	await write(root, "src/value.ts", numbered("working", 6));
	// A secret the repository does not contain and narration must never be able to quote.
	await writeFile(join(dirname(root), "outside.env"), "SECRET_TOKEN=hunter2\nAWS_KEY=abcd\n");
	const run = await prepareRun(["--ref", "work", "--base", "main"], root);

	const result = await freezeRunContext(
		run,
		narration([
			{ filePath: "../outside.env", startLine: 1, endLine: 2 },
			{ filePath: join(dirname(root), "outside.env"), startLine: 1, endLine: 2 },
		]),
	);

	// The chapters file is agent-written, so a path is not a licence to read the machine.
	expect(result.context.excerpts).toEqual([]);
	expect(result.context.unresolved.map((entry) => entry.reason)).toEqual([
		"the path is outside the repository",
		"the path is outside the repository",
	]);
	expect(JSON.stringify(result.context)).not.toContain("hunter2");
});

test("frozen context belonging to another run is rejected", async () => {
	const root = await repository();
	await git(root, "checkout", "-b", "feature");
	await write(root, "src/value.ts", numbered("changed", 6));
	await git(root, "add", "-A");
	await git(root, "commit", "-m", "Change the value");
	const run = await prepareRun(["main", "HEAD"], root);
	const foreign: RunContextFile = {
		runId: "0".repeat(64),
		source: { kind: RUN_ENDPOINT_KIND.COMMIT, revision: "f".repeat(40) },
		excerpts: [],
		unresolved: [],
	};
	await writeFile(runContextPath(run.directory), JSON.stringify(foreign), "utf8");

	expect(loadRunContext(run)).rejects.toThrow("was frozen for a different run");
});
