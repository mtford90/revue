import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Chapter,
	type KeyChange,
	type RevueChaptersFile,
	RevueChaptersFileSchema,
} from "@revue/types";
import { loadPreparedRun, type PreparedRun } from "../src/artifact.ts";
import { freezeRunContext, loadRunContext } from "../src/context.ts";
import { validateReviewCoverage } from "../src/coverage.ts";
import { loadRunDelta } from "../src/delta.ts";
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

const commit = async (root: string, message: string): Promise<void> => {
	await git(root, "add", "-A");
	await git(root, "commit", "-m", message);
};

const numbered = (prefix: string, count: number): string =>
	`${Array.from({ length: count }, (_, index) => `${prefix} line ${index + 1}`).join("\n")}\n`;

const replaceLine = (content: string, line: number, text: string): string => {
	const lines = content.split("\n");
	lines[line - 1] = text;
	return lines.join("\n");
};

const repository = async (files: Record<string, string>): Promise<string> => {
	const root = await mkdtemp(join(tmpdir(), "revue-delta-"));
	repositories.push(root);
	await git(root, "init", "-b", "main");
	await git(root, "config", "user.email", "revue@example.com");
	await git(root, "config", "user.name", "Revue Test");
	for (const [path, content] of Object.entries(files)) await write(root, path, content);
	await commit(root, "Baseline");
	await git(root, "checkout", "-b", "feature");
	return root;
};

const chapter = (overrides: Partial<Chapter> & Pick<Chapter, "id" | "order">): Chapter => ({
	title: `Chapter ${overrides.id}`,
	summary: "What this beat of the change does.",
	hunkRefs: [],
	keyChanges: [],
	excerpts: [],
	...overrides,
});

/** Stands in for the revue skill: narrate the run, then pin the code the narration quotes. */
const narrate = async (run: PreparedRun, chapters: Chapter[]): Promise<RevueChaptersFile> => {
	const file = RevueChaptersFileSchema.parse({ chapters });
	await writeFile(join(run.directory, "chapters.json"), `${JSON.stringify(file, null, 2)}\n`);
	await freezeRunContext(run, file);
	return file;
};

test("a localized fix carries the untouched chapters and asks only for what it changed", async () => {
	const root = await repository({
		"src/alpha.ts": numbered("alpha", 20),
		"src/beta.ts": numbered("beta", 20),
		"src/caller.ts": numbered("caller", 10),
	});
	await write(root, "src/alpha.ts", replaceLine(numbered("alpha", 20), 5, "alpha line five"));
	await write(root, "src/beta.ts", replaceLine(numbered("beta", 20), 5, "beta line five"));
	await commit(root, "Feature work");
	const first = await prepareRun(["main", "HEAD"], root);
	const alpha = chapter({
		id: "alpha",
		order: 1,
		hunkRefs: [{ filePath: "src/alpha.ts", oldStart: 2 }],
		keyChanges: [
			{
				content: "Is the renamed line still the one callers expect?",
				severity: "info",
				lineRefs: [{ filePath: "src/alpha.ts", side: "additions", startLine: 5, endLine: 5 }],
			},
		],
		excerpts: [{ filePath: "src/caller.ts", startLine: 3, endLine: 5 }],
	});
	const beta = chapter({
		id: "beta",
		order: 2,
		hunkRefs: [{ filePath: "src/beta.ts", oldStart: 2 }],
	});
	await narrate(first, [alpha, beta]);

	await write(root, "src/beta.ts", replaceLine(numbered("beta", 20), 5, "beta line 5, fixed"));
	await commit(root, "Address the review");
	const second = await prepareRun(["main", "HEAD"], root);
	const delta = await loadRunDelta(second);

	expect(second.manifest.supersedes).toBe(first.manifest.runId);
	// A chapter the change did not touch survives with everything it said about the code intact.
	expect(delta?.carried).toEqual([alpha]);
	expect(delta?.stale).toEqual([
		{ id: "beta", title: "Chapter beta", reasons: ['review unit "src/beta.ts"@2 changed'] },
	]);
	expect(delta?.unnarrated).toEqual([{ filePath: "src/beta.ts", oldStart: 2, status: "modified" }]);
	// Prep pre-copies narration without claiming to have narrated: the run is still chapterless.
	expect(existsSync(join(second.directory, "chapters.json"))).toBe(false);

	// The carried citation was re-frozen against the new run and still quotes the same bytes.
	const before = await loadRunContext(first);
	const after = await loadRunContext(second);
	expect(after?.runId).toBe(second.manifest.runId);
	expect(after?.excerpts.map((excerpt) => excerpt.lines)).toEqual([
		["caller line 3", "caller line 4", "caller line 5"],
	]);
	expect(after?.excerpts.map((excerpt) => excerpt.lines)).toEqual(
		before?.excerpts.map((excerpt) => excerpt.lines) ?? [],
	);

	// The agent completes the run by re-narrating what the delta asked for, and nothing else.
	const completed = RevueChaptersFileSchema.parse({
		chapters: [
			...(delta?.carried ?? []),
			chapter({ id: "beta-2", order: 2, hunkRefs: [{ filePath: "src/beta.ts", oldStart: 2 }] }),
		],
	});
	validateReviewCoverage(await loadPreparedRun(second.directory), completed, after);
});

