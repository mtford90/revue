import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalizeDiffSelection, type DiffFile, parsePatch } from "@revue/diff";
import {
	type ContextThreadAnchor,
	emptyThreadStoreFile,
	isContextAnchor,
	isExcerptAnchor,
	isPatchAnchor,
	type PatchThreadAnchor,
	type PatchThreadRange,
	REVIEW_UNIT_STATUS,
	type ReviewThread,
	type ThreadAnchor,
	type ThreadStoreFile,
	threadStoreFileReaderSchema,
	threadStoreFileSchema,
} from "@revue/types";
import { z } from "zod";
import { loadPreparedRun, type PreparedRun } from "./artifact.ts";
import { writeFileAtomically } from "./atomic.ts";
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
	const parsed = threadStoreFileReaderSchema.safeParse(value);
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
	try {
		writeFileAtomically(path, `${JSON.stringify(parsed, null, 2)}\n`);
	} catch (error) {
		throw new ThreadStoreError(`Could not persist thread store at ${path}: ${describe(error)}`);
	}
}

/** The lines a review unit holds on one side, numbered as the new run counts them. */
type UnitLines = { start: number; lines: readonly string[] };

const withoutEnding = (line: string): string => line.replace(/\r?\n$/, "");

const unitLines = (
	file: DiffFile | undefined,
	oldStart: number,
	side: PatchThreadRange["side"],
): UnitLines | null => {
	const hunk = file?.metadata.hunks.find((candidate) => candidate.deletionStart === oldStart);
	if (!file || !hunk) return null;
	const additions = side === "additions";
	const start = additions ? hunk.additionStart : hunk.deletionStart;
	const count = additions ? hunk.additionCount : hunk.deletionCount;
	const index = additions ? hunk.additionLineIndex : hunk.deletionLineIndex;
	const source = additions ? file.metadata.additionLines : file.metadata.deletionLines;
	return { start, lines: source.slice(index, index + count).map(withoutEnding) };
};

/** The exact text a range covers, or null when the unit does not hold all of those lines. */
const linesAt = (unit: UnitLines | null, startLine: number, endLine: number): string[] | null => {
	if (!unit) return null;
	const from = startLine - unit.start;
	const to = endLine - unit.start;
	if (from < 0 || to < from || to > unit.lines.length - 1) return null;
	return unit.lines.slice(from, to + 1);
};

const sameLines = (left: readonly string[], right: readonly string[]): boolean =>
	left.length === right.length && left.every((line, index) => line === right[index]);

type PlacedUnit = UnitLines & { oldStart: number };

/** Every unit of a file in one run, so code that moved between hunks is still findable. */
const fileUnits = (file: DiffFile | undefined, side: PatchThreadRange["side"]): PlacedUnit[] =>
	(file?.metadata.hunks ?? []).flatMap((hunk) => {
		const unit = unitLines(file, hunk.deletionStart, side);
		return unit ? [{ ...unit, oldStart: hunk.deletionStart }] : [];
	});

type FoundLines = { oldStart: number; startLine: number };

const occurrencesIn = (unit: PlacedUnit, wanted: readonly string[]): FoundLines[] =>
	unit.lines.flatMap((_, index) =>
		sameLines(unit.lines.slice(index, index + wanted.length), wanted)
			? [{ oldStart: unit.oldStart, startLine: unit.start + index }]
			: [],
	);

/** Where the anchored text now sits, preferring the occurrence nearest where the anchor pointed. */
const findLines = (
	file: DiffFile | undefined,
	side: PatchThreadRange["side"],
	wanted: readonly string[],
	near: number,
): FoundLines | null =>
	fileUnits(file, side)
		.flatMap((unit) => occurrencesIn(unit, wanted))
		.sort((left, right) => Math.abs(left.startLine - near) - Math.abs(right.startLine - near))[0] ??
	null;

/**
 * Whether the lines immediately around the range came through untouched. That is what tells an
 * edit the reviewer's comment answers — the fix rewrote the very lines it was left on — apart from
 * a deletion that merely left unrelated code sitting at the same numbers.
 */
