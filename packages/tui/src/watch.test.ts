import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type RunWatchEvent, watchRun } from "./watch.ts";

// Filesystem notifications arrive when they arrive, so every wait here is far longer than the
// debounce it is proving and every assertion polls rather than sleeping a fixed time.
const DEBOUNCE_MS = 150;
const SETTLE_MS = 1_200;
const POLL_MS = 20;

const SAMPLE_MANIFEST = `${import.meta.dir}/../../../examples/sample-run/run.json`;
const CURRENT_RUN = "a".repeat(64);
const NEXT_RUN = "b".repeat(64);

const disposers: (() => void)[] = [];
const roots: string[] = [];

afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (condition: () => boolean, timeout = SETTLE_MS) => {
	const deadline = Date.now() + timeout;
	while (!condition() && Date.now() < deadline) await wait(POLL_MS);
	return condition();
};

const makeRepository = () => {
	const root = mkdtempSync(join(tmpdir(), "revue-watch-"));
	roots.push(root);
	const revue = join(root, ".revue");
	const runsDirectory = join(revue, "runs");
	mkdirSync(runsDirectory, { recursive: true });
	return {
		root,
		threadsPath: join(revue, "threads.json"),
		handoffPath: join(revue, "handoff.json"),
		runsDirectory,
	};
};

/** Replace a file the way every writer in revue does: write a sibling, then rename over the target. */
const writeAtomically = (path: string, body: string) => {
	const temporary = `${path}.${Math.random().toString(16).slice(2)}.tmp`;
	writeFileSync(temporary, body, "utf8");
	renameSync(temporary, path);
};

const writeRun = async (runsDirectory: string, runId: string, supersedes?: string) => {
	const manifest = JSON.parse(await readFile(SAMPLE_MANIFEST, "utf8"));
	const directory = join(runsDirectory, runId);
	mkdirSync(directory, { recursive: true });
	writeAtomically(
		join(directory, "run.json"),
		JSON.stringify({ ...manifest, runId, ...(supersedes ? { supersedes } : {}) }),
	);
	return directory;
};

/**
 * Start watching and hand back a settled recorder. Settling matters: the platform replays what
 * happened moments before the watch began, so a test that acts immediately measures its own setup.
 */
const startWatch = async (input: {
	threadsPath: string;
	runsDirectory: string;
	handoffPath?: string;
}) => {
	const events: RunWatchEvent[] = [];
	const dispose = watchRun({
		...input,
		runId: CURRENT_RUN,
		debounceMs: DEBOUNCE_MS,
		onEvent: (event) => events.push(event),
	});
	disposers.push(dispose);
	await wait(DEBOUNCE_MS * 4);
	events.length = 0;
	return { events, dispose };
};

const threadKinds = (events: readonly RunWatchEvent[]) =>
	events.filter((event) => event.kind === "threads-changed");

const handoffKinds = (events: readonly RunWatchEvent[]) =>
	events.filter((event) => event.kind === "handoff-changed");

test("a burst of thread-store rewrites reports as one change", async () => {
	const repository = makeRepository();
	writeAtomically(repository.threadsPath, "{}");
	const { events } = await startWatch(repository);

	for (const body of ["{ }", "{  }", "{   }"]) writeAtomically(repository.threadsPath, body);

	expect(await waitFor(() => threadKinds(events).length > 0)).toBe(true);
	await wait(SETTLE_MS);
	expect(threadKinds(events)).toHaveLength(1);
});

test("a handoff write reports as a change, and the thread store stays quiet", async () => {
	const repository = makeRepository();
	writeAtomically(repository.threadsPath, "{}");
	const { events } = await startWatch(repository);

	writeAtomically(repository.handoffPath, "{}");

	expect(await waitFor(() => handoffKinds(events).length > 0)).toBe(true);
	await wait(SETTLE_MS);
	expect(handoffKinds(events)).toHaveLength(1);
	expect(threadKinds(events)).toHaveLength(0);
});

test("a burst of handoff rewrites, temporary file and all, reports as one change", async () => {
	const repository = makeRepository();
	writeAtomically(repository.threadsPath, "{}");
	const { events } = await startWatch(repository);

	// writeAtomically already exercises the intermediate .tmp name; the burst proves the watcher
	// coalesces both that write and the rename over it into a single reported change.
	for (const body of ['{"a":1}', '{"a":2}', '{"a":3}'])
		writeAtomically(repository.handoffPath, body);

	expect(await waitFor(() => handoffKinds(events).length > 0)).toBe(true);
	await wait(SETTLE_MS);
	expect(handoffKinds(events)).toHaveLength(1);
});

test("a repository watched without a handoff path never reports a handoff change", async () => {
	const repository = makeRepository();
	writeAtomically(repository.threadsPath, "{}");
	const { events } = await startWatch({
		threadsPath: repository.threadsPath,
		runsDirectory: repository.runsDirectory,
	});

	writeAtomically(repository.handoffPath, "{}");
	await wait(SETTLE_MS);

	expect(handoffKinds(events)).toHaveLength(0);
});

test("a run that supersedes the open one stays quiet until it is narrated", async () => {
	const repository = makeRepository();
	writeAtomically(repository.threadsPath, "{}");
	const { events } = await startWatch(repository);

	const directory = await writeRun(repository.runsDirectory, NEXT_RUN, CURRENT_RUN);
	await wait(SETTLE_MS);
	expect(events).toEqual([]); // a run nobody has narrated has nothing to tell the reviewer

	writeAtomically(join(directory, "chapters.json"), '{"chapters":[]}');

	expect(await waitFor(() => events.length > 0)).toBe(true);
	expect(events[0]).toEqual({ kind: "run-superseded", runId: NEXT_RUN, directory });
});

test("a narrated run that continues someone else's lineage is not this review's business", async () => {
	const repository = makeRepository();
	writeAtomically(repository.threadsPath, "{}");
	const { events } = await startWatch(repository);

	const directory = await writeRun(repository.runsDirectory, NEXT_RUN, "c".repeat(64));
	writeAtomically(join(directory, "chapters.json"), '{"chapters":[]}');
	await wait(SETTLE_MS);

	expect(events).toEqual([]);
});

test("the disposer ends the watch", async () => {
	const repository = makeRepository();
	writeAtomically(repository.threadsPath, "{}");
	const { events, dispose } = await startWatch(repository);
	dispose();

	writeAtomically(repository.threadsPath, '{"changed":true}');
	const directory = await writeRun(repository.runsDirectory, NEXT_RUN, CURRENT_RUN);
	writeAtomically(join(directory, "chapters.json"), '{"chapters":[]}');
	await wait(SETTLE_MS);

	expect(events).toEqual([]);
});
