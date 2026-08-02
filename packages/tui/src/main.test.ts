import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	RevueChaptersFileSchema,
	runManifestSchema,
	viewStateFileId,
	viewStateKeyChangeId,
} from "@revue/types";
import { openCommentStore } from "./comments.ts";
import { runKey } from "./viewState.ts";

const mainPath = resolve(import.meta.dir, "main.tsx");
const sampleRun = resolve(import.meta.dir, "../../../examples/sample-run");

const run = async (cwd: string, args: string[]) => {
	const child = Bun.spawn(["bun", mainPath, ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
};

const git = async (cwd: string, ...args: string[]): Promise<void> => {
	const child = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "pipe" });
	const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
	if (exitCode !== 0) throw new Error(stderr);
};

const copySampleRun = async (root: string): Promise<string> => {
	const directory = join(root, "sample-run");
	await mkdir(join(root, ".git"));
	await cp(sampleRun, directory, { recursive: true });
	return directory;
};

test("comment CLI lists and mutates verified-run feedback with stable JSON", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-comments-cli-"));
	try {
		const reviewRun = await copySampleRun(root);
		const manifest = runManifestSchema.parse(await Bun.file(join(reviewRun, "run.json")).json());
		const store = openCommentStore(join(root, ".revue", "comments.json"), manifest.runId);
		const comment = store.add(
			{
				filePath: "src/lib/backoff.ts",
				oldStart: 0,
				side: "additions",
				startLine: 4,
				endLine: 6,
			},
			"Use a lower retry cap\nfor interactive requests.",
			{
				id: "00000000-0000-4000-8000-000000000001",
				createdAt: "2026-08-02T10:00:00.000Z",
			},
		);

		const listed = await run(root, ["comments", "list", reviewRun, "--json"]);
		expect(listed).toMatchObject({ exitCode: 0, stderr: "" });
		expect(JSON.parse(listed.stdout)).toEqual({ runId: manifest.runId, comments: [comment] });
		const exported = await run(root, ["export", reviewRun, "--chapter-id", "chapter-1"]);
		expect(exported).toMatchObject({ exitCode: 0, stderr: "" });
		expect(exported.stdout).toContain(`Comment \`${comment.id}\``);
		expect(exported.stdout).toContain("> Use a lower retry cap\n> for interactive requests.");

		const dealt = await run(root, ["comments", "mark-dealt", reviewRun, comment.id]);
		expect(dealt).toMatchObject({ exitCode: 0, stderr: "" });
		expect(JSON.parse(dealt.stdout)).toMatchObject({
			action: "mark-dealt",
			comment: { id: comment.id, status: "dealt-with" },
		});
		const openOnly = await run(root, ["comments", "list", reviewRun, "--json"]);
		expect(JSON.parse(openOnly.stdout).comments).toEqual([]);
		const all = await run(root, ["comments", "list", reviewRun, "--json", "--all"]);
		expect(JSON.parse(all.stdout).comments).toHaveLength(1);

		const reopened = await run(root, ["comments", "reopen", reviewRun, comment.id]);
		expect(JSON.parse(reopened.stdout).comment.status).toBe("open");
		const missing = await run(root, [
			"comments",
			"delete",
			reviewRun,
			"00000000-0000-4000-8000-000000000099",
		]);
		expect(missing).toMatchObject({ exitCode: 1, stdout: "" });
		expect(missing.stderr).toContain("does not exist in this run");
		const malformed = await run(root, ["comments", "delete", reviewRun, "not-an-id"]);
		expect(malformed).toMatchObject({ exitCode: 1, stdout: "" });
		expect(malformed.stderr).toContain("Comment ID must be a UUID");

		const deleted = await run(root, ["comments", "delete", reviewRun, comment.id]);
		expect(JSON.parse(deleted.stdout)).toMatchObject({
			action: "delete",
			comment: { id: comment.id },
		});
		expect(
			JSON.parse((await run(root, ["comments", "list", reviewRun, "--json", "--all"])).stdout)
				.comments,
		).toEqual([]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("comment operations reject stale anchors against the verified pinned patch", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-comments-stale-"));
	try {
		const reviewRun = await copySampleRun(root);
		const manifest = runManifestSchema.parse(await Bun.file(join(reviewRun, "run.json")).json());
		openCommentStore(join(root, ".revue", "comments.json"), manifest.runId).add(
			{
				filePath: "src/lib/backoff.ts",
				oldStart: 0,
				side: "additions",
				startLine: 999,
				endLine: 999,
			},
			"Stale feedback",
		);
		const result = await run(root, ["comments", "list", reviewRun, "--json"]);
		expect(result).toMatchObject({ exitCode: 1, stdout: "" });
		expect(result.stderr).toContain("corrupt or stale anchor");
		expect(result.stderr).toContain("outside that review unit");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("export selects chapters unambiguously and preserves read-only review state", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-export-cli-"));
	try {
		const reviewRun = await copySampleRun(root);
		const withoutState = await run(root, ["export", reviewRun, "--chapter-id", "chapter-2"]);
		expect(withoutState).toMatchObject({ exitCode: 0, stderr: "" });
		expect(withoutState.stdout).toContain(
			"# Chapter 2: Retry transient failures in the API client",
		);
		expect(withoutState.stdout).toContain("- [ ] Chapter reviewed");
		expect(withoutState.stdout).toContain(
			"- [ ] `src/lib/apiClient.ts` — status: modified; file total: +9 / -1",
		);
		expect(withoutState.stdout).not.toContain("Add a reusable backoff helper");
		expect(await Bun.file(join(root, ".revue", "state.json")).exists()).toBe(false);

		const manifest = runManifestSchema.parse(await Bun.file(join(reviewRun, "run.json")).json());
		const chapters = RevueChaptersFileSchema.parse(
			await Bun.file(join(reviewRun, "chapters.json")).json(),
		);
		const key = runKey(manifest.runId, chapters);
		const statePath = join(root, ".revue", "state.json");
		const stateContents = `${JSON.stringify({
			[key]: {
				chapters: ["chapter-2"],
				files: [viewStateFileId("chapter-2", "src/lib/apiClient.ts")],
				keyChanges: [viewStateKeyChangeId("chapter-2", 0)],
			},
		})}\n`;
		await mkdir(join(root, ".revue"));
		await writeFile(statePath, stateContents);
		const output = join(root, "chapter.md");
		const toFile = await run(root, [
			"export",
			reviewRun,
			"--chapter-order",
			"2",
			"--output",
			output,
		]);
		expect(toFile).toMatchObject({
			exitCode: 0,
			stdout: "",
			stderr: `Wrote Markdown export to ${output}\n`,
		});
		const markdown = await Bun.file(output).text();
		expect(markdown).toContain("- [x] Chapter reviewed");
		expect(markdown).toContain("- [x] `src/lib/apiClient.ts`");
		expect(markdown).toContain("1. [x] Should retries be capped per-request");
		expect(await Bun.file(statePath).text()).toBe(stateContents);

		const ambiguous = await run(root, [
			"export",
			reviewRun,
			"--chapter-id",
			"chapter-2",
			"--chapter-order",
			"2",
		]);
		expect(ambiguous).toMatchObject({ exitCode: 1, stdout: "" });
		expect(ambiguous.stderr).toContain("choose only one of");

		const missingOutput = await run(root, ["export", reviewRun, "--output", "--prologue"]);
		expect(missingOutput).toMatchObject({ exitCode: 1, stdout: "" });
		expect(missingOutput.stderr).toContain("--output requires a path");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("prep composes persistent and session ignore controls without mutating the file", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-cli-ignore-"));
	try {
		await git(root, "init", "-b", "main");
		await git(root, "config", "user.email", "revue@example.com");
		await git(root, "config", "user.name", "Revue Test");
		await mkdir(join(root, "fixtures"));
		await mkdir(join(root, "src"));
		const persistentRules = "# review fixtures separately\nfixtures/**\n";
		await writeFile(join(root, ".revueignore"), persistentRules);
		await writeFile(join(root, "fixtures", "value.ts"), "before\n");
		await writeFile(join(root, "src", "value.generated.ts"), "before\n");
		await writeFile(join(root, "src", "value.ts"), "before\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Baseline");
		await git(root, "checkout", "-b", "feature");
		await writeFile(join(root, "fixtures", "value.ts"), "after\n");
		await writeFile(join(root, "src", "value.generated.ts"), "after\n");
		await writeFile(join(root, "src", "value.ts"), "after\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Change values");

		const prepared = await run(root, [
			"prep",
			"main",
			"HEAD",
			"--ignore",
			"*.generated.ts",
			"--show-ignored",
		]);
		const runDirectory = prepared.stdout.trim();

		expect(prepared.exitCode).toBe(0);
		expect(prepared.stderr).toContain("1 files, 1 review units, +1 -1, 2 omitted");
		expect(prepared.stderr).toContain(
			'Effective review ignore patterns (.revueignore, then --ignore):\n  .revueignore "fixtures/**"\n  --ignore     "*.generated.ts"',
		);
		expect(prepared.stderr).toContain(
			'Omitted paths:\n  "fixtures/value.ts": .revueignore "fixtures/**"\n  "src/value.generated.ts": --ignore "*.generated.ts"',
		);
		const manifest = runManifestSchema.parse(await Bun.file(join(runDirectory, "run.json")).json());
		expect(manifest.ignore).toEqual({
			revueIgnore: ["fixtures/**"],
			session: ["*.generated.ts"],
		});
		expect(manifest.exclusions.map(({ reason }) => reason)).toEqual([
			"revueignore",
			"session-ignore",
		]);
		expect(await Bun.file(join(root, ".revueignore")).text()).toBe(persistentRules);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("prep prints only the run path and show validates that same run", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-cli-"));
	try {
		await git(root, "init", "-b", "main");
		await git(root, "config", "user.email", "revue@example.com");
		await git(root, "config", "user.name", "Revue Test");
		await mkdir(join(root, "src"));
		await writeFile(join(root, "src", "value.ts"), "export const value = 1;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Baseline");
		await git(root, "checkout", "-b", "feature");
		await writeFile(join(root, "src", "value.ts"), "export const value = 2;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Change value");

		const prepared = await run(root, ["prep", "main", "HEAD"]);
		const runDirectory = prepared.stdout.trim();
		expect(prepared.exitCode).toBe(0);
		expect(prepared.stdout).toBe(`${runDirectory}\n`);
		expect(prepared.stderr).toContain("Prepared committed run");
		const manifest = runManifestSchema.parse(await Bun.file(join(runDirectory, "run.json")).json());
		const reference = manifest.files[0];
		const oldStart = reference?.referenceStarts[0];
		if (!reference || oldStart === undefined) throw new Error("Expected a prepared review unit");
		const chaptersPath = join(runDirectory, "chapters.json");
		const chapters = {
			chapters: [
				{
					id: "chapter-1",
					order: 1,
					title: "Change the value",
					summary: "The value now reflects the new behaviour.",
					hunkRefs: [{ filePath: reference.path, oldStart }],
					keyChanges: [],
				},
			],
		};
		await writeFile(chaptersPath, `${JSON.stringify(chapters)}\n`);

		const checked = await run(root, ["show", runDirectory, "--check"]);
		expect(checked).toMatchObject({ exitCode: 0, stderr: "" });
		expect(checked.stdout).toContain("1 chapter:");

		const mismatchedChapters = {
			chapters: chapters.chapters.map((chapter) => ({
				...chapter,
				hunkRefs: chapter.hunkRefs.map((reference) => ({
					...reference,
					oldStart: reference.oldStart + 999,
				})),
			})),
		};
		await writeFile(chaptersPath, `${JSON.stringify(mismatchedChapters)}\n`);
		const mismatched = await run(root, ["show", runDirectory, "--check"]);
		expect(mismatched).toMatchObject({ exitCode: 1, stdout: "" });
		expect(mismatched.stderr).toContain("does not cover the prepared run");

		const mismatchedExport = await run(root, ["export", runDirectory]);
		expect(mismatchedExport).toMatchObject({ exitCode: 1, stdout: "" });
		expect(mismatchedExport.stderr).toContain("does not cover the prepared run");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