const framePreserved = (
	before: UnitLines | null,
	after: UnitLines | null,
	range: PatchThreadRange,
	shifted: PatchThreadRange,
): boolean => {
	const sides = [
		[range.startLine - 1, shifted.startLine - 1],
		[range.endLine + 1, shifted.endLine + 1],
	] as const;
	const pairs = sides.flatMap(([previousLine, currentLine]) => {
		const previous = linesAt(before, previousLine, previousLine);
		return previous ? [{ previous, current: linesAt(after, currentLine, currentLine) }] : [];
	});
	return (
		pairs.length > 0 &&
		pairs.every(({ previous, current }) => current && sameLines(previous, current))
	);
};

/**
 * Where a carried anchor reads in the superseding run. A unit that came through with its content
 * intact shifts exactly. Where the change rewrote the unit the anchor is followed by its content:
 * the same text at the shifted position, failing that the shifted position when the lines framing it
 * survived and so the fix answered the comment in place, failing that the same text wherever else
 * in the file it went. Code the run no longer has anywhere is `lost` — the anchor keeps the range it
 * was written against and the run reports it as orphaned, rather than pinning the reviewer's words
 * to whatever now occupies those numbers.
 */
type CarriedRangeOutcome =
	| { kind: "mapped"; range: PatchThreadRange }
	| { kind: "unmatched" }
	| { kind: "lost" };

type CarryContext = {
	previousFiles: ReadonlyMap<string, DiffFile>;
	currentFiles: ReadonlyMap<string, DiffFile>;
	matches: Map<string, ReviewUnitMatch>;
	previousRun: PreparedRun;
	currentRun: PreparedRun;
};

const splitLines = (text: string): string[] => {
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
};

/** The pinned new-side text of a file, or null when the run holds none for it. */
const pinnedLines = (run: PreparedRun, filePath: string): string[] | null => {
	const file = run.manifest.files.find((candidate) => candidate.path === filePath);
	if (!file?.newBlob || file.isBinary) return null;
	try {
		return splitLines(readFileSync(join(run.directory, "blobs", file.newBlob), "utf8"));
	} catch {
		return null;
	}
};

const nearestOccurrence = (
	lines: readonly string[],
	wanted: readonly string[],
	near: number,
): number | undefined =>
	lines
		.flatMap((_, index) =>
			sameLines(lines.slice(index, index + wanted.length), wanted) ? [index + 1] : [],
		)
		.sort((left, right) => Math.abs(left - near) - Math.abs(right - near))[0];

/**
 * A context anchor names lines of the pinned new file rather than of a review unit, so it follows
 * its content through the blobs by the same rule: the same text at the same place, the same place
 * when the lines framing it held, the same text wherever else it went, otherwise lost.
 */
const carriedContextAnchor = (
	anchor: ContextThreadAnchor,
	{ previousRun, currentRun }: CarryContext,
): CarriedAnchor => {
	const previous = pinnedLines(previousRun, anchor.filePath);
	const current = pinnedLines(currentRun, anchor.filePath);
	const wanted = previous?.slice(anchor.startLine - 1, anchor.endLine) ?? [];
	if (!previous || !current || wanted.length !== anchor.endLine - anchor.startLine + 1) {
		return { anchor, migrationOrphaned: true };
	}
	if (sameLines(current.slice(anchor.startLine - 1, anchor.endLine), wanted)) {
		return { anchor, migrationOrphaned: false };
	}
	const frame = [anchor.startLine - 2, anchor.endLine];
	const framePreserved = frame.every(
		(index) => previous[index] !== undefined && previous[index] === current[index],
	);
	if (framePreserved) return { anchor, migrationOrphaned: false };
	const found = nearestOccurrence(current, wanted, anchor.startLine);
	if (found === undefined) return { anchor, migrationOrphaned: true };
	return {
		anchor: { ...anchor, startLine: found, endLine: found + wanted.length - 1 },
		migrationOrphaned: false,
	};
};

