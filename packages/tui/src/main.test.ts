import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	RevueChaptersFileSchema,
	runManifestSchema,
	THREAD_AUTHOR_KIND,
	viewStateFileId,
	viewStateKeyChangeId,
} from "@revue/types";
import { openThreadStore } from "./threads.ts";
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

test("thread CLI creates authored conversations and exposes lifecycle operations as JSON", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-threads-cli-"));
	try {
		const reviewRun = await copySampleRun(root);
		const manifest = runManifestSchema.parse(await Bun.file(join(reviewRun, "run.json")).json());
		const bodyFile = join(root, "agent-message.txt");
		await writeFile(bodyFile, "Use a lower retry cap\nfor interactive requests.");
		const created = await run(root, [
			"threads",
			"create",
			reviewRun,
			"--file",
			"src/lib/backoff.ts",
			"--old-start",
			"0",
			"--side",
			"additions",
			"--start-line",
			"4",
			"--end-line",
			"6",
			"--author",
			"Review agent",
			"--body-file",
			bodyFile,
		]);
		expect(created).toMatchObject({ exitCode: 0, stderr: "" });
		const thread = JSON.parse(created.stdout).thread;
		expect(thread.messages[0]).toMatchObject({
			author: { kind: THREAD_AUTHOR_KIND.AGENT, name: "Review agent" },
			body: "Use a lower retry cap\nfor interactive requests.",
		});

		const replied = await run(root, [
			"threads",
			"reply",
			reviewRun,
			thread.id,
			"--author",
			"Fix agent",
			"--body",
			"Adjusted in the next revision.",
		]);
		expect(replied).toMatchObject({ exitCode: 0, stderr: "" });
		const reply = JSON.parse(replied.stdout).thread.messages[1];
		expect(reply).toMatchObject({
			author: { kind: THREAD_AUTHOR_KIND.AGENT, name: "Fix agent" },
			body: "Adjusted in the next revision.",
		});

		const listed = await run(root, ["threads", "list", reviewRun, "--json"]);
		expect(listed).toMatchObject({ exitCode: 0, stderr: "" });
		expect(JSON.parse(listed.stdout)).toMatchObject({
			runId: manifest.runId,
			threads: [{ id: thread.id, messages: [{}, {}] }],
		});
		const alias = await run(root, ["comments", "list", reviewRun, "--json"]);
		expect(JSON.parse(alias.stdout).threads).toHaveLength(1);

		const dealt = await run(root, ["threads", "mark-dealt", reviewRun, thread.id]);
		expect(JSON.parse(dealt.stdout).thread.status).toBe("dealt-with");
		expect(
			JSON.parse((await run(root, ["threads", "list", reviewRun, "--json"])).stdout).threads,
		).toEqual([]);
		expect(
			JSON.parse((await run(root, ["threads", "list", reviewRun, "--json", "--all"])).stdout)
				.threads,
		).toHaveLength(1);

		const reopened = await run(root, ["threads", "reopen", reviewRun, thread.id]);
		expect(JSON.parse(reopened.stdout).thread.status).toBe("open");
		const deletedMessage = await run(root, [
			"threads",
			"delete-message",
			reviewRun,
			thread.id,
			reply.id,
		]);
		expect(JSON.parse(deletedMessage.stdout).message.id).toBe(reply.id);

		const missing = await run(root, [
			"threads",
			"delete",
			reviewRun,
			"00000000-0000-4000-8000-000000000099",
		]);
		expect(missing).toMatchObject({ exitCode: 1, stdout: "" });
		expect(missing.stderr).toContain("does not exist in this run");
		const malformed = await run(root, ["threads", "delete", reviewRun, "not-an-id"]);
		expect(malformed).toMatchObject({ exitCode: 1, stdout: "" });
		expect(malformed.stderr).toContain("Thread ID must be a UUID");

		const deleted = await run(root, ["threads", "delete", reviewRun, thread.id]);
		expect(JSON.parse(deleted.stdout).thread.id).toBe(thread.id);
		expect(
			JSON.parse((await run(root, ["threads", "list", reviewRun, "--json", "--all"])).stdout)
				.threads,
		).toEqual([]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("thread operations reject stale anchors against the verified pinned patch", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-threads-stale-"));
	try {
		const reviewRun = await copySampleRun(root);
		const manifest = runManifestSchema.parse(await Bun.file(join(reviewRun, "run.json")).json());
		openThreadStore(join(root, ".revue", "threads.json"), manifest.runId).create(
			{
				filePath: "src/lib/backoff.ts",
				oldStart: 0,
				side: "additions",
				startLine: 999,
				endLine: 999,
			},
			{ kind: THREAD_AUTHOR_KIND.AGENT, name: "Review agent" },
			"Stale feedback",
		);
		const result = await run(root, ["threads", "list", reviewRun, "--json"]);
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

test("show names its themes and refuses an unknown one before touching the run", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-theme-"));
	try {
		const directory = await copySampleRun(root);

		const listed = await run(root, ["show", directory, "--theme", "list"]);
		expect(listed.exitCode).toBe(0);
		expect(listed.stdout.trim().split("\n")).toContain("github-dark-default");

		const unknown = await run(root, ["show", directory, "--theme", "solarised-dark"]);
		expect(unknown).toMatchObject({ exitCode: 1, stdout: "" });
		expect(unknown.stderr).toContain("unknown theme: solarised-dark");

		const known = await run(root, ["show", directory, "--theme", "nord", "--check"]);
		expect(known.exitCode).toBe(0);
		expect(known.stdout).toContain("run is valid");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("skill install writes a version-stamped copy at the repository root and is idempotent", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-skill-"));
	try {
		await git(root, "init", "-b", "main");
		const nested = join(root, "packages");
		await mkdir(nested);

		const installed = await run(nested, ["skill", "install"]);
		expect(installed).toMatchObject({ exitCode: 0, stderr: "" });
		expect(installed.stdout).toContain("skill installed");

		const skillPath = join(root, ".claude", "skills", "revue-chapters", "SKILL.md");
		const contents = await Bun.file(skillPath).text();
		expect(contents).toMatch(/^---\nrevue-version: \d+\.\d+\.\d+\n/);
		expect(contents).toContain("# revue-chapters");

		const repeated = await run(nested, ["skill", "install"]);
		expect(repeated).toMatchObject({ exitCode: 0, stderr: "" });
		expect(repeated.stdout).toContain("already up to date");
		expect(await Bun.file(skillPath).text()).toBe(contents);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("doctor reports dependency and skill state and exits by git availability", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-doctor-"));
	try {
		await git(root, "init", "-b", "main");
		const before = await run(root, ["doctor"]);
		expect(before.exitCode).toBe(0);
		expect(before.stdout).toContain("git: ok");
		expect(before.stdout).toContain("skill project: not installed");

		await run(root, ["skill", "install"]);
		const after = await run(root, ["doctor"]);
		expect(after.exitCode).toBe(0);
		expect(after.stdout).toMatch(/skill project: ok \(\d+\.\d+\.\d+\)/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
