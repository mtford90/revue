import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	type ReviewThread,
	runManifestSchema,
	THREAD_ANCHOR_KIND,
	THREAD_AUTHOR_KIND,
} from "@revue/types";
import { openThreadStore } from "./threads.ts";

const mainPath = resolve(import.meta.dir, "main.tsx");
const sampleRun = resolve(import.meta.dir, "../../../examples/sample-run");

const run = async (cwd: string, args: string[], env?: Record<string, string>) => {
	const child = Bun.spawn([process.execPath, mainPath, ...args], {
		cwd,
		env: env ? { ...process.env, ...env } : undefined,
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
				kind: THREAD_ANCHOR_KIND.HUNK,
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

test("the thread CLI round-trips an excerpt anchor and keeps it when the narrative moves on", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-excerpt-threads-cli-"));
	try {
		await git(root, "init", "-b", "main");
		await git(root, "config", "user.email", "revue@example.com");
		await git(root, "config", "user.name", "Revue Test");
		await mkdir(join(root, "src"));
		await writeFile(join(root, "src", "value.ts"), "export const value = 1;\n");
		await writeFile(
			join(root, "src", "caller.ts"),
			"import { value } from './value';\nuse(value);\n",
		);
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Baseline");
		await git(root, "checkout", "-b", "feature");
		await writeFile(join(root, "src", "value.ts"), "export const value = 2;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Change value");

		const runDirectory = (await run(root, ["prep", "main", "HEAD"])).stdout.trim();
		const manifest = runManifestSchema.parse(await Bun.file(join(runDirectory, "run.json")).json());
		const reference = manifest.files[0];
		const oldStart = reference?.referenceStarts[0];
		if (!reference || oldStart === undefined) throw new Error("Expected a prepared review unit");
		const chapter = {
			id: "chapter-1",
			order: 1,
			title: "Change the value",
			summary: "The value now reflects the new behaviour.",
			hunkRefs: [{ filePath: reference.path, oldStart }],
			keyChanges: [],
			excerpts: [{ filePath: "src/caller.ts", startLine: 1, endLine: 2 }],
		};
		const chaptersPath = join(runDirectory, "chapters.json");
		await writeFile(chaptersPath, `${JSON.stringify({ chapters: [chapter] })}\n`);
		expect((await run(root, ["context", "freeze", runDirectory])).exitCode).toBe(0);

		const created = await run(root, [
			"threads",
			"create",
			runDirectory,
			"--kind",
			"excerpt",
			"--file",
			"src/caller.ts",
			"--start-line",
			"1",
			"--end-line",
			"2",
			"--author",
			"Review agent",
			"--body",
			"Does this caller still hold?",
		]);
		expect(created).toMatchObject({ exitCode: 0, stderr: "" });
		const thread = JSON.parse(created.stdout).thread;
		expect(thread.anchor).toEqual({
			kind: "excerpt",
			filePath: "src/caller.ts",
			startLine: 1,
			endLine: 2,
		});

		const outside = await run(root, [
			...["threads", "create", runDirectory, "--kind", "excerpt", "--file", "src/caller.ts"],
			...["--start-line", "40", "--end-line", "41", "--author", "Review agent", "--body", "No"],
		]);
		expect(outside).toMatchObject({ exitCode: 1, stdout: "" });
		expect(outside.stderr).toContain("Cannot anchor a thread there");
		const mixedOptions = await run(root, [
			...["threads", "create", runDirectory, "--kind", "excerpt", "--file", "src/caller.ts"],
			...["--old-start", "0", "--start-line", "1", "--end-line", "2"],
			...["--author", "Review agent", "--body", "No"],
		]);
		expect(mixedOptions.stderr).toContain("--old-start does not apply to an excerpt anchor");

		const replied = await run(root, [
			...["threads", "reply", runDirectory, thread.id, "--author", "Fix agent"],
			...["--body", "It does; nothing to change."],
		]);
		expect(replied).toMatchObject({ exitCode: 0, stderr: "" });
		const listed = JSON.parse(
			(await run(root, ["threads", "list", runDirectory, "--json"])).stdout,
		);
		expect(listed).toMatchObject({
			runId: manifest.runId,
			threads: [{ id: thread.id, messages: [{}, {}] }],
			orphaned: [],
		});
		expect(
			JSON.parse((await run(root, ["threads", "mark-dealt", runDirectory, thread.id])).stdout),
		).toMatchObject({ thread: { status: "dealt-with" } });

		// Re-narrate at a depth that stops quoting the caller, then re-freeze. The run must still
		// load and the feedback must still be listed rather than being pruned or failing the load.
		await writeFile(
			chaptersPath,
			`${JSON.stringify({ chapters: [{ ...chapter, excerpts: [] }] })}\n`,
		);
		expect((await run(root, ["context", "freeze", runDirectory])).exitCode).toBe(0);
		const rezoomed = await run(root, ["threads", "list", runDirectory, "--json", "--all"]);
		expect(rezoomed).toMatchObject({ exitCode: 0, stderr: "" });
		expect(JSON.parse(rezoomed.stdout).threads).toHaveLength(1);
		expect(JSON.parse(rezoomed.stdout).orphaned).toMatchObject([{ id: thread.id }]);
		expect((await run(root, ["show", runDirectory, "--check"])).exitCode).toBe(0);
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
		expect(checked.stdout).toContain("1 of 1 review unit narrated");
		expect(checked.stdout).toContain("1 chapter:");
		// Nothing was dropped, so nothing is claimed about omissions.
		expect(checked.stdout).not.toContain("omitted");

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
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("context freeze pins cited code and --check refuses a narrative that skipped it", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-context-cli-"));
	try {
		await git(root, "init", "-b", "main");
		await git(root, "config", "user.email", "revue@example.com");
		await git(root, "config", "user.name", "Revue Test");
		await mkdir(join(root, "src"));
		await writeFile(join(root, "src", "value.ts"), "export const value = 1;\n");
		await writeFile(
			join(root, "src", "caller.ts"),
			"import { value } from './value';\nuse(value);\n",
		);
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Baseline");
		await git(root, "checkout", "-b", "feature");
		await writeFile(join(root, "src", "value.ts"), "export const value = 2;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Change value");

		const runDirectory = (await run(root, ["prep", "main", "HEAD"])).stdout.trim();
		const manifest = runManifestSchema.parse(await Bun.file(join(runDirectory, "run.json")).json());
		const reference = manifest.files[0];
		const oldStart = reference?.referenceStarts[0];
		if (!reference || oldStart === undefined) throw new Error("Expected a prepared review unit");
		const chapter = {
			id: "chapter-1",
			order: 1,
			title: "Change the value",
			summary: "The value now reflects the new behaviour.",
			hunkRefs: [{ filePath: reference.path, oldStart }],
			keyChanges: [],
			// A file no change touched: the caller the change has to satisfy.
			excerpts: [{ filePath: "src/caller.ts", startLine: 1, endLine: 2 }],
		};
		const chaptersPath = join(runDirectory, "chapters.json");
		await writeFile(chaptersPath, `${JSON.stringify({ chapters: [chapter] })}\n`);

		const unfrozen = await run(root, ["show", runDirectory, "--check"]);
		expect(unfrozen).toMatchObject({ exitCode: 1, stdout: "" });
		expect(unfrozen.stderr).toContain(
			`has no frozen content; run \`revue context freeze ${runDirectory}\``,
		);

		const frozen = await run(root, ["context", "freeze", runDirectory]);
		expect(frozen.exitCode).toBe(0);
		expect(frozen.stdout).toBe(`${join(runDirectory, "context.json")}\n`);
		expect(frozen.stderr).toContain("Froze 1 excerpt from commit:");
		expect(await Bun.file(join(runDirectory, "context.json")).json()).toMatchObject({
			runId: manifest.runId,
			excerpts: [{ lines: ["import { value } from './value';", "use(value);"] }],
		});

		const checked = await run(root, ["show", runDirectory, "--check"]);
		expect(checked).toMatchObject({ exitCode: 0, stderr: "" });

		await writeFile(
			chaptersPath,
			`${JSON.stringify({
				chapters: [
					{ ...chapter, excerpts: [{ filePath: "src/caller.ts", startLine: 40, endLine: 41 }] },
				],
			})}\n`,
		);
		const unresolvable = await run(root, ["context", "freeze", runDirectory]);
		expect(unresolvable).toMatchObject({ exitCode: 1, stdout: "" });
		expect(unresolvable.stderr).toContain(
			'Could not freeze excerpt "src/caller.ts" 40-41: the file has 2 lines',
		);
		const rechecked = await run(root, ["show", runDirectory, "--check"]);
		expect(rechecked).toMatchObject({ exitCode: 1, stdout: "" });
		expect(rechecked.stderr).toContain("could not be frozen: the file has 2 lines");

		const missingOperation = await run(root, ["context"]);
		expect(missingOperation).toMatchObject({ exitCode: 1, stdout: "" });
		expect(missingOperation.stderr).toContain("missing operation");
		const tooManyRuns = await run(root, ["context", "freeze", runDirectory, runDirectory]);
		expect(tooManyRuns).toMatchObject({ exitCode: 1, stdout: "" });
		expect(tooManyRuns.stderr).toContain("context freeze requires one run directory");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("delta hands the agent the worklist a superseding run left it", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-delta-cli-"));
	try {
		await git(root, "init", "-b", "main");
		await git(root, "config", "user.email", "revue@example.com");
		await git(root, "config", "user.name", "Revue Test");
		await mkdir(join(root, "src"));
		await writeFile(join(root, "src", "alpha.ts"), "export const alpha = 1;\n");
		await writeFile(join(root, "src", "beta.ts"), "export const beta = 1;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Baseline");
		await git(root, "checkout", "-b", "feature");
		await writeFile(join(root, "src", "alpha.ts"), "export const alpha = 2;\n");
		await writeFile(join(root, "src", "beta.ts"), "export const beta = 2;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Feature work");

		const first = (await run(root, ["prep", "main", "HEAD"])).stdout.trim();
		const chapter = (id: string, order: number, filePath: string) => ({
			id,
			order,
			title: `Chapter ${id}`,
			summary: `What ${filePath} now does.`,
			hunkRefs: [{ filePath, oldStart: 1 }],
			keyChanges: [],
			excerpts: [],
		});
		await writeFile(
			join(first, "chapters.json"),
			`${JSON.stringify({
				chapters: [chapter("alpha", 1, "src/alpha.ts"), chapter("beta", 2, "src/beta.ts")],
			})}\n`,
		);
		expect(await run(root, ["show", first, "--check"])).toMatchObject({ exitCode: 0 });

		const fresh = await run(root, ["delta", first]);
		expect(fresh).toMatchObject({ exitCode: 1, stdout: "" });
		expect(fresh.stderr).toContain("This run starts a fresh review");

		await writeFile(join(root, "src", "beta.ts"), "export const beta = 3;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Address the review");
		const preped = await run(root, ["prep", "main", "HEAD"]);
		const second = preped.stdout.trim();
		expect(preped.stderr).toContain(`supersedes ${first.split("/").at(-1)?.slice(0, 12)}`);
		expect(preped.stderr).toContain("1 chapter carried, 1 chapter stale");

		const delta = await run(root, ["delta", second]);
		expect(delta).toMatchObject({ exitCode: 0, stderr: "" });
		expect(JSON.parse(delta.stdout)).toMatchObject({
			carried: [chapter("alpha", 1, "src/alpha.ts")],
			stale: [{ id: "beta", reasons: ['review unit "src/beta.ts"@1 changed'] }],
			unnarrated: [{ filePath: "src/beta.ts", oldStart: 1, status: "modified" }],
		});

		// The carried chapter plus the worklist, capped by the epilogue a superseding run owes its
		// reviewer, is a complete narration.
		await writeFile(
			join(second, "chapters.json"),
			`${JSON.stringify({
				chapters: [
					...JSON.parse(delta.stdout).carried,
					{
						...chapter("epilogue", 2, "src/beta.ts"),
						role: "epilogue",
						title: "Changes since your review",
					},
				],
			})}\n`,
		);
		expect(await run(root, ["show", second, "--check"])).toMatchObject({ exitCode: 0 });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("--check holds a superseding run to its epilogue and the threads it cites", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-epilogue-cli-"));
	try {
		await git(root, "init", "-b", "main");
		await git(root, "config", "user.email", "revue@example.com");
		await git(root, "config", "user.name", "Revue Test");
		await mkdir(join(root, "src"));
		await writeFile(join(root, "src", "alpha.ts"), "export const alpha = 1;\n");
		await writeFile(join(root, "src", "beta.ts"), "export const beta = 1;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Baseline");
		await git(root, "checkout", "-b", "feature");
		await writeFile(join(root, "src", "alpha.ts"), "export const alpha = 2;\n");
		await writeFile(join(root, "src", "beta.ts"), "export const beta = 2;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Feature work");

		const chapter = (id: string, order: number, filePath: string) => ({
			id,
			order,
			title: `Chapter ${id}`,
			summary: `What ${filePath} now does.`,
			hunkRefs: [{ filePath, oldStart: 1 }],
			keyChanges: [],
			excerpts: [],
		});
		const narrate = async (directory: string, chapters: unknown[]) => {
			await writeFile(join(directory, "chapters.json"), `${JSON.stringify({ chapters })}\n`);
			return run(root, ["show", directory, "--check"]);
		};

		const first = (await run(root, ["prep", "main", "HEAD"])).stdout.trim();
		expect(
			await narrate(first, [
				chapter("alpha", 1, "src/alpha.ts"),
				chapter("beta", 2, "src/beta.ts"),
			]),
		).toMatchObject({ exitCode: 0 });

		const created = await run(root, [
			"threads",
			"create",
			first,
			"--file",
			"src/beta.ts",
			"--old-start",
			"1",
			"--side",
			"additions",
			"--start-line",
			"1",
			"--end-line",
			"1",
			"--author",
			"Reviewer",
			"--body",
			"Make beta agree with alpha.",
		]);
		expect(created).toMatchObject({ exitCode: 0, stderr: "" });
		const threadId = JSON.parse(created.stdout).thread.id;

		await writeFile(join(root, "src", "beta.ts"), "export const beta = 3;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Address the review");
		const second = (await run(root, ["prep", "main", "HEAD"])).stdout.trim();
		const carried = JSON.parse((await run(root, ["delta", second])).stdout).carried;

		const withoutEpilogue = await narrate(second, [
			...carried,
			chapter("beta-2", 2, "src/beta.ts"),
		]);
		expect(withoutEpilogue).toMatchObject({ exitCode: 1, stdout: "" });
		expect(withoutEpilogue.stderr).toContain('no chapter has "role": "epilogue"');

		const epilogue = {
			...chapter("epilogue", 2, "src/beta.ts"),
			title: "Changes since your review",
			summary: "Beta now agrees with alpha, as you asked.",
			role: "epilogue",
			threadRefs: [threadId],
		};
		expect(await narrate(second, [...carried, epilogue])).toMatchObject({ exitCode: 0 });

		const dangling = await narrate(second, [
			...carried,
			{ ...epilogue, threadRefs: ["4ad7f1cd-8b6f-4f7a-9f43-6c2b2e4b8f11"] },
		]);
		expect(dangling).toMatchObject({ exitCode: 1, stdout: "" });
		expect(dangling.stderr).toContain(
			"references thread 4ad7f1cd-8b6f-4f7a-9f43-6c2b2e4b8f11, which this run does not have",
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("status says plainly that a repository has nothing to orient around yet", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-status-empty-"));
	try {
		await git(root, "init", "-b", "main");
		await git(root, "config", "user.email", "revue@example.com");
		await git(root, "config", "user.name", "Revue Test");
		await writeFile(join(root, "alpha.ts"), "export const alpha = 1;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Baseline");

		const json = await run(root, ["status", "--json"]);
		expect(json).toMatchObject({ exitCode: 0, stderr: "" });
		expect(JSON.parse(json.stdout)).toMatchObject({
			activeRun: null,
			pendingRun: null,
			threads: { runId: null, open: 0, awaitingAgent: 0, awaitingHuman: 0, orphaned: 0 },
			drift: null,
		});

		const human = await run(root, ["status"]);
		expect(human).toMatchObject({ exitCode: 0, stderr: "" });
		expect(human.stdout).toContain("No prepared runs");

		const rejected = await run(root, ["status", "some-run"]);
		expect(rejected).toMatchObject({ exitCode: 1, stdout: "" });
		expect(rejected.stderr).toContain("status takes no positional arguments");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("status orients a cold agent on the active run, its threads, and working-tree drift", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-status-"));
	try {
		await git(root, "init", "-b", "main");
		await git(root, "config", "user.email", "revue@example.com");
		await git(root, "config", "user.name", "Revue Test");
		await mkdir(join(root, "src"));
		await writeFile(join(root, "src", "alpha.ts"), "export const alpha = 1;\n");
		await writeFile(join(root, "src", "beta.ts"), "export const beta = 1;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Baseline");
		await git(root, "checkout", "-b", "feature");
		await writeFile(join(root, "src", "alpha.ts"), "export const alpha = 2;\n");
		await writeFile(join(root, "src", "beta.ts"), "export const beta = 2;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Feature work");

		const first = (await run(root, ["prep", "main", "HEAD"])).stdout.trim();
		const firstRunId = first.split("/").at(-1) ?? "";
		const chapter = (id: string, order: number, filePath: string) => ({
			id,
			order,
			title: `Chapter ${id}`,
			summary: `What ${filePath} now does.`,
			hunkRefs: [{ filePath, oldStart: 1 }],
			keyChanges: [],
			excerpts: [],
		});
		await writeFile(
			join(first, "chapters.json"),
			`${JSON.stringify({
				chapters: [chapter("alpha", 1, "src/alpha.ts"), chapter("beta", 2, "src/beta.ts")],
			})}\n`,
		);

		// The reviewer speaks first on both files; the agent answers only one of them.
		const store = openThreadStore(join(root, ".revue", "threads.json"), firstRunId);
		const reviewerThread = (filePath: string, body: string) =>
			store.create(
				{
					kind: THREAD_ANCHOR_KIND.HUNK,
					filePath,
					oldStart: 1,
					side: "additions",
					startLine: 1,
					endLine: 1,
				},
				{ kind: THREAD_AUTHOR_KIND.HUMAN, name: "Reviewer" },
				body,
			);
		const answered = reviewerThread("src/alpha.ts", "Is two the right constant?");
		reviewerThread("src/beta.ts", "Why does beta move at all?");
		expect(
			await run(root, [
				"threads",
				"reply",
				first,
				answered.id,
				"--author",
				"Review agent",
				"--body",
				"Two matches the caller.",
			]),
		).toMatchObject({ exitCode: 0 });

		const narrated = await run(root, ["status", "--json"]);
		expect(narrated).toMatchObject({ exitCode: 0, stderr: "" });
		expect(JSON.parse(narrated.stdout)).toMatchObject({
			repositoryRoot: expect.any(String),
			activeRun: {
				runId: firstRunId,
				directory: first,
				narrated: true,
				supersedes: null,
				scope: {
					mode: "committed",
					comparison: "merge-base",
					base: "main",
					head: "HEAD",
					prepArgs: ["--base", "main", "--compare", "HEAD"],
				},
			},
			pendingRun: null,
			threads: {
				runId: firstRunId,
				open: 2,
				awaitingAgent: 1,
				awaitingHuman: 1,
				dealtWith: 0,
				orphaned: 0,
			},
			drift: { since: firstRunId, changed: false },
		});

		// The agent responds to the reviewer, so the next prep supersedes the run they read.
		await writeFile(join(root, "src", "beta.ts"), "export const beta = 3;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Address the review");
		const second = (await run(root, ["prep", "main", "HEAD"])).stdout.trim();
		const secondRunId = second.split("/").at(-1) ?? "";

		const superseded = await run(root, ["status", "--json"]);
		expect(superseded).toMatchObject({ exitCode: 0, stderr: "" });
		expect(JSON.parse(superseded.stdout)).toMatchObject({
			activeRun: { runId: firstRunId, narrated: true },
			pendingRun: {
				runId: secondRunId,
				directory: second,
				narrated: false,
				supersedes: firstRunId,
				delta: { carried: 1, stale: 1, unnarrated: 1 },
			},
			// The threads followed the code onto the superseding run.
			threads: { runId: secondRunId, open: 2, awaitingAgent: 1, awaitingHuman: 1 },
			drift: { since: firstRunId, changed: true },
		});

		const human = await run(root, ["status"]);
		expect(human).toMatchObject({ exitCode: 0, stderr: "" });
		expect(human.stdout).toContain(`Active run ${firstRunId.slice(0, 12)}`);
		expect(human.stdout).toContain(`Pending    ${secondRunId.slice(0, 12)} not narrated`);
		expect(human.stdout).toContain("1 chapter carried, 1 chapter stale, 1 review unit to narrate");
		expect(human.stdout).toContain(
			"2 open threads (1 awaiting the agent, 1 awaiting the reviewer)",
		);
		expect(human.stdout).toContain("the scope has changed since this run was prepped");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("threads carry onto the superseding run, orphaned rather than lost when their code goes", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-thread-carry-"));
	try {
		await git(root, "init", "-b", "main");
		await git(root, "config", "user.email", "revue@example.com");
		await git(root, "config", "user.name", "Revue Test");
		await mkdir(join(root, "src"));
		await writeFile(join(root, "src", "alpha.ts"), "export const alpha = 1;\n");
		await writeFile(join(root, "src", "gamma.ts"), "export const gamma = 1;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Baseline");
		await git(root, "checkout", "-b", "feature");
		await writeFile(join(root, "src", "alpha.ts"), "export const alpha = 2;\n");
		await writeFile(join(root, "src", "gamma.ts"), "export const gamma = 2;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Feature work");

		const first = (await run(root, ["prep", "main", "HEAD"])).stdout.trim();
		await writeFile(
			join(first, "chapters.json"),
			`${JSON.stringify({
				chapters: ["alpha", "gamma"].map((name, index) => ({
					id: name,
					order: index + 1,
					title: `Chapter ${name}`,
					summary: `What src/${name}.ts now does.`,
					hunkRefs: [{ filePath: `src/${name}.ts`, oldStart: 1 }],
					keyChanges: [],
					excerpts: [],
				})),
			})}\n`,
		);
		const comment = async (filePath: string, body: string) => {
			const created = await run(root, [
				"threads",
				"create",
				first,
				"--file",
				filePath,
				"--old-start",
				"1",
				"--side",
				"additions",
				"--start-line",
				"1",
				"--end-line",
				"1",
				"--author",
				"Review agent",
				"--body",
				body,
			]);
			expect(created).toMatchObject({ exitCode: 0, stderr: "" });
			return JSON.parse(created.stdout).thread.id as string;
		};
		const kept = await comment("src/alpha.ts", "Is two the right constant?");
		const doomed = await comment("src/gamma.ts", "Was this change needed at all?");
		await run(root, [
			"threads",
			"reply",
			first,
			kept,
			"--author",
			"Review agent",
			"--body",
			"Two matches the caller.",
		]);
		expect(await run(root, ["threads", "mark-dealt", first, doomed])).toMatchObject({
			exitCode: 0,
		});

		// The agent responds by dropping the gamma change entirely, which deletes what it anchors.
		await writeFile(join(root, "src", "gamma.ts"), "export const gamma = 1;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Address the review");
		const second = (await run(root, ["prep", "main", "HEAD"])).stdout.trim();

		const listed = await run(root, ["threads", "list", second, "--json", "--all"]);
		expect(listed).toMatchObject({ exitCode: 0, stderr: "" });
		const payload = JSON.parse(listed.stdout);
		expect(payload.threads.map((thread: ReviewThread) => thread.id)).toEqual([kept, doomed]);
		expect(payload.threads[0]).toMatchObject({
			runId: second.split("/").at(-1),
			migratedFrom: first.split("/").at(-1),
			status: "open",
			anchor: { filePath: "src/alpha.ts", oldStart: 1, startLine: 1, endLine: 1 },
		});
		expect(payload.threads[0].messages.map((message: { body: string }) => message.body)).toEqual([
			"Is two the right constant?",
			"Two matches the caller.",
		]);
		// The reverted change took its review unit with it: the thread is kept and listed, not pruned,
		// and the run still loads.
		expect(payload.threads[1]).toMatchObject({ id: doomed, status: "dealt-with" });
		expect(payload.orphaned).toEqual([
			{ id: doomed, reason: expect.stringContaining("carried from a superseded run") },
		]);

		const superseded = await run(root, ["threads", "list", first, "--json", "--all"]);
		expect(superseded).toMatchObject({ exitCode: 0, stderr: "" });
		expect(JSON.parse(superseded.stdout).threads).toEqual([]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("--check says how much of the change an ignore rule kept out of the run", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-omitted-"));
	try {
		await git(root, "init", "-b", "main");
		await git(root, "config", "user.email", "revue@example.com");
		await git(root, "config", "user.name", "Revue Test");
		await writeFile(join(root, ".revueignore"), "*.test.ts\n");
		await writeFile(join(root, "value.ts"), "export const value = 1;\n");
		await writeFile(join(root, "value.test.ts"), "test one\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Baseline");
		await git(root, "checkout", "-b", "feature");
		await writeFile(join(root, "value.ts"), "export const value = 2;\n");
		await writeFile(join(root, "value.test.ts"), "test two\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Change value");

		const runDirectory = (await run(root, ["prep", "main", "HEAD"])).stdout.trim();
		const manifest = runManifestSchema.parse(await Bun.file(join(runDirectory, "run.json")).json());
		const reference = manifest.files[0];
		const oldStart = reference?.referenceStarts[0];
		if (!reference || oldStart === undefined) throw new Error("Expected a prepared review unit");

		// The agent is told what it cannot see, so it can narrate around the gap knowingly.
		const hunks = await Bun.file(join(runDirectory, "hunks.txt")).text();
		expect(hunks).toContain("=== OMITTED FROM THIS RUN ===");
		expect(hunks).toContain('"value.test.ts": .revueignore pattern "*.test.ts"');

		await writeFile(
			join(runDirectory, "chapters.json"),
			JSON.stringify({
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
			}),
		);

		const checked = await run(root, ["show", runDirectory, "--check"]);
		expect(checked).toMatchObject({ exitCode: 0, stderr: "" });
		// "1 of 1 narrated" is true of the run and misleading about the change, so the run says both.
		expect(checked.stdout).toContain("1 of 1 review unit narrated");
		expect(checked.stdout).toContain("1 file omitted · .revueignore");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a run without chapters.json validates, opens flat, and still takes threads", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-chapterless-"));
	try {
		const reviewRun = await copySampleRun(root);
		await rm(join(reviewRun, "chapters.json"));

		const checked = await run(root, ["show", reviewRun, "--check"]);
		expect(checked).toMatchObject({ exitCode: 0, stderr: "" });
		expect(checked.stdout).toContain("chapterless run is valid");
		expect(checked.stdout).toContain("3 files, 3 review units, +24 -1");
		expect(checked.stdout).toContain("flat file-by-file diff");

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
			"--body",
			"Confirm the cap.",
		]);
		expect(created).toMatchObject({ exitCode: 0, stderr: "" });
		const listed = await run(root, ["threads", "list", reviewRun, "--json"]);
		expect(JSON.parse(listed.stdout).threads).toHaveLength(1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("bare revue and revue diff prep the scope and print the run directory", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-diff-cli-"));
	try {
		await git(root, "init", "-b", "main");
		await git(root, "config", "user.email", "revue@example.com");
		await git(root, "config", "user.name", "Revue Test");
		await mkdir(join(root, "src"));
		await writeFile(join(root, "src", "value.ts"), "export const value = 1;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Baseline");
		await writeFile(join(root, "src", "value.ts"), "export const value = 2;\n");

		// stdout is not a TTY here, so the shared open path prints the summary instead.
		const bare = await run(root, []);
		expect(bare.exitCode).toBe(0);
		expect(bare.stderr).toContain("Prepared work run");
		expect(bare.stdout).toContain("chapterless run is valid");

		const scoped = await run(root, ["diff", "--ref", "unstaged"]);
		expect(scoped.exitCode).toBe(0);
		expect(scoped.stderr).toContain("Prepared unstaged run");
		const directory = scoped.stderr.trim().split("\n").at(-1) ?? "";
		expect(await Bun.file(join(directory, "run.json")).exists()).toBe(true);

		// The theme is validated before git prep runs, so no "Prepared ..." summary is printed.
		const badTheme = await run(root, ["diff", "--theme", "solarised-dark"]);
		expect(badTheme).toMatchObject({ exitCode: 1, stdout: "" });
		expect(badTheme.stderr).toBe(
			"unknown theme: solarised-dark\nRun `revue show <run-directory> --theme list` or `revue themes` for details.\n",
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("show names its themes, including custom ones, and refuses an unknown one before touching the run", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-theme-"));
	try {
		const directory = await copySampleRun(root);
		const themesDir = join(root, ".revue", "themes");
		await mkdir(themesDir, { recursive: true });
		await writeFile(
			join(themesDir, "mauve.json"),
			JSON.stringify({ extends: "nord", label: "Mauve" }),
			"utf8",
		);

		const listed = await run(root, ["show", directory, "--theme", "list"], { HOME: root });
		expect(listed.exitCode).toBe(0);
		const ids = listed.stdout.trim().split("\n");
		expect(ids).toContain("github-dark-default");
		expect(ids).toContain("mauve");

		const unknown = await run(root, ["show", directory, "--theme", "solarised-dark"]);
		expect(unknown).toMatchObject({ exitCode: 1, stdout: "" });
		expect(unknown.stderr).toBe(
			"unknown theme: solarised-dark\nRun `revue show <run-directory> --theme list` or `revue themes` for details.\n",
		);

		const known = await run(root, ["show", directory, "--theme", "nord", "--check"]);
		expect(known.exitCode).toBe(0);
		expect(known.stdout).toContain("run is valid");

		// A broken run directory never gets touched: the unknown theme is rejected first.
		const brokenRun = join(root, "does-not-exist");
		const beforeRun = await run(root, ["show", brokenRun, "--theme", "solarised-dark"]);
		expect(beforeRun).toMatchObject({ exitCode: 1, stdout: "" });
		expect(beforeRun.stderr).toContain("unknown theme: solarised-dark");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("show validates each half of the light/dark pair, and only --theme may say auto", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-theme-pair-"));
	try {
		const directory = await copySampleRun(root);

		const pair = await run(
			root,
			["show", directory, "--theme-light", "ayu-light", "--theme-dark", "nord", "--check"],
			{ HOME: root },
		);
		expect(pair.exitCode).toBe(0);
		expect(pair.stdout).toContain("run is valid");

		const unknownHalf = await run(root, ["show", directory, "--theme-dark", "solarised-dark"], {
			HOME: root,
		});
		expect(unknownHalf).toMatchObject({ exitCode: 1, stdout: "" });
		expect(unknownHalf.stderr).toContain("unknown theme: solarised-dark");

		// A half names one theme; only --theme defers to the terminal.
		const autoHalf = await run(root, ["show", directory, "--theme-light", "auto"], { HOME: root });
		expect(autoHalf).toMatchObject({ exitCode: 1, stdout: "" });
		expect(autoHalf.stderr).toContain("unknown theme: auto");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("show resolves a custom theme by id from ~/.revue/themes", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-custom-theme-"));
	try {
		const directory = await copySampleRun(root);
		const themesDir = join(root, ".revue", "themes");
		await mkdir(themesDir, { recursive: true });
		await writeFile(
			join(themesDir, "mauve.json"),
			JSON.stringify({ extends: "nord", label: "Mauve" }),
			"utf8",
		);

		const known = await run(root, ["show", directory, "--theme", "mauve", "--check"], {
			HOME: root,
		});
		expect(known.exitCode).toBe(0);
		expect(known.stdout).toContain("run is valid");

		const unknown = await run(root, ["show", directory, "--theme", "not-a-theme", "--check"], {
			HOME: root,
		});
		expect(unknown).toMatchObject({ exitCode: 1, stdout: "" });
		expect(unknown.stderr).toContain("unknown theme: not-a-theme");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

// Stands in for the skills CLI (vercel-labs/skills): records its arguments and copies the
// handed-over skill where a real run would install it for Claude Code at project scope.
const fakeSkillsRunner = async (root: string): Promise<{ executable: string; log: string }> => {
	const executable = join(root, "fake-skills");
	const log = join(root, "runner-args.log");
	await writeFile(
		executable,
		`#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(log)}
mkdir -p .claude/skills/revue
cp "$2/SKILL.md" .claude/skills/revue/SKILL.md
`,
	);
	await chmod(executable, 0o755);
	return { executable, log };
};

test("skill install hands a version-stamped skill to the skills CLI runner", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-skill-"));
	try {
		await git(root, "init", "-b", "main");
		const { executable, log } = await fakeSkillsRunner(root);

		const installed = await run(root, ["skill", "install"], { REVUE_SKILL_RUNNER: executable });
		expect(installed.exitCode).toBe(0);

		const runnerArgs = (await Bun.file(log).text()).trim().split("\n");
		expect(runnerArgs[0]).toBe("add");
		expect(runnerArgs.slice(2)).toEqual(["--copy", "-y"]);

		const contents = await Bun.file(join(root, ".claude", "skills", "revue", "SKILL.md")).text();
		expect(contents).toMatch(/^---\nrevue-version: \d+\.\d+\.\d+\n/);
		expect(contents).toContain("# revue");

		const userScope = await run(root, ["skill", "install", "--user"], {
			REVUE_SKILL_RUNNER: executable,
		});
		expect(userScope.exitCode).toBe(0);
		expect((await Bun.file(log).text()).trim().split("\n").slice(2)).toEqual([
			"--copy",
			"-y",
			"-g",
		]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("skill install without any package runner prints manual instructions and fails", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-skill-norunner-"));
	try {
		const missing = await run(root, ["skill", "install"], { PATH: "/var/empty" });
		expect(missing.exitCode).toBe(1);
		expect(missing.stderr).toContain("No package runner found");
		expect(missing.stderr).toContain("revue skill print");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("skill print writes the stamped skill to stdout", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-skill-print-"));
	try {
		const printed = await run(root, ["skill", "print"]);
		expect(printed).toMatchObject({ exitCode: 0, stderr: "" });
		expect(printed.stdout).toMatch(/^---\nrevue-version: \d+\.\d+\.\d+\n/);
		expect(printed.stdout).toContain("# revue");
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
		// Patch is the only code representation, so no external differ is probed.
		expect(before.stdout).not.toContain("difft");
		expect(before.stdout).not.toContain("Semantic");

		const { executable } = await fakeSkillsRunner(root);
		await run(root, ["skill", "install"], { REVUE_SKILL_RUNNER: executable });
		const after = await run(root, ["doctor"]);
		expect(after.exitCode).toBe(0);
		expect(after.stdout).toMatch(/skill project: ok \(\d+\.\d+\.\d+\)/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("keybindings lists every action and flags overrides and issues", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-keybindings-cli-"));
	try {
		await mkdir(join(root, ".revue"));
		await writeFile(
			join(root, ".revue", "keybindings.json"),
			JSON.stringify({ quit: "z", "not-a-real-action": "x" }),
		);
		const listing = await run(root, ["keybindings"], { HOME: root });
		expect(listing.exitCode).toBe(0);
		expect(listing.stdout).toContain("line-up");
		expect(listing.stdout).toMatch(/quit\s+z\s+Quit \(overridden, default: q\/Q\)/);
		expect(listing.stdout).toContain("Issues:");
		expect(listing.stdout).toContain('not-a-real-action: unknown action "not-a-real-action"');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("keybindings init writes a starter template and refuses to overwrite it without --force", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-keybindings-init-"));
	try {
		const init = await run(root, ["keybindings", "init"], { HOME: root });
		expect(init.exitCode).toBe(0);
		expect(init.stdout).toContain(join(root, ".revue", "keybindings.json"));
		const written = await Bun.file(join(root, ".revue", "keybindings.json")).text();
		expect(written).toContain('// "quit": ["q","Q"]');

		const again = await run(root, ["keybindings", "init"], { HOME: root });
		expect(again.exitCode).toBe(1);
		expect(again.stderr).toContain("already exists");

		const forced = await run(root, ["keybindings", "init", "--force"], { HOME: root });
		expect(forced.exitCode).toBe(0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("themes lists bundled and custom themes and flags shadowed overrides and issues", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-themes-cli-"));
	try {
		await mkdir(join(root, ".revue", "themes"), { recursive: true });
		await writeFile(
			join(root, ".revue", "themes", "ayu-dark.json"),
			JSON.stringify({ extends: "ayu-dark", overrides: { accent: "#ff0000" } }),
		);
		await writeFile(join(root, ".revue", "themes", "broken.json"), "{not json");
		const listing = await run(root, ["themes"], { HOME: root });
		expect(listing.exitCode).toBe(0);
		expect(listing.stdout).toContain("dark:");
		expect(listing.stdout).toMatch(/ayu-dark.*\(customised\)/);
		expect(listing.stdout).toContain("Issues:");
		expect(listing.stdout).toContain("broken: malformed JSON; theme ignored");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("themes init writes a starter template that parses cleanly, and refuses to overwrite it without --force", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-themes-init-"));
	try {
		const init = await run(root, ["themes", "init", "my-theme"], { HOME: root });
		expect(init.exitCode).toBe(0);
		expect(init.stdout).toContain(join(root, ".revue", "themes", "my-theme.json"));
		const written = await Bun.file(join(root, ".revue", "themes", "my-theme.json")).text();
		expect(written).toContain('"extends": "ayu-dark"');

		const listing = await run(root, ["themes"], { HOME: root });
		expect(listing.exitCode).toBe(0);
		expect(listing.stdout).not.toContain("Issues:");

		const again = await run(root, ["themes", "init", "my-theme"], { HOME: root });
		expect(again.exitCode).toBe(1);
		expect(again.stderr).toContain("already exists");

		const forced = await run(root, ["themes", "init", "my-theme", "--force"], { HOME: root });
		expect(forced.exitCode).toBe(0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("themes init refuses a name containing a path separator or leading dot", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-themes-init-unsafe-"));
	try {
		const traversal = await run(root, ["themes", "init", "../evil"], { HOME: root });
		expect(traversal.exitCode).toBe(1);
		expect(traversal.stderr).toContain('invalid theme name "../evil"');
		expect(await Bun.file(join(root, "evil.json")).exists()).toBe(false);

		const nested = await run(root, ["themes", "init", "nested/name"], { HOME: root });
		expect(nested.exitCode).toBe(1);
		expect(nested.stderr).toContain('invalid theme name "nested/name"');

		const hidden = await run(root, ["themes", "init", ".hidden"], { HOME: root });
		expect(hidden.exitCode).toBe(1);
		expect(hidden.stderr).toContain('invalid theme name ".hidden"');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("prep --pr fetches a pull request head from the remote and pins it as the compare ref", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-prep-pr-"));
	try {
		const upstream = join(root, "upstream");
		await mkdir(upstream);
		await git(upstream, "init", "-b", "main");
		await git(upstream, "config", "user.email", "revue@example.com");
		await git(upstream, "config", "user.name", "Revue Test");
		await writeFile(join(upstream, "value.txt"), "one\n");
		await git(upstream, "add", "-A");
		await git(upstream, "commit", "-m", "Baseline");
		await git(upstream, "checkout", "-b", "feature");
		await writeFile(join(upstream, "value.txt"), "two\n");
		await git(upstream, "add", "-A");
		await git(upstream, "commit", "-m", "Change value");
		await git(upstream, "update-ref", "refs/pull/1/head", "feature");
		await git(upstream, "checkout", "main");

		const clone = join(root, "clone");
		await git(root, "clone", "--quiet", upstream, clone);

		const prepped = await run(clone, ["prep", "--pr", "1"]);
		expect(prepped.exitCode).toBe(0);
		expect(prepped.stderr).toContain("head  pull/1/head");
		const runDirectory = prepped.stdout.trim();
		const manifest = runManifestSchema.parse(await Bun.file(join(runDirectory, "run.json")).json());
		expect(manifest.scope.mode).toBe("committed");
		expect(manifest.scope.head.ref).toBe("pull/1/head");
		expect(manifest.totals.files).toBe(1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

const orcaEnv = { ORCA_WORKTREE_ID: "worktree-1", ORCA_PANE_KEY: "tab-1:leaf-1" };
// Explicit empty strings, rather than an absent key, so a caller that inherited these
// variables from its own Orca session does not leak them into a "no Orca" scenario.
const noOrcaEnv = { ORCA_WORKTREE_ID: "", ORCA_PANE_KEY: "" };

const seedFeatureRepo = async (root: string): Promise<void> => {
	await git(root, "init", "-b", "main");
	await git(root, "config", "user.email", "revue@example.com");
	await git(root, "config", "user.name", "Revue Test");
	await writeFile(join(root, "value.txt"), "one\n");
	await git(root, "add", "-A");
	await git(root, "commit", "-m", "Baseline");
	await git(root, "checkout", "-b", "feature");
	await writeFile(join(root, "value.txt"), "two\n");
	await git(root, "add", "-A");
	await git(root, "commit", "-m", "Change value");
};

const agentOriginFile = (root: string) => join(root, ".revue", "agent.json");

test("prep under Orca variables records the agent's pane, including on a deduplicated run", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-agent-origin-prep-"));
	try {
		await seedFeatureRepo(root);

		const first = await run(root, ["prep", "main", "HEAD"], orcaEnv);
		expect(first.exitCode).toBe(0);
		const manifest = runManifestSchema.parse(
			await Bun.file(join(first.stdout.trim(), "run.json")).json(),
		);
		const recorded = await Bun.file(agentOriginFile(root)).json();
		expect(recorded).toMatchObject({
			schemaVersion: 1,
			host: "orca",
			paneKey: "tab-1:leaf-1",
			worktreeId: "worktree-1",
			runId: manifest.runId,
		});
		expect(recorded.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

		// Re-preparing the same scope reproduces the same run and returns it early, but the
		// origin must still follow whichever pane most recently ran the agent.
		const second = await run(root, ["prep", "main", "HEAD"], {
			ORCA_WORKTREE_ID: "worktree-1",
			ORCA_PANE_KEY: "tab-2:leaf-2",
		});
		expect(second.exitCode).toBe(0);
		expect(second.stdout.trim()).toBe(first.stdout.trim());
		const recordedAfterDedup = await Bun.file(agentOriginFile(root)).json();
		expect(recordedAfterDedup).toMatchObject({ paneKey: "tab-2:leaf-2", runId: manifest.runId });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("threads reply under Orca variables records the agent's pane", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-agent-origin-reply-"));
	try {
		await seedFeatureRepo(root);
		const runDirectory = (await run(root, ["prep", "main", "HEAD"], noOrcaEnv)).stdout.trim();
		expect(await Bun.file(agentOriginFile(root)).exists()).toBe(false);
		const manifest = runManifestSchema.parse(await Bun.file(join(runDirectory, "run.json")).json());

		const created = await run(root, [
			"threads",
			"create",
			runDirectory,
			"--file",
			"value.txt",
			"--old-start",
			"1",
			"--side",
			"additions",
			"--start-line",
			"1",
			"--end-line",
			"1",
			"--author",
			"Review agent",
			"--body",
			"Looks fine.",
		]);
		const threadId = JSON.parse(created.stdout).thread.id;

		const replied = await run(
			root,
			["threads", "reply", runDirectory, threadId, "--author", "Fix agent", "--body", "Done."],
			orcaEnv,
		);
		expect(replied.exitCode).toBe(0);
		const recorded = await Bun.file(agentOriginFile(root)).json();
		expect(recorded).toMatchObject({
			host: "orca",
			paneKey: "tab-1:leaf-1",
			worktreeId: "worktree-1",
			runId: manifest.runId,
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a failed prep or reply under Orca variables writes nothing", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-agent-origin-failure-"));
	try {
		const failedPrep = await run(root, ["prep", "no-such-ref", "HEAD"], orcaEnv);
		expect(failedPrep.exitCode).toBe(1);
		expect(await Bun.file(agentOriginFile(root)).exists()).toBe(false);

		await seedFeatureRepo(root);
		const runDirectory = (await run(root, ["prep", "main", "HEAD"], noOrcaEnv)).stdout.trim();
		const failedReply = await run(
			root,
			[
				"threads",
				"reply",
				runDirectory,
				"00000000-0000-4000-8000-000000000099",
				"--author",
				"Fix agent",
				"--body",
				"Done.",
			],
			orcaEnv,
		);
		expect(failedReply.exitCode).toBe(1);
		expect(await Bun.file(agentOriginFile(root)).exists()).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("without Orca variables prep writes nothing", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-agent-origin-none-"));
	try {
		await seedFeatureRepo(root);
		const prepped = await run(root, ["prep", "main", "HEAD"], noOrcaEnv);
		expect(prepped.exitCode).toBe(0);
		expect(await Bun.file(agentOriginFile(root)).exists()).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("an unwritable .revue directory warns on stderr and the command still exits 0", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-agent-origin-unwritable-"));
	try {
		await seedFeatureRepo(root);
		await run(root, ["prep", "main", "HEAD"], noOrcaEnv);
		await chmod(join(root, ".revue"), 0o500);
		try {
			const prepped = await run(root, ["prep", "main", "HEAD"], orcaEnv);
			expect(prepped.exitCode).toBe(0);
			expect(prepped.stderr).toContain("warning:");
			expect(await Bun.file(agentOriginFile(root)).exists()).toBe(false);
		} finally {
			await chmod(join(root, ".revue"), 0o700);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
