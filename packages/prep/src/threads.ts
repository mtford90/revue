import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalizeDiffSelection, type DiffFile, parsePatch } from "@revue/diff";
import {
	canonicalizeSelectionSegments,
	emptyThreadStoreFile,
	frozenExcerptContaining,
	isContextAnchor,
	isExcerptAnchor,
	isPatchAnchor,
	isSelectionAnchor,
	type PatchThreadRange,
	type ReviewThread,
	type RunContextFile,
	type ThreadAnchor,
	type ThreadEvidence,
	type ThreadStoreFile,
	threadStoreFileReaderSchema,
	threadStoreFileSchema,
} from "@revue/types";
import { z } from "zod";
import { loadPreparedRun, type PreparedRun } from "./artifact.ts";
import { writeFileAtomically } from "./atomic.ts";
import { loadRunContextSync } from "./context.ts";

// Threads are the mutable overlay on immutable runs, so the store lives beside the runs rather than
// inside them and every writer takes the same cross-process lock. Prep moves feedback onto a
// superseding run; context freeze settles excerpt anchors against the newly quoted code.

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

/** Exact file lines, preserving tabs, control bytes and carriage returns in stored evidence. */
const splitLines = (text: string): string[] => {
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
};

const pinnedLines = (
	run: PreparedRun,
	filePath: string,
	side: PatchThreadRange["side"] = "additions",
): string[] | null => {
	const file = run.manifest.files.find((candidate) => candidate.path === filePath);
	const blob = side === "additions" ? file?.newBlob : file?.oldBlob;
	if (!blob || file?.isBinary) return null;
	try {
		return splitLines(readFileSync(join(run.directory, "blobs", blob), "utf8"));
	} catch {
		return null;
	}
};

const sameLines = (left: readonly string[], right: readonly string[]): boolean =>
	left.length === right.length && left.every((line, index) => line === right[index]);

const occurrences = (lines: readonly string[], wanted: readonly string[]): number[] =>
	lines.flatMap((_, index) =>
		sameLines(lines.slice(index, index + wanted.length), wanted) ? [index + 1] : [],
	);

type EvidenceRun = PreparedRun & { context?: RunContextFile | null };

/** Capture only from the run the author actually read, never from a carried anchor's replacement. */
export const captureThreadEvidence = (
	run: EvidenceRun,
	anchor: ThreadAnchor,
): ThreadEvidence | undefined => {
	const ranges = isPatchAnchor(anchor)
		? anchor.ranges
		: isSelectionAnchor(anchor)
			? anchor.segments
			: [anchor];
	const lines = ranges.map((range) => {
		if (isExcerptAnchor(anchor)) {
			const excerpt = frozenExcerptContaining(run.context ?? null, anchor);
			return excerpt?.lines.slice(
				anchor.startLine - excerpt.startLine,
				anchor.endLine - excerpt.startLine + 1,
			);
		}
		return pinnedLines(run, anchor.filePath, "side" in range ? range.side : "additions")?.slice(
			range.startLine - 1,
			range.endLine,
		);
	});
	if (
		lines.some(
			(value, index) =>
				!value ||
				value.length !== (ranges[index]?.endLine ?? 0) - (ranges[index]?.startLine ?? 0) + 1,
		)
	)
		return undefined;
	return { runId: run.manifest.runId, anchor, lines: lines as string[][] };
};

/** Overlapping quotations name one physical occurrence, not several competing destinations. */
const frozenOccurrences = (
	context: RunContextFile | null,
	filePath: string,
	wanted: readonly string[],
): number[] => [
	...new Set(
		(context?.excerpts ?? [])
			.filter((excerpt) => excerpt.filePath === filePath)
			.flatMap((excerpt) =>
				occurrences(excerpt.lines, wanted).map((line) => line + excerpt.startLine - 1),
			),
	),
];

type ExcerptResolution = {
	state: "verified" | "unresolved" | "changed" | "unavailable";
	anchor: ThreadAnchor;
};

/** Search frozen destinations before consulting historical coordinates: outside-patch quotes move. */
const resolveExcerptEvidence = (
	context: RunContextFile | null,
	thread: ReviewThread,
): ExcerptResolution => {
	const { anchor } = thread;
	if (!isExcerptAnchor(anchor)) return { state: "unresolved", anchor };
	if (thread.migrationOrphaned) return { state: "changed", anchor };
	const excerpt = frozenExcerptContaining(context, anchor);
	if (!thread.originalEvidence) {
		return {
			state: thread.migratedFrom ? "unavailable" : excerpt ? "verified" : "unresolved",
			anchor,
		};
	}
	const wanted = thread.originalEvidence.lines[0] ?? [];
	const found = frozenOccurrences(context, anchor.filePath, wanted);
	const [startLine] = found;
	if (found.length > 1) return { state: "changed", anchor };
	if (startLine !== undefined) {
		return {
			state: "verified",
			anchor: { ...anchor, startLine, endLine: startLine + wanted.length - 1 },
		};
	}
	return { state: excerpt ? "changed" : "unresolved", anchor };
};

