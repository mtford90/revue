import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";
import { parsePatch } from "@revue/diff";
import {
	type ContextExcerpt,
	emptyThreadStoreFile,
	type PatchThreadRange,
	type RevueChaptersFile,
	THREAD_ANCHOR_KIND,
	THREAD_AUTHOR_KIND,
	THREAD_STATUS,
	type ThreadAnchor,
	threadStoreFileSchema,
} from "@revue/types";
import { loadReviewRun } from "./load.ts";
import {
	createThread,
	createThreadMessage,
	defaultThreadsPath,
	loadValidatedThreads,
	openThreadStore,
	persistThreadStoreFile,
	readThreadStoreFile,
	resolveHumanAuthor,
	ThreadStoreError,
	threadSendState,
	unsentThreads,
} from "./threads.ts";

const anchor: ThreadAnchor = {
	kind: THREAD_ANCHOR_KIND.HUNK,
	filePath: "src/value.ts",
	oldStart: 4,
	side: "additions",
	startLine: 8,
	endLine: 10,
};

const human = { kind: THREAD_AUTHOR_KIND.HUMAN, name: "Ada Reviewer" };
const agent = { kind: THREAD_AUTHOR_KIND.AGENT, name: "Review agent" };
const ids = [
	"00000000-0000-4000-8000-000000000001",
	"00000000-0000-4000-8000-000000000002",
	"00000000-0000-4000-8000-000000000003",
	"00000000-0000-4000-8000-000000000004",
	"00000000-0000-4000-8000-000000000005",
] as const;

const waitForPath = async (path: string, attempts = 200): Promise<void> => {
	if (await Bun.file(path).exists()) return;
	if (attempts === 0) throw new Error(`Timed out waiting for ${path}`);
	await Bun.sleep(10);
	return waitForPath(path, attempts - 1);
};

test("thread paths and human identity follow the reviewed repository", async () => {
	const repository = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "revue-thread-root-"));
	const runDirectory = join(repository, "nested", "review-run");
	try {
		execFileSync("git", ["init", "-q", repository]);
		execFileSync("git", ["-C", repository, "config", "user.name", "Repository Reviewer"]);
		await mkdir(runDirectory, { recursive: true });
		expect(defaultThreadsPath(runDirectory)).toBe(join(repository, ".revue", "threads.json"));
		expect(resolveHumanAuthor(repository)).toEqual({
			kind: THREAD_AUTHOR_KIND.HUMAN,
			name: "Repository Reviewer",
		});
		expect(resolveHumanAuthor(null).name).toBe(userInfo().username);
	} finally {
		await rm(repository, { recursive: true, force: true });
	}
});

