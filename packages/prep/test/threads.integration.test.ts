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

test("historical v1 hunk and excerpt stores migrate without reinterpretation", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-thread-v1-"));
	repositories.push(root);
	const path = threadStorePath(root);
	const runId = "a".repeat(64);
	await mkdir(join(root, ".revue"), { recursive: true });
	const message = {
		id: identifier(90),
		author: { kind: THREAD_AUTHOR_KIND.HUMAN, name: "Ada Reviewer" },
		body: "Historical feedback",
		createdAt: "2026-08-02T10:00:00.000Z",
	};
	await writeFile(
		path,
		`${JSON.stringify({
			schemaVersion: 1,
			runs: {
				[runId]: [
					{
						id: identifier(91),
						runId,
						anchor: {
							filePath: "src/value.ts",
							oldStart: 4,
							side: "additions",
							startLine: 8,
							endLine: 8,
						},
						status: THREAD_STATUS.OPEN,
						createdAt: message.createdAt,
						messages: [message],
					},
					{
						id: identifier(92),
						runId,
						anchor: {
							kind: THREAD_ANCHOR_KIND.EXCERPT,
							filePath: "src/caller.ts",
							startLine: 12,
							endLine: 13,
						},
						status: THREAD_STATUS.OPEN,
						createdAt: message.createdAt,
						messages: [{ ...message, id: identifier(93) }],
					},
				],
			},
		})}\n`,
	);

	const migrated = readThreadStoreFile(path);
	expect(migrated.schemaVersion).toBe(2);
	expect(migrated.runs[runId]?.map((thread) => thread.anchor.kind)).toEqual([
		THREAD_ANCHOR_KIND.HUNK,
		THREAD_ANCHOR_KIND.EXCERPT,
	]);
});

test("the v1 reader rejects patch-era fields instead of reinterpreting them", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-thread-v1-strict-"));
	repositories.push(root);
	const path = threadStorePath(root);
	const runId = "a".repeat(64);
	await mkdir(join(root, ".revue"), { recursive: true });
	await writeFile(
		path,
		`${JSON.stringify({
			schemaVersion: 1,
			runs: {
				[runId]: [
					{
						id: identifier(94),
						runId,
						anchor: {
							kind: THREAD_ANCHOR_KIND.PATCH,
							filePath: "src/value.ts",
							ranges: [{ oldStart: 4, side: "additions", startLine: 8, endLine: 8 }],
						},
						status: THREAD_STATUS.OPEN,
						createdAt: "2026-08-02T10:00:00.000Z",
						messages: [
							{
								id: identifier(95),
								author: { kind: THREAD_AUTHOR_KIND.HUMAN, name: "Ada Reviewer" },
								body: "Not historical",
								createdAt: "2026-08-02T10:00:00.000Z",
							},
						],
					},
				],
			},
		})}\n`,
	);

	expect(() => readThreadStoreFile(path)).toThrow("threads schema");
});

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

/**
 * The shape of the reported fault: a narrated run with feedback, then a prep the agent never
 * narrated, which is where the feedback now sits.
 */
const pendingReview = async () => {
	const root = await repository({
		"src/alpha.ts": numbered("alpha", 20),
		"src/beta.ts": numbered("beta", 20),
	});
	await write(root, "src/alpha.ts", replaceLine(numbered("alpha", 20), 5, "alpha line five"));
	await write(root, "src/beta.ts", replaceLine(numbered("beta", 20), 5, "beta line five"));
	await commit(root, "Feature work");
	const narrated = await prepareRun(["main", "HEAD"], root);
	await narrate(narrated, [
		chapter({ id: "alpha", order: 1, hunkRefs: [{ filePath: "src/alpha.ts", oldStart: 2 }] }),
		chapter({ id: "beta", order: 2, hunkRefs: [{ filePath: "src/beta.ts", oldStart: 2 }] }),
	]);
	const onAlpha = feedback({
		index: 1,
		runId: narrated.manifest.runId,
		anchor: anchoredAt("src/alpha.ts", 2, 5),
		body: "Why five?",
	});
	seedThreads(root, narrated.manifest.runId, [onAlpha]);
	await write(root, "src/beta.ts", replaceLine(numbered("beta", 20), 5, "beta line 5, fixed"));
	await commit(root, "Fix beta");
	const pending = await prepareRun(["main", "HEAD"], root);
	expect(storedThreads(root, pending.manifest.runId).map((thread) => thread.id)).toEqual([
		onAlpha.id,
	]);
	return { root, narrated, pending, onAlpha };
};