const carriedRange = (
	filePath: string,
	range: PatchThreadRange,
	{ previousFiles, currentFiles, matches }: CarryContext,
): CarriedRangeOutcome => {
	const match = matches.get(unitKey(filePath, range.oldStart));
	if (!match) return { kind: "unmatched" };
	const before = unitSide(match.previous, range.side);
	const after = unitSide(match.current, range.side);
	const shift = after.start - before.start;
	const shifted: PatchThreadRange = {
		...range,
		oldStart: match.current.oldStart,
		startLine: range.startLine + shift,
		endLine: range.endLine + shift,
	};
	const outside =
		shifted.startLine < after.start || shifted.endLine > after.start + after.count - 1;
	if (after.count === 0 || outside) return { kind: "unmatched" };
	if (match.status === REVIEW_UNIT_STATUS.UNCHANGED) return { kind: "mapped", range: shifted };

	const previousUnit = unitLines(previousFiles.get(filePath), range.oldStart, range.side);
	const currentUnit = unitLines(currentFiles.get(filePath), shifted.oldStart, range.side);
	const wanted = linesAt(previousUnit, range.startLine, range.endLine);
	if (!wanted) return { kind: "lost" };
	const settled = linesAt(currentUnit, shifted.startLine, shifted.endLine);
	if (settled && sameLines(settled, wanted)) return { kind: "mapped", range: shifted };
	// Where the frame held, the fix rewrote these very lines, which beats an identical line found
	// somewhere else in the file: duplicate lines are common and a coincidence must not win.
	if (framePreserved(previousUnit, currentUnit, range, shifted)) {
		return { kind: "mapped", range: shifted };
	}
	const found = findLines(currentFiles.get(filePath), range.side, wanted, shifted.startLine);
	if (!found) return { kind: "lost" };
	return {
		kind: "mapped",
		range: {
			...range,
			oldStart: found.oldStart,
			startLine: found.startLine,
			endLine: found.startLine + wanted.length - 1,
		},
	};
};

type CarriedAnchor = { anchor: ThreadAnchor; migrationOrphaned: boolean };

const mappedRanges = (
	outcomes: readonly CarriedRangeOutcome[],
): [PatchThreadRange, ...PatchThreadRange[]] | null => {
	const ranges = outcomes.flatMap((outcome) => (outcome.kind === "mapped" ? [outcome.range] : []));
	const [first, ...rest] = ranges;
	return first && ranges.length === outcomes.length ? [first, ...rest] : null;
};

const carriedPatchAnchor = (anchor: PatchThreadAnchor, context: CarryContext): CarriedAnchor => {
	const ranges = mappedRanges(
		anchor.ranges.map((range) => carriedRange(anchor.filePath, range, context)),
	);
	const authoritative = context.currentFiles.get(anchor.filePath);
	if (!ranges || !authoritative) return { anchor, migrationOrphaned: true };
	const normalized = canonicalizeDiffSelection(
		{ filePath: anchor.filePath, ranges },
		authoritative,
	);
	return { anchor: { ...anchor, ranges: normalized.ranges }, migrationOrphaned: false };
};

/**
 * An excerpt anchor resolves against the frozen context rather than the patch, so it carries as it
 * is. Every other anchor follows its content: one whose code this run no longer has anywhere is
 * orphaned, while one whose unit simply left the run keeps its range for the reader to report.
 */
const carriedAnchor = (anchor: ThreadAnchor, context: CarryContext): CarriedAnchor => {
	if (isExcerptAnchor(anchor)) return { anchor, migrationOrphaned: false };
	if (isContextAnchor(anchor)) return carriedContextAnchor(anchor, context);
	if (isPatchAnchor(anchor)) return carriedPatchAnchor(anchor, context);
	const outcome = carriedRange(anchor.filePath, anchor, context);
	if (outcome.kind === "mapped") {
		return { anchor: { ...anchor, ...outcome.range }, migrationOrphaned: false };
	}
	return { anchor, migrationOrphaned: outcome.kind === "lost" };
};