/**
 * Called under the thread-store lock. Save old/new proven mismatches before context replacement;
 * return the publication of verified coordinates for after that replacement succeeds.
 */
export const reconcileFrozenExcerptThreads = (
	path: string,
	runId: string,
	previous: RunContextFile | null,
	current: RunContextFile,
): (() => void) => {
	const store = readThreadStoreFile(path);
	const threads = store.runs[runId] ?? [];
	const reconciled = threads.map((thread) => {
		if (
			!thread.migratedFrom ||
			!isExcerptAnchor(thread.anchor) ||
			thread.migrationOrphaned ||
			!thread.originalEvidence
		)
			return thread;
		const before = resolveExcerptEvidence(previous, thread);
		const after = resolveExcerptEvidence(current, { ...thread, anchor: before.anchor });
		if (before.state === "changed" || after.state === "changed")
			return { ...thread, migrationOrphaned: true as const };
		return after.state === "verified" ? { ...thread, anchor: after.anchor } : thread;
	});
	const detached = threads.map((thread, index) =>
		reconciled[index]?.migrationOrphaned ? { ...thread, migrationOrphaned: true as const } : thread,
	);
	const persist = (next: ReviewThread[]) =>
		persistThreadStoreFile(path, { ...store, runs: { ...store.runs, [runId]: next } });
	if (JSON.stringify(detached) !== JSON.stringify(threads)) persist(detached);
	return () => {
		if (JSON.stringify(reconciled) !== JSON.stringify(detached)) persist(reconciled);
	};
};

/** Missing narration is unresolved, not proof that code changed. Reads never persist detachment. */
export const excerptEvidenceState = (
	context: RunContextFile | null,
	thread: ReviewThread,
): "verified" | "unresolved" | "changed" | "unavailable" => {
	if (!isExcerptAnchor(thread.anchor)) return "unresolved";
	if (thread.migratedFrom) {
		const resolved = resolveExcerptEvidence(context, thread);
		return resolved.state === "verified" &&
			JSON.stringify(resolved.anchor) !== JSON.stringify(thread.anchor)
			? "unresolved"
			: resolved.state;
	}
	const excerpt = frozenExcerptContaining(context, thread.anchor);
	if (!thread.originalEvidence)
		return thread.migratedFrom ? "unavailable" : excerpt ? "verified" : "unresolved";
	if (!excerpt) return "unresolved";
	const wanted = thread.originalEvidence.lines[0] ?? [];
	const actual = excerpt.lines.slice(
		thread.anchor.startLine - excerpt.startLine,
		thread.anchor.endLine - excerpt.startLine + 1,
	);
	return sameLines(actual, wanted) &&
		(!thread.migratedFrom ||
			frozenOccurrences(context, thread.anchor.filePath, wanted).length === 1)
		? "verified"
		: "changed";
};

type CarryContext = {
	currentFiles: ReadonlyMap<string, DiffFile>;
	previousRun: EvidenceRun;
	currentRun: EvidenceRun;
};
type CarriedAnchor = { anchor: ThreadAnchor; migrationOrphaned: boolean };

/** Correspondence must be unique in both files. Neither position nor surviving neighbours prove it. */
const uniqueDestination = (
	previous: readonly string[] | null,
	current: readonly string[] | null,
	start: number,
	end: number,
): number | null => {
	const wanted = previous?.slice(start - 1, end);
	if (!previous || !current || !wanted || wanted.length !== end - start + 1) return null;
	const before = occurrences(previous, wanted);
	const after = occurrences(current, wanted);
	return before.length === 1 && after.length === 1 ? (after[0] ?? null) : null;
};

const carriedRange = (
	filePath: string,
	range: PatchThreadRange,
	context: CarryContext,
): PatchThreadRange | null => {
	const startLine = uniqueDestination(
		pinnedLines(context.previousRun, filePath, range.side),
		pinnedLines(context.currentRun, filePath, range.side),
		range.startLine,
		range.endLine,
	);
	if (startLine === null) return null;
	const endLine = startLine + range.endLine - range.startLine;
	const hunks =
		context.currentFiles.get(filePath)?.metadata.hunks.filter((hunk) => {
			const start = range.side === "additions" ? hunk.additionStart : hunk.deletionStart;
			const count = range.side === "additions" ? hunk.additionCount : hunk.deletionCount;
			return startLine >= start && endLine < start + count;
		}) ?? [];
	const [hunk] = hunks;
	return hunks.length === 1 && hunk
		? { ...range, oldStart: hunk.deletionStart, startLine, endLine }
		: null;
};