test("feedback left on a pending run follows the next prep of the review", async () => {
	const { root, narrated, pending, onAlpha } = await pendingReview();
	await write(
		root,
		"src/beta.ts",
		replaceLine(numbered("beta", 20), 5, "beta line 5, fixed twice"),
	);
	await commit(root, "Fix beta again");

	const latest = await prepareRun(["main", "HEAD"], root);

	// The narrated run is still the one this continues, so its untouched chapter carries...
	expect(latest.manifest.supersedes).toBe(narrated.manifest.runId);
	expect((await loadRunDelta(latest))?.carried.map((entry) => entry.id)).toEqual(["alpha"]);
	// ...and the feedback comes along from the pending run it was left on, in one conversation.
	expect(storedThreads(root, narrated.manifest.runId)).toEqual([]);
	expect(storedThreads(root, pending.manifest.runId)).toEqual([]);
	const [carried] = storedThreads(root, latest.manifest.runId);
	expect(carried?.id).toBe(onAlpha.id);
	expect(carried?.migratedFrom).toBe(pending.manifest.runId);
	expect(carried?.anchor).toEqual(onAlpha.anchor);
	expect(latest.warnings).toEqual([]);
});

test("--carry-from a pending run continues the narrated run before it", async () => {
	const { root, narrated, pending, onAlpha } = await pendingReview();
	await write(
		root,
		"src/beta.ts",
		replaceLine(numbered("beta", 20), 5, "beta line 5, fixed twice"),
	);
	await commit(root, "Fix beta again");

	const latest = await prepareRun(["main", "HEAD", "--carry-from", pending.manifest.runId], root);

	expect(latest.manifest.supersedes).toBe(narrated.manifest.runId);
	expect((await loadRunDelta(latest))?.carried.map((entry) => entry.id)).toEqual(["alpha"]);
	expect(storedThreads(root, latest.manifest.runId).map((thread) => thread.migratedFrom)).toEqual([
		pending.manifest.runId,
	]);
	expect(storedThreads(root, latest.manifest.runId)[0]?.id).toBe(onAlpha.id);
	expect(latest.warnings).toEqual([expect.stringContaining("continues its narrated ancestor")]);
});