const carriedThread = (
	thread: ReviewThread,
	runId: string,
	context: CarryContext,
): ReviewThread => {
	// An anchor that failed once is historical evidence, not a candidate for another mapping
	// attempt. Later runs may coincidentally regain matching coordinates; preserving the original
	// bytes prevents that coincidence from silently changing what the thread was about.
	const carried = thread.migrationOrphaned
		? { anchor: thread.anchor, migrationOrphaned: true }
		: carriedAnchor(thread.anchor, context);
	return {
		...thread,
		runId,
		migratedFrom: thread.runId,
		anchor: carried.anchor,
		...(carried.migrationOrphaned ? { migrationOrphaned: true } : { migrationOrphaned: undefined }),
	};
};

/** Patch files by both the path a thread may name and the path the diff canonically uses. */
const filesByPath = (patch: string): ReadonlyMap<string, DiffFile> => {
	const files = new Map<string, DiffFile>();
	for (const file of parsePatch(patch)) {
		files.set(file.path, file);
		files.set(file.metadata.name, file);
	}
	return files;
};

const withoutRuns = (
	runs: ThreadStoreFile["runs"],
	runIds: ReadonlySet<string>,
): ThreadStoreFile["runs"] =>
	Object.fromEntries(Object.entries(runs).filter(([key]) => !runIds.has(key)));

export type ThreadMigrationInput = {
	run: PreparedRun;
	runsDirectory: string;
	threadsPath: string;
	/**
	 * The runs whose feedback moves onto this one. Defaults to the run it supersedes; a lineage
	 * that chained through pending runs names each of them, because the feedback moved onto the
	 * pending run the last time prep ran.
	 */
	sources?: readonly string[];
};

/** What a superseding run took over from the runs it continues. */
export type ThreadMigration = {
	runId: string;
	/** The runs feedback was actually moved from, oldest first. */
	sources: string[];
	carried: ReviewThread[];
};

const carryContextFor = async (
	run: PreparedRun,
	runsDirectory: string,
	source: string,
): Promise<CarryContext> => {
	const predecessor = await loadPreparedRun(join(runsDirectory, source));
	return {
		matches: matchReviewUnits(predecessor, run),
		previousFiles: filesByPath(predecessor.patch),
		currentFiles: filesByPath(run.patch),
		previousRun: predecessor,
		currentRun: run,
	};
};

/**
 * Move the superseded runs' feedback onto the run that continues them, anchors and all. Threads
 * are moved rather than copied because a thread is one conversation about code that has moved on:
 * leaving a second copy on the dead run would let the two halves answer each other differently.
 * Nothing is dropped, whatever became of the code, and a re-prep that dedupes onto an already
 * migrated run finds nothing left to move. Each source's anchors are re-mapped against that source,
 * since a thread left on a pending run is written in that run's coordinates.
 */
export async function migrateSupersededThreads({
	run,
	runsDirectory,
	threadsPath,
	sources,
}: ThreadMigrationInput): Promise<ThreadMigration | null> {
	const { runId, supersedes } = run.manifest;
	if (!supersedes) return null;
	const wanted = (sources ?? [supersedes]).filter((source) => source !== runId);
	if (!wanted.length) return null;
	const contexts = new Map(
		await Promise.all(
			wanted.map(
				async (source) => [source, await carryContextFor(run, runsDirectory, source)] as const,
			),
		),
	);
	return withThreadStoreLock(threadsPath, () => {
		const store = readThreadStoreFile(threadsPath);
		const moved = wanted.filter((source) => (store.runs[source] ?? []).length > 0);
		if (!moved.length) return null;
		const settled = store.runs[runId] ?? [];
		const known = new Set(settled.map((thread) => thread.id));
		const carried = moved.flatMap((source) =>
			(store.runs[source] ?? [])
				.filter((thread) => !known.has(thread.id))
				.map((thread) => carriedThread(thread, runId, contexts.get(source) as CarryContext)),
		);
		persistThreadStoreFile(threadsPath, {
			...store,
			runs: {
				...withoutRuns(store.runs, new Set(moved)),
				[runId]: sortThreads([...settled, ...carried]),
			},
		});
		return { runId, sources: moved, carried };
	});
}

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