test("concurrent processes preserve every same-run thread", async () => {
	const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "revue-thread-lock-"));
	const path = join(directory, ".revue", "threads.json");
	const go = join(directory, "go");
	const runId = "c".repeat(64);
	const moduleUrl = new URL("./threads.ts", import.meta.url).href;
	const worker = `
		import { existsSync } from "node:fs";
		import { openThreadStore } from ${JSON.stringify(moduleUrl)};
		const store = openThreadStore(process.env.THREAD_PATH, process.env.RUN_ID);
		await Bun.write(process.env.READY_PATH, "ready");
		const wait = async () => {
			if (existsSync(process.env.GO_PATH)) return;
			await Bun.sleep(5);
			return wait();
		};
		await wait();
		store.create(${JSON.stringify(anchor)}, ${JSON.stringify(agent)}, process.env.BODY, {
			id: process.env.THREAD_ID,
			messageId: process.env.MESSAGE_ID,
			createdAt: process.env.CREATED_AT,
		});
	`;
	const spawnWriter = (index: 0 | 1) => {
		const ready = join(directory, `ready-${index}`);
		const child = Bun.spawn([process.execPath, "-e", worker], {
			cwd: process.cwd(),
			env: {
				...process.env,
				THREAD_PATH: path,
				RUN_ID: runId,
				READY_PATH: ready,
				GO_PATH: go,
				BODY: index === 0 ? "First writer" : "Second writer",
				THREAD_ID: ids[index * 2],
				MESSAGE_ID: ids[index * 2 + 1],
				CREATED_AT: `2026-08-02T10:00:0${index}.000Z`,
			},
			stderr: "pipe",
		});
		return { child, ready };
	};
	try {
		const writers = [spawnWriter(0), spawnWriter(1)];
		await Promise.all(writers.map(({ ready }) => waitForPath(ready)));
		await writeFile(go, "go");
		const exitCodes = await Promise.all(writers.map(({ child }) => child.exited));
		if (exitCodes.some((code) => code !== 0)) {
			const errors = await Promise.all(
				writers.map(({ child }) => new Response(child.stderr).text()),
			);
			throw new Error(errors.join("\n"));
		}
		expect(
			openThreadStore(path, runId)
				.get()
				.map((thread) => thread.messages[0]?.body),
		).toEqual(["First writer", "Second writer"]);
		expect(
			(await readdir(join(directory, ".revue"))).filter((name) => name.endsWith(".lock")),
		).toEqual([]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("thread stores preserve duplicate anchors, authored replies, and lifecycle changes", async () => {
	const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "revue-threads-"));
	const path = join(directory, ".revue", "threads.json");
	const runA = "a".repeat(64);
	const runB = "b".repeat(64);
	try {
		const firstStore = openThreadStore(path, runA);
		const first = firstStore.create(anchor, human, "First thought", {
			id: ids[0],
			messageId: ids[1],
			createdAt: "2026-08-02T10:00:00.000Z",
		});
		const second = firstStore.create(anchor, agent, "Second thought", {
			id: ids[2],
			messageId: ids[3],
			createdAt: "2026-08-02T10:00:01.000Z",
		});
		expect(first.id).not.toBe(second.id);
		expect(firstStore.get().map((thread) => thread.messages[0]?.body)).toEqual([
			"First thought",
			"Second thought",
		]);

		const replied = firstStore.reply(first.id, agent, "Agent reply", {
			id: ids[4],
			createdAt: "2026-08-02T09:59:59.000Z",
		});
		expect(replied.messages.map((message) => message.id)).toEqual([ids[1], ids[4]]);
		expect(replied.messages[1]).toMatchObject({ author: agent, body: "Agent reply" });
		expect(() => firstStore.deleteMessage(first.id, ids[1])).toThrow("root message");
		expect(firstStore.deleteMessage(first.id, ids[4]).body).toBe("Agent reply");

		const otherStore = openThreadStore(path, runB);
		expect(otherStore.get()).toEqual([]);
		otherStore.create({ ...anchor, startLine: 9, endLine: 9 }, agent, "Other run");
		expect(openThreadStore(path, runA).get()).toHaveLength(2);

		expect(firstStore.markDealt(first.id).status).toBe(THREAD_STATUS.DEALT_WITH);
		expect(firstStore.reopen(first.id).status).toBe(THREAD_STATUS.OPEN);
		expect(firstStore.delete(second.id)).toEqual(second);
		expect(firstStore.get().map((thread) => thread.id)).toEqual([first.id]);

		const persisted = readThreadStoreFile(path);
		expect(threadStoreFileSchema.parse(persisted)).toEqual(persisted);
		expect(
			(await readdir(join(directory, ".revue"))).filter(
				(name) => name.endsWith(".tmp") || name.endsWith(".lock"),
			),
		).toEqual([]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

// ── Excerpt anchors against the frozen context ────────────────────────────
const sampleRun = resolve(import.meta.dir, "../../../examples/sample-run");
const CITED: ContextExcerpt = { filePath: "src/lib/apiClient.ts", startLine: 1, endLine: 3 };
const QUOTED_LINES = ["export class ApiClient {", "  constructor() {}", "}"];

/**
 * A copy of the committed run narrated with one frozen citation, so re-narrating it is a matter
 * of rewriting two files rather than of reaching for a fixture per scenario.
 */
const narratedRun = async (root: string, cited: ContextExcerpt[]) => {
	const directory = join(root, "run");
	if (!(await Bun.file(join(directory, "run.json")).exists())) {
		await mkdir(join(root, ".git"), { recursive: true });
		await cp(sampleRun, directory, { recursive: true });
	}
	const chapters = (await Bun.file(join(sampleRun, "chapters.json")).json()) as RevueChaptersFile;
	await writeFile(
		join(directory, "chapters.json"),
		`${JSON.stringify({
			...chapters,
			chapters: chapters.chapters.map((chapter, index) =>
				index === 0 ? { ...chapter, excerpts: cited } : chapter,
			),
		})}\n`,
	);
	const runId = (await Bun.file(join(directory, "run.json")).json()).runId as string;
	await writeFile(
		join(directory, "context.json"),
		`${JSON.stringify({
			runId,
			source: { kind: "commit", revision: "0".repeat(40) },
			excerpts: cited.map((excerpt) => ({
				...excerpt,
				lines: QUOTED_LINES,
				fileSha256: "c".repeat(64),
			})),
			unresolved: [],
		})}\n`,
	);
	return { directory, runId, threadsPath: join(root, ".revue", "threads.json") };
};

const excerptAnchor = (startLine: number, endLine: number): ThreadAnchor => ({
	kind: THREAD_ANCHOR_KIND.EXCERPT,
	filePath: CITED.filePath,
	startLine,
	endLine,
});

test("excerpt anchors resolve against the frozen context, and orphans neither throw nor vanish", async () => {
	const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "revue-excerpt-threads-"));
	try {
		const { directory, runId, threadsPath } = await narratedRun(root, [CITED]);
		const store = openThreadStore(threadsPath, runId);
		// Pinned creation times, because same-millisecond threads otherwise sort by random UUID.
		const quoted = store.create(excerptAnchor(2, 3), agent, "Does this caller still hold?", {
			createdAt: "2026-08-07T10:00:00.000Z",
		});
		const outside = store.create(excerptAnchor(9, 9), agent, "Anchored past the quotation", {
			createdAt: "2026-08-07T10:00:01.000Z",
		});

		const narrated = await loadReviewRun(directory);
		const loaded = loadValidatedThreads(threadsPath, narrated);

		expect(loaded.threads.map((thread) => thread.id)).toEqual([quoted.id, outside.id]);
		expect(loaded.orphaned.map((entry) => entry.thread.id)).toEqual([outside.id]);
		expect(loaded.orphaned[0]?.reason).toContain("no frozen excerpt");

		// Re-narrating at another depth drops the citation. That is narration changing, not
		// corruption: the run must still load and the feedback must still be there.
		await narratedRun(root, []);
		const rezoomed = await loadReviewRun(directory);
		const afterRezoom = loadValidatedThreads(threadsPath, rezoomed);

		expect(afterRezoom.threads.map((thread) => thread.id)).toEqual([quoted.id, outside.id]);
		expect(afterRezoom.orphaned.map((entry) => entry.thread.id)).toEqual([quoted.id, outside.id]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("every patch range validates independently against original hunk authority", async () => {
	const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "revue-patch-anchor-"));
	try {
		const { directory, runId, threadsPath } = await narratedRun(root, [CITED]);
		const run = await loadReviewRun(directory);
		const parsed = parsePatch(run.patch);
		const file = parsed.find((candidate) => candidate.metadata.hunks.length > 0);
		const hunk = file?.metadata.hunks[0];
		if (!file || !hunk) throw new Error("sample run has no textual hunk");
		const side = hunk.additionCount > 0 ? "additions" : "deletions";
		const start = side === "additions" ? hunk.additionStart : hunk.deletionStart;
		const thread = openThreadStore(threadsPath, runId).create(
			{
				kind: THREAD_ANCHOR_KIND.PATCH,
				filePath: file.path,
				ranges: [
					{ oldStart: hunk.deletionStart, side, startLine: start, endLine: start },
					{ oldStart: hunk.deletionStart, side, startLine: start + 999, endLine: start + 999 },
				],
			},
			agent,
			"One concern, one invalid segment",
		);
		expect(() => loadValidatedThreads(threadsPath, run)).toThrow("patch range 2");

		const store = readThreadStoreFile(threadsPath);
		const migrated = (store.runs[runId] ?? []).map((entry) => ({
			...entry,
			migratedFrom: "b".repeat(64),
		}));
		persistThreadStoreFile(threadsPath, { ...store, runs: { [runId]: migrated } });
		// Generic carried-anchor leniency is historical hunk behaviour only. Patch migrations must
		// carry prep's explicit atomic-orphan marker or the unresolved anchor is corrupt.
		expect(() => loadValidatedThreads(threadsPath, run)).toThrow("patch range 2");

		persistThreadStoreFile(threadsPath, {
			...store,
			runs: {
				[runId]: migrated.map((entry) => ({ ...entry, migrationOrphaned: true })),
			},
		});
		const marked = loadValidatedThreads(threadsPath, run);
		expect(marked.orphaned.map((entry) => entry.thread.id)).toEqual([thread.id]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("persisted patch anchors must already be canonical against the pinned patch", async () => {
	const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "revue-canonical-anchor-"));
	try {
		const { directory, runId, threadsPath } = await narratedRun(root, [CITED]);
		const run = await loadReviewRun(directory);
		const parsed = parsePatch(run.patch);
		const file = parsed.find((candidate) =>
			candidate.metadata.hunks.some((hunk) => hunk.additionCount >= 3),
		);
		const hunk = file?.metadata.hunks.find((candidate) => candidate.additionCount >= 3);
		if (!file || !hunk) throw new Error("sample run has no three-line addition authority");
		const start = hunk.additionStart;
		const cases: Array<[PatchThreadRange, ...PatchThreadRange[]]> = [
			[
				{
					oldStart: hunk.deletionStart,
					side: "additions" as const,
					startLine: start + 1,
					endLine: start + 1,
				},
				{
					oldStart: hunk.deletionStart,
					side: "additions" as const,
					startLine: start,
					endLine: start,
				},
			],
			[
				{
					oldStart: hunk.deletionStart,
					side: "additions" as const,
					startLine: start,
					endLine: start,
				},
				{
					oldStart: hunk.deletionStart,
					side: "additions" as const,
					startLine: start + 1,
					endLine: start + 1,
				},
			],
			[
				{
					oldStart: hunk.deletionStart,
					side: "additions" as const,
					startLine: start,
					endLine: start + 1,
				},
				{
					oldStart: hunk.deletionStart,
					side: "additions" as const,
					startLine: start + 1,
					endLine: start + 2,
				},
			],
			[
				{
					oldStart: hunk.deletionStart,
					side: "additions" as const,
					startLine: start,
					endLine: start,
				},
				{
					oldStart: hunk.deletionStart,
					side: "additions" as const,
					startLine: start,
					endLine: start,
				},
			],
		];

		for (const [index, ranges] of cases.entries()) {
			persistThreadStoreFile(threadsPath, emptyThreadStoreFile());
			openThreadStore(threadsPath, runId).create(
				{ kind: THREAD_ANCHOR_KIND.PATCH, filePath: file.path, ranges },
				agent,
				`Non-canonical case ${index}`,
			);
			expect(() => loadValidatedThreads(threadsPath, run)).toThrow("canonical");
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a corrupt hunk anchor still refuses to load", async () => {
	const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "revue-hunk-anchor-"));
	try {
		const { directory, runId, threadsPath } = await narratedRun(root, [CITED]);
		openThreadStore(threadsPath, runId).create(
			{ ...anchor, filePath: "src/lib/backoff.ts", oldStart: 0, startLine: 999, endLine: 999 },
			agent,
			"Stale feedback",
		);
		const run = await loadReviewRun(directory);
		expect(() => loadValidatedThreads(threadsPath, run)).toThrow(ThreadStoreError);
		expect(() => loadValidatedThreads(threadsPath, run)).toThrow("outside that review unit");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("the same anchor, carried from a superseded run, is orphaned instead", async () => {
	const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "revue-carried-anchor-"));
	try {
		const { directory, runId, threadsPath } = await narratedRun(root, [CITED]);
		const thread = openThreadStore(threadsPath, runId).create(
			{ ...anchor, filePath: "src/lib/backoff.ts", oldStart: 0, startLine: 999, endLine: 999 },
			agent,
			"The fix deleted the code this was about",
		);
		// Prep stamps a thread it carried with the run it came from. Supersession deletes code as a
		// matter of course, so a carried anchor may honestly have nothing left to point at.
		const store = readThreadStoreFile(threadsPath);
		persistThreadStoreFile(threadsPath, {
			...store,
			runs: {
				[runId]: (store.runs[runId] ?? []).map((entry) => ({
					...entry,
					migratedFrom: "b".repeat(64),
				})),
			},
		});

		const run = await loadReviewRun(directory);
		const loaded = loadValidatedThreads(threadsPath, run);

		expect(loaded.threads.map((entry) => entry.id)).toEqual([thread.id]);
		expect(loaded.orphaned.map((entry) => entry.thread.id)).toEqual([thread.id]);
		expect(loaded.orphaned[0]?.reason).toContain("carried from a superseded run");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("reload reads the replies another process wrote, which the cache alone cannot see", async () => {
	const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "revue-thread-reload-"));
	const path = join(directory, ".revue", "threads.json");
	const runId = "a".repeat(64);
	try {
		const reviewer = openThreadStore(path, runId);
		const thread = reviewer.create(anchor, human, "Explain the budget", { id: ids[0] });

		openThreadStore(path, runId).reply(thread.id, agent, "It is the retry budget", { id: ids[1] });

		expect(reviewer.get()[0]?.messages).toHaveLength(1);
		expect(reviewer.reload()[0]?.messages.map((message) => message.body)).toEqual([
			"Explain the budget",
			"It is the retry budget",
		]);
		expect(reviewer.get()[0]?.messages).toHaveLength(2);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

// ── The unsent rule ─────────────────────────────────────────────────────────

const unsentRunId = "c".repeat(64);
const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 10, minute)).toISOString();

const humanThread = (id: string, minute: number) =>
	createThread(unsentRunId, anchor, human, `Line ${minute}?`, { id, createdAt: at(minute) });

test("a thread the last handoff never named is unsent, however old its comment is", () => {
	const other = humanThread(ids[0], 0);
	const batch = { threadIds: [ids[1]], requestedAt: at(30) };

	expect(unsentThreads([other], batch).map((thread) => thread.id)).toEqual([ids[0]]);
});

test("a thread the last handoff named, unanswered since, is sent", () => {
	const carried = humanThread(ids[0], 0);
	const batch = { threadIds: [ids[0]], requestedAt: at(30) };

	expect(unsentThreads([carried], batch)).toEqual([]);
});

test("a human message written after the handoff makes a sent thread unsent again", () => {
	const base = humanThread(ids[0], 0);
	const spokenTo = {
		...base,
		messages: [
			...base.messages,
			createThreadMessage(human, "Still waiting", { createdAt: at(40) }),
		],
	};
	const batch = { threadIds: [ids[0]], requestedAt: at(30) };

	expect(unsentThreads([spokenTo], batch).map((thread) => thread.id)).toEqual([ids[0]]);
});

test("an agent's reply, a closed thread, and no handoff at all", () => {
	const answered = {
		...humanThread(ids[0], 0),
		messages: [
			...humanThread(ids[0], 0).messages,
			createThreadMessage(agent, "Fixed", { createdAt: at(40) }),
		],
	};
	const closed = { ...humanThread(ids[1], 0), status: THREAD_STATUS.DEALT_WITH };
	const open = humanThread(ids[2], 0);

	expect(unsentThreads([answered, closed, open], null).map((thread) => thread.id)).toEqual([
		ids[2],
	]);
});

test("a thread reads as sent only once a handoff has carried it and the agent has yet to answer", () => {
	const carried = humanThread(ids[0], 0);
	const batch = { threadIds: [ids[0]], requestedAt: at(30) };
	const answered = {
		...carried,
		messages: [...carried.messages, createThreadMessage(agent, "Fixed", { createdAt: at(40) })],
	};
	const closed = { ...carried, status: THREAD_STATUS.DEALT_WITH };

	expect(threadSendState(carried, batch)).toBe("sent");
	expect(threadSendState(carried, null)).toBe("unsent");
	expect(threadSendState(answered, batch)).toBeNull();
	expect(threadSendState(closed, batch)).toBeNull();
	expect(threadSendState(humanThread(ids[1], 0), batch)).toBe("unsent");
});