test("prep says when it strands feedback and when every read mark starts over", async () => {
	const { root, narrated, pending } = await pendingReview();
	await write(
		root,
		"src/alpha.ts",
		replaceLine(numbered("alpha", 20), 5, "alpha line 5, rewritten"),
	);
	await commit(root, "Rewrite alpha");

	const fresh = await prepareRun(["main", "HEAD", "--no-carry"], root);
	expect(fresh.manifest.supersedes).toBeUndefined();
	expect(fresh.warnings).toEqual([
		`1 open thread on run ${pending.manifest.runId.slice(0, 12)} do not follow this run; pass --carry-from ${pending.manifest.runId} to move them`,
	]);

	await write(root, "src/beta.ts", replaceLine(numbered("beta", 20), 5, "beta line 5, rewritten"));
	await commit(root, "Rewrite beta");
	const rewritten = await prepareRun(["main", "HEAD"], root);
	expect(rewritten.manifest.supersedes).toBe(narrated.manifest.runId);
	expect(rewritten.warnings).toEqual([
		`none of the 2 chapters of ${narrated.manifest.runId.slice(0, 12)} carried forward: every read mark on that run starts over`,
	]);
	expect(
		storedThreads(root, rewritten.manifest.runId).map((thread) => thread.migratedFrom),
	).toEqual([pending.manifest.runId]);
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

test("a thread on revealed context follows the pinned file, and orphans when the file leaves", async () => {
	const root = await repository({
		"src/alpha.ts": numbered("alpha", 40),
		"src/beta.ts": numbered("beta", 10),
	});
	await write(root, "src/alpha.ts", replaceLine(numbered("alpha", 40), 30, "alpha line thirty"));
	await write(root, "src/beta.ts", replaceLine(numbered("beta", 10), 3, "beta line three"));
	await commit(root, "Feature work");
	const first = await prepareRun(["main", "HEAD"], root);
	await narrate(first, [
		chapter({ id: "alpha", order: 1, hunkRefs: [{ filePath: "src/alpha.ts", oldStart: 27 }] }),
		chapter({ id: "beta", order: 2, hunkRefs: [{ filePath: "src/beta.ts", oldStart: 1 }] }),
	]);
	const contextAnchor = (startLine: number, endLine: number): ThreadAnchor => ({
		kind: THREAD_ANCHOR_KIND.CONTEXT,
		filePath: "src/alpha.ts",
		startLine,
		endLine,
	});
	const onContext = feedback({
		index: 1,
		runId: first.manifest.runId,
		anchor: contextAnchor(5, 6),
		body: "These unchanged lines look wrong too.",
	});
	seedThreads(root, first.manifest.runId, [onContext]);

	// Two lines added at the top push the commented lines down without changing them.
	await write(
		root,
		"src/alpha.ts",
		`alpha header\nalpha header two\n${replaceLine(numbered("alpha", 40), 30, "alpha line thirty")}`,
	);
	await commit(root, "Add a header");
	const second = await prepareRun(["main", "HEAD"], root);
	const [shifted] = storedThreads(root, second.manifest.runId);
	expect(shifted?.anchor).toEqual(contextAnchor(7, 8));
	expect(shifted?.migrationOrphaned).toBeUndefined();

	// Reverting the file takes it out of the run: the thread stays, detached, where it was written.
	await write(root, "src/alpha.ts", numbered("alpha", 40));
	await commit(root, "Revert alpha");
	const third = await prepareRun(["main", "HEAD"], root);
	const [orphaned] = storedThreads(root, third.manifest.runId);
	expect(orphaned?.anchor).toEqual(contextAnchor(7, 8));
	expect(orphaned?.migrationOrphaned).toBe(true);
	expect(third.warnings).toEqual([
		"1 carried thread point at code this run no longer has; they are listed as orphaned",
	]);
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
		feedback({
			index: 2,
			runId: first.manifest.runId,
			anchor: {
				kind: THREAD_ANCHOR_KIND.PATCH,
				filePath: "src/app.ts",
				ranges: [
					{ oldStart: 2, side: "additions", startLine: 5, endLine: 5 },
					{ oldStart: 2, side: "additions", startLine: 6, endLine: 6 },
				],
			},
			body: "These adjacent lines are one range",
		}),
	]);

	await write(root, "src/app.ts", replaceLine(baseline, 5, "app line 5, fixed"));
	await commit(root, "Address part of the review");
	const second = await prepareRun(["main", "HEAD"], root);
	const [carried, canonical] = storedThreads(root, second.manifest.runId);

	expect(carried?.migrationOrphaned).toBe(true);
	expect(carried?.anchor).toEqual(anchor);
	expect(canonical?.anchor).toEqual({
		kind: THREAD_ANCHOR_KIND.PATCH,
		filePath: "src/app.ts",
		ranges: [{ oldStart: 2, side: "additions", startLine: 5, endLine: 6 }],
	});

	// Once the atomic anchor is orphaned, a later run must not reinterpret its old coordinates even
	// when the missing hunk returns and would make those coordinates remappable again.
	await narrate(second, [
		chapter({ id: "app-fix", order: 1, hunkRefs: [{ filePath: "src/app.ts", oldStart: 2 }] }),
	]);
	let thirdChange = replaceLine(baseline, 5, "app line 5, fixed");
	thirdChange = replaceLine(thirdChange, 25, "app line 25, fixed later");
	await write(root, "src/app.ts", thirdChange);
	await commit(root, "Address the rest of the review");
	const third = await prepareRun(["main", "HEAD"], root);
	const [stillOrphaned] = storedThreads(root, third.manifest.runId);

	expect(stillOrphaned?.migrationOrphaned).toBe(true);
	expect(stillOrphaned?.migratedFrom).toBe(second.manifest.runId);
	expect(stillOrphaned?.anchor).toEqual(anchor);
});

