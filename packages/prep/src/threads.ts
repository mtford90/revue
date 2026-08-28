import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type DiffSelectionStop,
	diffSelectionStops,
	normalizeDiffSelection,
	parsePatch,
} from "@revue/diff";
import {
	emptyThreadStoreFile,
	isExcerptAnchor,
	isPatchAnchor,
	type PatchThreadRange,
	type ReviewThread,
	type ThreadAnchor,
	type ThreadStoreFile,
	threadStoreFileSchema,
} from "@revue/types";
import { z } from "zod";
import { loadPreparedRun, type PreparedRun } from "./artifact.ts";
import { matchReviewUnits, type ReviewUnitMatch, unitKey, unitSide } from "./delta.ts";

// Threads are the mutable overlay on immutable runs, so the store lives beside the runs rather than
// inside them and every writer takes the same cross-process lock. Prep writes here for one reason:
// when a run supersedes another, the feedback on the superseded run has to follow the code.

export class ThreadStoreError extends Error {}

const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 5_000;
const lockWaiter = new Int32Array(new SharedArrayBuffer(4));

type LockOwner = { pid: number; token: string };

export const threadStorePath = (repositoryRoot: string): string =>
	join(repositoryRoot, ".revue", "threads.json");

export const sortThreads = (threads: readonly ReviewThread[]): ReviewThread[] =>
	[...threads].sort(
		(left, right) =>
			left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
	);

export function readThreadStoreFile(path: string): ThreadStoreFile {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyThreadStoreFile();
		throw new ThreadStoreError(`Could not read thread store at ${path}: ${describe(error)}`);
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		throw new ThreadStoreError(`Thread store at ${path} is not valid JSON: ${describe(error)}`);
	}
	const parsed = threadStoreFileSchema.safeParse(value);
	if (!parsed.success) {
		throw new ThreadStoreError(
			`Thread store at ${path} does not match the threads schema:\n${z.prettifyError(parsed.error)}`,
		);
	}
	return parsed.data;
}

const lockOwner = (path: string): Partial<LockOwner> | null => {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Partial<LockOwner>;
	} catch {
		return null;
	}
};

const processIsAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
};

const acquireLock = (path: string, token: string, startedAt: number): void => {
	const owner: LockOwner = { pid: process.pid, token };
	try {
		writeFileSync(path, JSON.stringify(owner), { encoding: "utf8", flag: "wx", mode: 0o600 });
		return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
			throw new ThreadStoreError(
				`Could not acquire thread store lock at ${path}: ${describe(error)}`,
			);
		}
	}
	const existing = lockOwner(path);
	if (typeof existing?.pid === "number" && !processIsAlive(existing.pid)) {
		throw new ThreadStoreError(
			`Thread store has an abandoned lock from process ${existing.pid} at ${path}; remove that lock file before retrying`,
		);
	}
	if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
		throw new ThreadStoreError(`Thread store is busy: timed out waiting for lock at ${path}`);
	}
	Atomics.wait(lockWaiter, 0, 0, LOCK_RETRY_MS);
	acquireLock(path, token, startedAt);
};

const releaseLock = (path: string, token: string): void => {
	try {
		const owner = JSON.parse(readFileSync(path, "utf8")) as Partial<LockOwner>;
		if (owner.pid === process.pid && owner.token === token) rmSync(path, { force: true });
	} catch {}
};

export const withThreadStoreLock = <Value>(path: string, action: () => Value): Value => {
	mkdirSync(dirname(path), { recursive: true });
	const lockPath = `${path}.lock`;
	const token = randomUUID();
	acquireLock(lockPath, token, Date.now());
	try {
		return action();
	} finally {
		releaseLock(lockPath, token);
	}
};

export function persistThreadStoreFile(path: string, file: ThreadStoreFile): void {
	const parsed = threadStoreFileSchema.parse(file);
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(temporary, path);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw new ThreadStoreError(`Could not persist thread store at ${path}: ${describe(error)}`);
	}
}

/**
 * Where a carried anchor reads in the superseding run. A unit that came through with its content
 * intact shifts exactly, and one the change rewrote keeps the offset the reviewer commented at, so
 * feedback lands on the code that answers it. An anchor no unit of this run can hold keeps the
 * range it was written against: the run reports it as orphaned rather than moving it somewhere it
 * was never aimed.
 */
