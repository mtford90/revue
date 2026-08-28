import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Chapter,
	emptyThreadStoreFile,
	type ReviewThread,
	type RevueChaptersFile,
	RevueChaptersFileSchema,
	reviewThreadSchema,
	THREAD_ANCHOR_KIND,
	THREAD_AUTHOR_KIND,
	THREAD_STATUS,
	type ThreadAnchor,
} from "@revue/types";
import type { PreparedRun } from "../src/artifact.ts";
import { freezeRunContext } from "../src/context.ts";
import { loadRunDelta } from "../src/delta.ts";
import { prepareRun } from "../src/prep.ts";
import { persistThreadStoreFile, readThreadStoreFile, threadStorePath } from "../src/threads.ts";

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
	const root = await mkdtemp(join(tmpdir(), "revue-thread-carry-"));
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

const identifier = (index: number): string =>
	`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

const anchoredAt = (filePath: string, oldStart: number, line: number): ThreadAnchor => ({
	kind: THREAD_ANCHOR_KIND.HUNK,
	filePath,
	oldStart,
	side: "additions",
	startLine: line,
	endLine: line,
});

type FeedbackInput = {
	index: number;
	runId: string;
	anchor: ThreadAnchor;
	body: string;
	answer?: string;
	status?: ReviewThread["status"];
};

/** One reviewer thread as the TUI would have written it against the run being read. */
const feedback = ({ index, runId, anchor, body, answer, status }: FeedbackInput): ReviewThread => {
	const at = (offset: number) => `2026-08-02T10:0${index}:0${offset}.000Z`;
	const reply = answer
		? [
				{
					id: identifier(index * 10 + 1),
					author: { kind: THREAD_AUTHOR_KIND.AGENT, name: "Review agent" },
					body: answer,
					createdAt: at(1),
				},
			]
		: [];
	return reviewThreadSchema.parse({
		id: identifier(index),
		runId,
		anchor,
		status: status ?? THREAD_STATUS.OPEN,
		createdAt: at(0),
		messages: [
			{
				id: identifier(index * 10),
				author: { kind: THREAD_AUTHOR_KIND.HUMAN, name: "Ada Reviewer" },
				body,
				createdAt: at(0),
			},
			...reply,
		],
	});
};

const seedThreads = (root: string, runId: string, threads: ReviewThread[]): void => {
	persistThreadStoreFile(threadStorePath(root), {
		...emptyThreadStoreFile(),
		runs: { [runId]: threads },
	});
};

const storedThreads = (root: string, runId: string): ReviewThread[] =>
	readThreadStoreFile(threadStorePath(root)).runs[runId] ?? [];

/** The new-side line an anchor points at, read from the code the run pinned. */
const anchoredLine = async (
	run: PreparedRun,
	filePath: string,
	line: number,
): Promise<string | undefined> => {
	const file = run.manifest.files.find((entry) => entry.path === filePath);
	if (!file?.newBlob) throw new Error(`Run has no pinned content for ${filePath}`);
	const content = await readFile(join(run.directory, "blobs", file.newBlob), "utf8");
	return content.split("\n")[line - 1];
};

test("feedback follows the code onto the run that continues the review", async () => {
	const root = await repository({
		"src/alpha.ts": numbered("alpha", 20),
		"src/beta.ts": numbered("beta", 20),
		"src/gamma.ts": numbered("gamma", 20),
	});
	for (const name of ["alpha", "beta", "gamma"]) {
		await write(root, `src/${name}.ts`, replaceLine(numbered(name, 20), 5, `${name} line five`));
	}
	await commit(root, "Feature work");
	const first = await prepareRun(["main", "HEAD"], root);
	await narrate(
		first,
		["alpha", "beta", "gamma"].map((name, index) =>
			chapter({
				id: name,
				order: index + 1,
				hunkRefs: [{ filePath: `src/${name}.ts`, oldStart: 2 }],
			}),
		),
	);
	const untouched = feedback({
		index: 1,
		runId: first.manifest.runId,
		anchor: anchoredAt("src/alpha.ts", 2, 5),
		body: "Is this rename worth it?",
		answer: "It matches the caller's vocabulary.",
		status: THREAD_STATUS.DEALT_WITH,
	});
	const fixed = feedback({
		index: 2,
		runId: first.manifest.runId,
		anchor: anchoredAt("src/beta.ts", 2, 5),
		body: "This should say what it means.",
	});
	const deleted = feedback({
		index: 3,
		runId: first.manifest.runId,
		anchor: anchoredAt("src/gamma.ts", 2, 5),
		body: "Was this change needed at all?",
	});
	seedThreads(root, first.manifest.runId, [untouched, fixed, deleted]);

	await write(root, "src/beta.ts", replaceLine(numbered("beta", 20), 5, "beta line 5, fixed"));
	await write(root, "src/gamma.ts", numbered("gamma", 20));
	await commit(root, "Address the review");
	const second = await prepareRun(["main", "HEAD"], root);

	// The superseded run keeps no feedback of its own: one conversation, on the run that continues it.
	expect(second.manifest.supersedes).toBe(first.manifest.runId);
	expect(storedThreads(root, first.manifest.runId)).toEqual([]);
	const carried = storedThreads(root, second.manifest.runId);
	expect(carried.map((thread) => thread.id)).toEqual([untouched.id, fixed.id, deleted.id]);
	expect(carried.map((thread) => thread.status)).toEqual([
		THREAD_STATUS.DEALT_WITH,
		THREAD_STATUS.OPEN,
		THREAD_STATUS.OPEN,
	]);
	expect(carried.map((thread) => thread.messages)).toEqual([
		untouched.messages,
		fixed.messages,
		deleted.messages,
	]);
	expect(carried.map((thread) => thread.createdAt)).toEqual([
		untouched.createdAt,
		fixed.createdAt,
		deleted.createdAt,
	]);
	for (const thread of carried) {
		expect(thread.runId).toBe(second.manifest.runId);
		expect(thread.migratedFrom).toBe(first.manifest.runId);
	}

	const [onAlpha, onBeta, onGamma] = carried;
	// An untouched review unit still holds the code the reviewer read.
	expect(onAlpha?.anchor).toEqual(untouched.anchor);
	expect(await anchoredLine(second, "src/alpha.ts", 5)).toBe("alpha line five");
	// The rewritten unit is where the answer to the thread now lives, so the thread goes there.
	expect(onBeta?.anchor).toEqual(fixed.anchor);
	expect(await anchoredLine(second, "src/beta.ts", 5)).toBe("beta line 5, fixed");
	expect((await loadRunDelta(second))?.unnarrated).toContainEqual({
		filePath: "src/beta.ts",
		oldStart: 2,
		status: "modified",
	});
	// The reverted change took its review unit with it; the thread stays, pointing where it was made.
	expect(onGamma?.anchor).toEqual(deleted.anchor);
	expect(second.manifest.files.map((file) => file.path)).not.toContain("src/gamma.ts");
});

test("an anchor whose lines moved beneath it is re-mapped onto the same code", async () => {
	const root = await repository({ "src/app.ts": numbered("app", 30) });
	await write(root, "src/app.ts", replaceLine(numbered("app", 30), 25, "app line twenty-five"));
	await commit(root, "Feature work");
	const first = await prepareRun(["main", "HEAD"], root);
	await narrate(first, [
		chapter({ id: "moved", order: 1, hunkRefs: [{ filePath: "src/app.ts", oldStart: 22 }] }),
	]);
	const question = feedback({
		index: 1,
		runId: first.manifest.runId,
		anchor: anchoredAt("src/app.ts", 22, 25),
		body: "Does the reworded line still read correctly?",
	});
	seedThreads(root, first.manifest.runId, [question]);

	// Main grows a prelude the feature branch rebases onto, so every pre-image line shifts down.
	await git(root, "checkout", "main");
	await write(root, "src/app.ts", `${numbered("prelude", 5)}${numbered("app", 30)}`);
	await commit(root, "Add a prelude");
	await git(root, "checkout", "feature");
	await git(root, "rebase", "main");
	const second = await prepareRun(["main", "HEAD"], root);

	const [carried] = storedThreads(root, second.manifest.runId);
	expect(carried?.anchor).toEqual(anchoredAt("src/app.ts", 27, 30));
	expect(await anchoredLine(second, "src/app.ts", 30)).toBe("app line twenty-five");
	expect(await anchoredLine(first, "src/app.ts", 25)).toBe("app line twenty-five");
});

test("a rewritten unit carries its thread to the line the fix now occupies", async () => {
	const root = await repository({ "src/app.ts": numbered("app", 30) });
	await write(root, "src/app.ts", replaceLine(numbered("app", 30), 25, "app line twenty-five"));
	await commit(root, "Feature work");
	const first = await prepareRun(["main", "HEAD"], root);
	await narrate(first, [
		chapter({ id: "app", order: 1, hunkRefs: [{ filePath: "src/app.ts", oldStart: 22 }] }),
	]);
	seedThreads(root, first.manifest.runId, [
		feedback({
			index: 1,
			runId: first.manifest.runId,
			anchor: anchoredAt("src/app.ts", 22, 25),
			body: "Spell the number out or leave it as digits?",
		}),
	]);

	// The fix answers the thread and adds a header above it, so the reworded line sits two lower.
	const fixed = replaceLine(numbered("app", 30), 25, "app line 25, fixed");
	await write(root, "src/app.ts", `${numbered("header", 2)}${fixed}`);
	await commit(root, "Address the review");
	const second = await prepareRun(["main", "HEAD"], root);

	const [carried] = storedThreads(root, second.manifest.runId);
	expect(carried?.anchor).toEqual(anchoredAt("src/app.ts", 22, 27));
	expect(await anchoredLine(second, "src/app.ts", 27)).toBe("app line 25, fixed");
	expect((await loadRunDelta(second))?.unnarrated).toContainEqual({
		filePath: "src/app.ts",
		oldStart: 22,
		status: "modified",
	});
});

test("re-preparing an unchanged scope carries nothing a second time", async () => {
	const root = await repository({ "src/alpha.ts": numbered("alpha", 20) });
	await write(root, "src/alpha.ts", replaceLine(numbered("alpha", 20), 5, "alpha line five"));
	await commit(root, "Feature work");
	const first = await prepareRun(["main", "HEAD"], root);
	await narrate(first, [
		chapter({ id: "alpha", order: 1, hunkRefs: [{ filePath: "src/alpha.ts", oldStart: 2 }] }),
	]);
	seedThreads(root, first.manifest.runId, [
		feedback({
			index: 1,
			runId: first.manifest.runId,
			anchor: anchoredAt("src/alpha.ts", 2, 5),
			body: "Worth a comment above this?",
		}),
	]);

	await write(root, "src/alpha.ts", replaceLine(numbered("alpha", 20), 5, "alpha line 5, fixed"));
	await commit(root, "Address the review");
	const second = await prepareRun(["main", "HEAD"], root);
	const migrated = readThreadStoreFile(threadStorePath(root));

	const again = await prepareRun(["main", "HEAD"], root);
	expect(again.manifest.runId).toBe(second.manifest.runId);
	expect(readThreadStoreFile(threadStorePath(root))).toEqual(migrated);
});

test("patch ranges remap atomically and orphan when any segment disappears", async () => {
	const baseline = numbered("app", 35);
	const root = await repository({ "src/app.ts": baseline });
	let changed = replaceLine(baseline, 5, "app line five");
	changed = replaceLine(changed, 25, "app line twenty-five");
	await write(root, "src/app.ts", changed);
	await commit(root, "Feature work");
	const first = await prepareRun(["main", "HEAD"], root);
	await narrate(first, [
		chapter({
			id: "app",
			order: 1,
			hunkRefs: [
				{ filePath: "src/app.ts", oldStart: 2 },
				{ filePath: "src/app.ts", oldStart: 22 },
			],
		}),
	]);
	const anchor: ThreadAnchor = {
		kind: THREAD_ANCHOR_KIND.PATCH,
		filePath: "src/app.ts",
		ranges: [
			{ oldStart: 2, side: "additions", startLine: 5, endLine: 5 },
			{ oldStart: 22, side: "additions", startLine: 25, endLine: 25 },
		],
	};
	seedThreads(root, first.manifest.runId, [
		feedback({
			index: 1,
			runId: first.manifest.runId,
			anchor,
			body: "These two changes form one concern",
		}),
	]);

	await write(root, "src/app.ts", replaceLine(baseline, 5, "app line 5, fixed"));
	await commit(root, "Address part of the review");
	const second = await prepareRun(["main", "HEAD"], root);
	const [carried] = storedThreads(root, second.manifest.runId);

	expect(carried?.migrationOrphaned).toBe(true);
	expect(carried?.anchor).toEqual(anchor);
});