/** A file whose review unit is one long added block, as a regenerated implementation produces. */
const withBlock = (block: readonly string[]): string =>
	`${numbered("service", 6)}${block.map((line) => `${line}\n`).join("")}`;

const ALPHA = ["alpha one", "alpha two", "alpha three", "alpha four"];
const BETA = [
	"beta one",
	"beta two",
	"beta three",
	"beta four",
	"beta five",
	"beta six",
	"beta seven",
	"beta eight",
];

test("a carried anchor whose code the change deleted is orphaned, not re-aimed at what replaced it", async () => {
	const root = await repository({ "src/service.ts": numbered("service", 6) });
	await write(root, "src/service.ts", withBlock([...ALPHA, ...BETA]));
	await commit(root, "Add both helpers");
	const first = await prepareRun(["main", "HEAD"], root);
	await narrate(first, [
		chapter({ id: "service", order: 1, hunkRefs: [{ filePath: "src/service.ts", oldStart: 4 }] }),
	]);
	const anchor: ThreadAnchor = {
		kind: THREAD_ANCHOR_KIND.PATCH,
		filePath: "src/service.ts",
		ranges: [{ oldStart: 4, side: "additions", startLine: 7, endLine: 10 }],
	};
	seedThreads(root, first.manifest.runId, [
		feedback({
			index: 1,
			runId: first.manifest.runId,
			anchor,
			body: "Fold this into the other one",
		}),
	]);

	// The agent answers by deleting the block the thread was written on. What now occupies those
	// line numbers is the helper that survived, which the thread never had anything to say about.
	await write(root, "src/service.ts", withBlock(BETA));
	await commit(root, "Fold alpha into beta");
	const second = await prepareRun(["main", "HEAD"], root);

	const [carried] = storedThreads(root, second.manifest.runId);
	expect(await anchoredLine(second, "src/service.ts", 7)).toBe("beta one");
	expect(carried?.migrationOrphaned).toBe(true);
	expect(carried?.anchor).toEqual(anchor);
});

test("a carried anchor follows its code when the change only moved it inside the unit", async () => {
	const root = await repository({ "src/service.ts": numbered("service", 6) });
	await write(root, "src/service.ts", withBlock([...ALPHA, ...BETA]));
	await commit(root, "Add both helpers");
	const first = await prepareRun(["main", "HEAD"], root);
	await narrate(first, [
		chapter({ id: "service", order: 1, hunkRefs: [{ filePath: "src/service.ts", oldStart: 4 }] }),
	]);
	seedThreads(root, first.manifest.runId, [
		feedback({
			index: 1,
			runId: first.manifest.runId,
			anchor: {
				kind: THREAD_ANCHOR_KIND.PATCH,
				filePath: "src/service.ts",
				ranges: [{ oldStart: 4, side: "additions", startLine: 7, endLine: 10 }],
			},
			body: "Name the first two the same way",
		}),
	]);

	await write(root, "src/service.ts", withBlock(["gamma one", "gamma two", ...ALPHA, ...BETA]));
	await commit(root, "Introduce a helper above alpha");
	const second = await prepareRun(["main", "HEAD"], root);

	const [carried] = storedThreads(root, second.manifest.runId);
	expect(carried?.migrationOrphaned).toBeUndefined();
	expect(carried?.anchor).toEqual({
		kind: THREAD_ANCHOR_KIND.PATCH,
		filePath: "src/service.ts",
		ranges: [{ oldStart: 4, side: "additions", startLine: 9, endLine: 12 }],
	});
	expect(await anchoredLine(second, "src/service.ts", 9)).toBe("alpha one");
});