const carriedRange = (
	filePath: string,
	range: PatchThreadRange,
	matches: Map<string, ReviewUnitMatch>,
): PatchThreadRange | null => {
	const match = matches.get(unitKey(filePath, range.oldStart));
	if (!match) return null;
	const before = unitSide(match.previous, range.side);
	const after = unitSide(match.current, range.side);
	const shift = after.start - before.start;
	const startLine = range.startLine + shift;
	const endLine = range.endLine + shift;
	const outside = startLine < after.start || endLine > after.start + after.count - 1;
	if (after.count === 0 || outside) return null;
	return { ...range, oldStart: match.current.oldStart, startLine, endLine };
};

type CarriedAnchor = { anchor: ThreadAnchor; migrationOrphaned: boolean };

const carriedAnchor = (
	anchor: ThreadAnchor,
	matches: Map<string, ReviewUnitMatch>,
	stopsByPath: ReadonlyMap<string, readonly DiffSelectionStop[]>,
): CarriedAnchor => {
	if (isExcerptAnchor(anchor)) return { anchor, migrationOrphaned: false };
	if (isPatchAnchor(anchor)) {
		const remapped = anchor.ranges.map((range) => carriedRange(anchor.filePath, range, matches));
		if (remapped.some((range) => range === null)) return { anchor, migrationOrphaned: true };
		const first = remapped[0];
		if (!first) return { anchor, migrationOrphaned: true };
		const ranges = remapped.slice(1).reduce<[PatchThreadRange, ...PatchThreadRange[]]>(
			(result, range) => {
				if (range) result.push(range);
				return result;
			},
			[first],
		);
		const normalized = normalizeDiffSelection(
			{ filePath: anchor.filePath, ranges },
			stopsByPath.get(anchor.filePath) ?? [],
		);
		return {
			anchor: { ...anchor, ranges: normalized.ranges },
			migrationOrphaned: false,
		};
	}
	const remapped = carriedRange(anchor.filePath, anchor, matches);
	return { anchor: remapped ? { ...anchor, ...remapped } : anchor, migrationOrphaned: false };
};

const carriedThread = (
	thread: ReviewThread,
	runId: string,
	matches: Map<string, ReviewUnitMatch>,
	stopsByPath: ReadonlyMap<string, readonly DiffSelectionStop[]>,
): ReviewThread => {
	const carried = carriedAnchor(thread.anchor, matches, stopsByPath);
	return {
		...thread,
		runId,
		migratedFrom: thread.runId,
		anchor: carried.anchor,
		...(thread.migrationOrphaned || carried.migrationOrphaned
			? { migrationOrphaned: true }
			: { migrationOrphaned: undefined }),
	};
};

const withoutRun = (runs: ThreadStoreFile["runs"], runId: string): ThreadStoreFile["runs"] =>
	Object.fromEntries(Object.entries(runs).filter(([key]) => key !== runId));

export type ThreadMigrationInput = {
	run: PreparedRun;
	runsDirectory: string;
	threadsPath: string;
};

/** What a superseding run took over from the run it continues. */
export type ThreadMigration = {
	runId: string;
	supersedes: string;
	carried: ReviewThread[];
};

/**
 * Move the superseded run's feedback onto the run that continues it, anchors and all. Threads are
 * moved rather than copied because a thread is one conversation about code that has moved on:
 * leaving a second copy on the dead run would let the two halves answer each other differently.
 * Nothing is dropped, whatever became of the code, and a re-prep that dedupes onto an already
 * migrated run finds nothing left to move.
 */
export async function migrateSupersededThreads({
	run,
	runsDirectory,
	threadsPath,
}: ThreadMigrationInput): Promise<ThreadMigration | null> {
	const { runId, supersedes } = run.manifest;
	if (!supersedes) return null;
	const predecessor = await loadPreparedRun(join(runsDirectory, supersedes));
	const matches = matchReviewUnits(predecessor, run);
	const stopsByPath = new Map(
		parsePatch(run.patch).map((file) => [file.path, diffSelectionStops(file)] as const),
	);
	return withThreadStoreLock(threadsPath, () => {
		const store = readThreadStoreFile(threadsPath);
		const pending = store.runs[supersedes] ?? [];
		if (!pending.length) return null;
		const settled = store.runs[runId] ?? [];
		const known = new Set(settled.map((thread) => thread.id));
		const carried = pending
			.filter((thread) => !known.has(thread.id))
			.map((thread) => carriedThread(thread, runId, matches, stopsByPath));
		persistThreadStoreFile(threadsPath, {
			...store,
			runs: {
				...withoutRun(store.runs, supersedes),
				[runId]: sortThreads([...settled, ...carried]),
			},
		});
		return { runId, supersedes, carried };
	});
}

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