const carriedAnchor = (thread: ReviewThread, context: CarryContext): CarriedAnchor => {
	const { anchor } = thread;
	const lost = { anchor, migrationOrphaned: true };
	if (isExcerptAnchor(anchor)) {
		const source = excerptEvidenceState(context.previousRun.context ?? null, {
			...thread,
			migratedFrom: thread.migratedFrom ?? thread.runId,
		});
		if (source === "changed" || source === "unavailable") return lost;
		const wanted = thread.originalEvidence?.lines[0];
		if (!wanted) return lost;
		const previous = pinnedLines(context.previousRun, anchor.filePath);
		if (
			previous &&
			(!sameLines(previous.slice(anchor.startLine - 1, anchor.endLine), wanted) ||
				occurrences(previous, wanted).length !== 1)
		)
			return lost;
		const destination = resolveExcerptEvidence(context.currentRun.context ?? null, thread);
		if (destination.state === "changed") return lost;
		if (destination.state === "verified")
			return { anchor: destination.anchor, migrationOrphaned: false };
		const current = pinnedLines(context.currentRun, anchor.filePath);
		// Files outside the patch may be frozen only after prep. Missing narration is not a deletion.
		if (!current)
			return context.currentRun.manifest.files.some((file) => file.path === anchor.filePath)
				? lost
				: { anchor, migrationOrphaned: false };
		const found = occurrences(current, wanted);
		const [startLine] = found;
		return found.length === 1 && startLine !== undefined
			? {
					anchor: { ...anchor, startLine, endLine: startLine + wanted.length - 1 },
					migrationOrphaned: false,
				}
			: lost;
	}
	if (isContextAnchor(anchor)) {
		const startLine = uniqueDestination(
			pinnedLines(context.previousRun, anchor.filePath),
			pinnedLines(context.currentRun, anchor.filePath),
			anchor.startLine,
			anchor.endLine,
		);
		return startLine === null
			? lost
			: {
					anchor: { ...anchor, startLine, endLine: startLine + anchor.endLine - anchor.startLine },
					migrationOrphaned: false,
				};
	}
	if (isPatchAnchor(anchor)) {
		const ranges = anchor.ranges.map((range) => carriedRange(anchor.filePath, range, context));
		const file = context.currentFiles.get(anchor.filePath);
		if (ranges.some((range) => !range) || !file) return lost;
		const canonical = canonicalizeDiffSelection(
			{ filePath: anchor.filePath, ranges: ranges as [PatchThreadRange, ...PatchThreadRange[]] },
			file,
		);
		return { anchor: { ...anchor, ranges: canonical.ranges }, migrationOrphaned: false };
	}
	if (isSelectionAnchor(anchor)) {
		const segments = anchor.segments.map((segment) => {
			if (segment.kind === "patch") return carriedRange(anchor.filePath, segment, context);
			const startLine = uniqueDestination(
				pinnedLines(context.previousRun, anchor.filePath, segment.side),
				pinnedLines(context.currentRun, anchor.filePath, segment.side),
				segment.startLine,
				segment.endLine,
			);
			return startLine === null
				? null
				: { ...segment, startLine, endLine: startLine + segment.endLine - segment.startLine };
		});
		return segments.some((segment) => !segment)
			? lost
			: {
					anchor: {
						...anchor,
						segments: canonicalizeSelectionSegments(
							segments as typeof anchor.segments,
						) as typeof anchor.segments,
					},
					migrationOrphaned: false,
				};
	}
	const range = carriedRange(anchor.filePath, anchor, context);
	return range ? { anchor: { ...anchor, ...range }, migrationOrphaned: false } : lost;
};

const carriedThread = (
	thread: ReviewThread,
	runId: string,
	context: CarryContext,
): ReviewThread => {
	const originalEvidence =
		thread.originalEvidence ??
		(!thread.migratedFrom ? captureThreadEvidence(context.previousRun, thread.anchor) : undefined);
	const withEvidence = { ...thread, originalEvidence };
	const carried =
		thread.migrationOrphaned || (!originalEvidence && thread.migratedFrom)
			? { anchor: thread.anchor, migrationOrphaned: true }
			: carriedAnchor(withEvidence, context);
	return {
		...withEvidence,
		runId,
		migratedFrom: thread.runId,
		anchor: carried.anchor,
		migrationOrphaned: carried.migrationOrphaned ? true : undefined,
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
		// Freeze uses this same lock: do not map against context read before another writer froze it.
		for (const context of contexts.values()) {
			context.previousRun.context = loadRunContextSync(context.previousRun);
			context.currentRun.context = loadRunContextSync(context.currentRun);
		}
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