test("a hunk whose lines moved beneath it is still the same hunk", async () => {
	const root = await repository({ "src/app.ts": numbered("app", 30) });
	await write(root, "src/app.ts", replaceLine(numbered("app", 30), 25, "app line twenty-five"));
	await commit(root, "Feature work");
	const first = await prepareRun(["main", "HEAD"], root);
	const question: KeyChange = {
		content: "Does the reworded line still read correctly?",
		severity: "info",
		lineRefs: [{ filePath: "src/app.ts", side: "additions", startLine: 25, endLine: 25 }],
	};
	const moved = chapter({
		id: "moved",
		order: 1,
		hunkRefs: [{ filePath: "src/app.ts", oldStart: 22 }],
		keyChanges: [question],
	});
	await narrate(first, [moved]);

	// Main grows a prelude the feature branch rebases onto, so every pre-image line shifts down.
	await git(root, "checkout", "main");
	await write(root, "src/app.ts", `${numbered("prelude", 5)}${numbered("app", 30)}`);
	await commit(root, "Add a prelude");
	await git(root, "checkout", "feature");
	await git(root, "rebase", "main");
	const second = await prepareRun(["main", "HEAD"], root);
	const delta = await loadRunDelta(second);

	expect(second.manifest.files.map((file) => file.referenceStarts)).toEqual([[27]]);
	expect(delta?.stale).toEqual([]);
	expect(delta?.unnarrated).toEqual([]);
	expect(delta?.carried).toEqual([
		{
			...moved,
			hunkRefs: [{ filePath: "src/app.ts", oldStart: 27 }],
			keyChanges: [
				{
					...question,
					lineRefs: [{ filePath: "src/app.ts", side: "additions", startLine: 30, endLine: 30 }],
				},
			],
		},
	]);
	validateReviewCoverage(
		await loadPreparedRun(second.directory),
		RevueChaptersFileSchema.parse({ chapters: delta?.carried ?? [] }),
		null,
	);
});

test("a chapter loses its code when the change reverts it, and new code arrives unnarrated", async () => {
	const root = await repository({
		"src/alpha.ts": numbered("alpha", 20),
		"src/gamma.ts": numbered("gamma", 20),
	});
	await write(root, "src/alpha.ts", replaceLine(numbered("alpha", 20), 5, "alpha line five"));
	await write(root, "src/gamma.ts", replaceLine(numbered("gamma", 20), 5, "gamma line five"));
	await commit(root, "Feature work");
	const first = await prepareRun(["main", "HEAD"], root);
	const alpha = chapter({
		id: "alpha",
		order: 1,
		hunkRefs: [{ filePath: "src/alpha.ts", oldStart: 2 }],
	});
	const gamma = chapter({
		id: "gamma",
		order: 2,
		hunkRefs: [{ filePath: "src/gamma.ts", oldStart: 2 }],
	});
	await narrate(first, [alpha, gamma]);

	await write(root, "src/gamma.ts", numbered("gamma", 20));
	await write(root, "src/delta.ts", numbered("delta", 3));
	await commit(root, "Drop the gamma change and add a helper");
	const second = await prepareRun(["main", "HEAD"], root);
	const delta = await loadRunDelta(second);

	expect(delta?.carried).toEqual([alpha]);
	expect(delta?.stale).toEqual([
		{
			id: "gamma",
			title: "Chapter gamma",
			reasons: ['review unit "src/gamma.ts"@2 is no longer part of this run'],
		},
	]);
	expect(delta?.unnarrated).toEqual([{ filePath: "src/delta.ts", oldStart: 0, status: "new" }]);
});

test("a chapter goes stale when its quoted code no longer sits where it cited it", async () => {
	const root = await repository({
		"src/alpha.ts": numbered("alpha", 20),
		"src/caller.ts": numbered("caller", 10),
	});
	await write(root, "src/alpha.ts", replaceLine(numbered("alpha", 20), 5, "alpha line five"));
	await commit(root, "Feature work");
	const first = await prepareRun(["main", "HEAD"], root);
	const quoting = chapter({
		id: "quoting",
		order: 1,
		hunkRefs: [{ filePath: "src/alpha.ts", oldStart: 2 }],
		excerpts: [{ filePath: "src/caller.ts", startLine: 3, endLine: 5 }],
	});
	await narrate(first, [quoting]);

	await write(root, "src/caller.ts", `${numbered("preamble", 2)}${numbered("caller", 10)}`);
	await commit(root, "Give the caller a preamble");
	const second = await prepareRun(["main", "HEAD"], root);
	const delta = await loadRunDelta(second);

	expect(delta?.carried).toEqual([]);
	expect(delta?.stale).toEqual([
		{
			id: "quoting",
			title: "Chapter quoting",
			reasons: ['excerpt "src/caller.ts" 3-5 now quotes different code'],
		},
	]);
	// Its own hunk survived the change, so it comes back as work rather than disappearing.
	expect(delta?.unnarrated).toEqual([
		{ filePath: "src/alpha.ts", oldStart: 2, status: "unchanged" },
		{ filePath: "src/caller.ts", oldStart: 1, status: "new" },
	]);
	expect(await loadRunContext(second)).toBeNull();
});
