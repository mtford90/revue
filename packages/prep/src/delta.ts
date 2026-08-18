import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type DiffFile, type DiffHunk, parsePatch } from "@revue/diff";
import {
	type Chapter,
	type ContextExcerpt,
	excerptKey,
	excerptRangeLabel,
	frozenExcerptFor,
	type HunkReference,
	type KeyChange,
	type LineRef,
	REVIEW_UNIT_STATUS,
	type ReviewUnitStatus,
	type RevueChaptersFile,
	RevueChaptersFileSchema,
	type RunContextFile,
	type RunDeltaFile,
	type RunFile,
	runDeltaFileSchema,
	type StaleChapter,
	type UnnarratedUnit,
} from "@revue/types";
import { z } from "zod";
import { digest, loadPreparedRun, type PreparedRun, RunArtifactError } from "./artifact.ts";
import { loadRunContext, resolveRunContext, runContextPath } from "./context.ts";

// A review is iterative, so a run supersedes the narrated run whose code it revises and inherits
// every chapter the revision did not touch. Which chapters those are is deterministic — hunk
// identity, staleness, and anchor arithmetic — so the CLI settles it rather than leaving the
// narrating agent to diff two hunk listings by eye. Like chapters.json and context.json, delta.json
// is narration-side and never enters the run ID.

export const runDeltaPath = (directory: string): string => join(directory, "delta.json");

/**
 * One review unit reduced to what comparing runs needs: its `(filePath, oldStart)` identity, the
 * lines it occupies on each side, and a digest of its content that ignores where those lines sit.
 */
export type ReviewUnit = {
	filePath: string;
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
	signature: string;
};

type ClassifiedUnit = { unit: ReviewUnit; status: ReviewUnitStatus; previous?: ReviewUnit };

export const unitKey = (filePath: string, oldStart: number): string =>
	JSON.stringify([filePath, oldStart]);

const unitLabel = (filePath: string, oldStart: number): string =>
	`${JSON.stringify(filePath)}@${oldStart}`;

const cleanLine = (line: string): string => line.replace(/\r?\n$/, "");

/** A hunk's body as the reviewer reads it, without the line numbers that shift beneath it. */
const hunkBody = (file: DiffFile, hunk: DiffHunk): string[] =>
	hunk.hunkContent.flatMap((content) =>
		content.type === "context"
			? Array.from({ length: content.lines }, (_, offset) =>
					cleanLine(` ${file.metadata.additionLines[content.additionLineIndex + offset] ?? ""}`),
				)
			: [
					...Array.from({ length: content.deletions }, (_, offset) =>
						cleanLine(`-${file.metadata.deletionLines[content.deletionLineIndex + offset] ?? ""}`),
					),
					...Array.from({ length: content.additions }, (_, offset) =>
						cleanLine(`+${file.metadata.additionLines[content.additionLineIndex + offset] ?? ""}`),
					),
				],
	);

const hunkUnit = (file: DiffFile, hunk: DiffHunk): ReviewUnit => ({
	filePath: file.path,
	oldStart: hunk.deletionStart,
	oldCount: hunk.deletionCount,
	newStart: hunk.additionStart,
	newCount: hunk.additionCount,
	signature: digest(
		[...hunkBody(file, hunk), `\\${hunk.noEOFCRDeletions}${hunk.noEOFCRAdditions}`].join("\n"),
	),
});

/** A file with no textual hunk is one review unit whose content is the metadata prep pinned. */
const metadataUnit = (file: RunFile): ReviewUnit => ({
	filePath: file.path,
	oldStart: 0,
	oldCount: 0,
	newStart: 0,
	newCount: 0,
	signature: digest(
		JSON.stringify([
			file.status,
			file.previousPath,
			file.oldMode,
			file.newMode,
			file.oldBlob,
			file.newBlob,
		]),
	),
});

const reviewUnits = (run: PreparedRun): ReviewUnit[] => {
	const diffs = new Map(parsePatch(run.patch).map((file) => [file.path, file]));
	return run.manifest.files.flatMap((file) => {
		const diff = diffs.get(file.path);
		if (!diff?.metadata.hunks.length) return [metadataUnit(file)];
		return diff.metadata.hunks.map((hunk) => hunkUnit(diff, hunk));
	});
};

/** The pre-image lines a unit speaks for, never empty, so a pure insertion still holds a position. */
const oldRange = (unit: ReviewUnit): [from: number, to: number] => [
	unit.oldStart,
	unit.oldStart + Math.max(unit.oldCount, 1),
];

const sameContent = (unit: ReviewUnit, available: ReviewUnit[]): ReviewUnit | undefined =>
	available
		.filter(
			(candidate) => candidate.filePath === unit.filePath && candidate.signature === unit.signature,
		)
		.sort(
			(left, right) =>
				Math.abs(left.oldStart - unit.oldStart) - Math.abs(right.oldStart - unit.oldStart),
		)[0];

const samePosition = (unit: ReviewUnit, available: ReviewUnit[]): ReviewUnit | undefined => {
	const [from, to] = oldRange(unit);
	return available.find((candidate) => {
		const [candidateFrom, candidateTo] = oldRange(candidate);
		return candidate.filePath === unit.filePath && candidateFrom < to && from < candidateTo;
	});
};

/**
 * Match every review unit of the new run against the predecessor's. Identical content is unchanged
 * however far its lines moved; failing that, a unit rewriting the same pre-image lines is a modified
 * version of that one; anything left over is new.
 */
const classifyReviewUnits = (previous: ReviewUnit[], current: ReviewUnit[]): ClassifiedUnit[] => {
	const available = [...previous];
	const claim = (found: ReviewUnit | undefined): ReviewUnit | undefined => {
		if (found) available.splice(available.indexOf(found), 1);
		return found;
	};
	return current.map((unit) => {
		const unchanged = claim(sameContent(unit, available));
		if (unchanged) return { unit, previous: unchanged, status: REVIEW_UNIT_STATUS.UNCHANGED };
		const modified = claim(samePosition(unit, available));
		const status = modified ? REVIEW_UNIT_STATUS.MODIFIED : REVIEW_UNIT_STATUS.NEW;
		return { unit, previous: modified, status };
	});
};

/** A review unit of the predecessor and the unit of this run that carries it. */
export type ReviewUnitMatch = {
	previous: ReviewUnit;
	current: ReviewUnit;
	status: ReviewUnitStatus;
};

/**
 * What each review unit of the predecessor became in the run superseding it, by unit key. A unit the
 * change dropped is simply absent, which is what tells a caller its code is gone.
 */
export const matchReviewUnits = (
	predecessor: PreparedRun,
	run: PreparedRun,
): Map<string, ReviewUnitMatch> =>
	new Map(
		classifyReviewUnits(reviewUnits(predecessor), reviewUnits(run)).flatMap((entry) =>
			entry.previous
				? ([
						[
							unitKey(entry.previous.filePath, entry.previous.oldStart),
							{ previous: entry.previous, current: entry.unit, status: entry.status },
						],
					] as const)
				: [],
		),
	);

/** Where a review unit's lines begin on one side of the diff, and how many it has there. */
export const unitSide = (
	unit: ReviewUnit,
	side: LineRef["side"],
): { start: number; count: number } =>
	side === "additions"
		? { start: unit.newStart, count: unit.newCount }
		: { start: unit.oldStart, count: unit.oldCount };

const sideStart = (unit: ReviewUnit, side: LineRef["side"]): number => unitSide(unit, side).start;

const containing = (reference: LineRef, units: ReviewUnit[]): ReviewUnit | undefined =>
	units.find((unit) => {
		const { start, count } = unitSide(unit, reference.side);
		return (
			unit.filePath === reference.filePath &&
			count > 0 &&
			reference.startLine >= start &&
			reference.endLine <= start + count - 1
		);
	});

/**
 * A carried unit holds the same lines in the same order, so a key change keeps its place inside it
 * and only the number the new run counts from moves.
 */
const remapLineRef = (reference: LineRef, carried: Map<ReviewUnit, ReviewUnit>): LineRef => {
	const previous = containing(reference, [...carried.keys()]);
	const current = previous && carried.get(previous);
	if (!previous || !current) return reference;
	const shift = sideStart(current, reference.side) - sideStart(previous, reference.side);
	return {
		...reference,
		startLine: reference.startLine + shift,
		endLine: reference.endLine + shift,
	};
};

const remapKeyChange = (keyChange: KeyChange, carried: Map<ReviewUnit, ReviewUnit>): KeyChange => ({
	...keyChange,
	lineRefs: keyChange.lineRefs.map((reference) => remapLineRef(reference, carried)),
});

type ChapterOutcome = { chapter: Chapter } | { reasons: string[] };

const staleReason = (reference: HunkReference, claim: ClassifiedUnit | undefined): string =>
	`review unit ${unitLabel(reference.filePath, reference.oldStart)} ${claim ? "changed" : "is no longer part of this run"}`;

/** A chapter survives only when every unit it narrates came through the change untouched. */
const carryChapter = (chapter: Chapter, claims: Map<string, ClassifiedUnit>): ChapterOutcome => {
	const reasons: string[] = [];
	const carried = new Map<ReviewUnit, ReviewUnit>();
	for (const reference of chapter.hunkRefs) {
		const claim = claims.get(unitKey(reference.filePath, reference.oldStart));
		if (claim?.previous && claim.status === REVIEW_UNIT_STATUS.UNCHANGED) {
			carried.set(claim.previous, claim.unit);
		} else reasons.push(staleReason(reference, claim));
	}
	if (reasons.length) return { reasons };
	const hunkRefs: HunkReference[] = [...carried.values()].map((unit) => ({
		filePath: unit.filePath,
		oldStart: unit.oldStart,
	}));
	const keyChanges = chapter.keyChanges.map((keyChange) => remapKeyChange(keyChange, carried));
	return { chapter: { ...chapter, hunkRefs, keyChanges } };
};

const staleEntry = (chapter: Chapter, reasons: string[]): StaleChapter => ({
	id: chapter.id,
	title: chapter.title,
	reasons,
});

type ChapterVerdicts = { candidates: Chapter[]; stale: StaleChapter[] };

const chapterVerdicts = (
	chapters: RevueChaptersFile | null,
	classified: ClassifiedUnit[],
): ChapterVerdicts => {
	const claims = new Map(
		classified.flatMap((entry) =>
			entry.previous
				? ([[unitKey(entry.previous.filePath, entry.previous.oldStart), entry]] as const)
				: [],
		),
	);
	const judged = (chapters?.chapters ?? []).map((chapter) => ({
		chapter,
		outcome: carryChapter(chapter, claims),
	}));
	return {
		candidates: judged.flatMap(({ outcome }) => ("chapter" in outcome ? [outcome.chapter] : [])),
		stale: judged.flatMap(({ chapter, outcome }) =>
			"reasons" in outcome ? [staleEntry(chapter, outcome.reasons)] : [],
		),
	};
};

const excerptIssue = (
	excerpt: ContextExcerpt,
	resolved: RunContextFile,
	previous: RunContextFile | null,
): string | undefined => {
	const label = `excerpt ${excerptRangeLabel(excerpt)}`;
	const failure = resolved.unresolved.find((entry) => excerptKey(entry) === excerptKey(excerpt));
	if (failure) return `${label} no longer resolves: ${failure.reason}`;
	const pinned = frozenExcerptFor(previous, excerpt);
	if (!pinned) return `${label} was never frozen for the run it came from`;
	const current = frozenExcerptFor(resolved, excerpt);
	return current?.lines.join("\n") === pinned.lines.join("\n")
		? undefined
		: `${label} now quotes different code`;
};

const citedExcerpts = (chapters: readonly Chapter[]): Set<string> =>
	new Set(chapters.flatMap((chapter) => chapter.excerpts.map(excerptKey)));

/**
 * Quoted code is cited by line range rather than by content, so a chapter can survive its own hunks
 * and still point somewhere else. Re-freezing each citation against the new run and comparing it
 * with the bytes the predecessor pinned is what proves the quote still holds.
 */
const settleExcerpts = async (
	run: PreparedRun,
	previous: RunContextFile | null,
	candidates: readonly Chapter[],
): Promise<ChapterVerdicts & { context: RunContextFile | null }> => {
	if (!candidates.some((chapter) => chapter.excerpts.length)) {
		return { candidates: [...candidates], stale: [], context: null };
	}
	const { context } = await resolveRunContext(run, { chapters: [...candidates] });
	const judged = candidates.map((chapter) => ({
		chapter,
		reasons: chapter.excerpts.flatMap((excerpt) => excerptIssue(excerpt, context, previous) ?? []),
	}));
	const carried = judged.flatMap(({ chapter, reasons }) => (reasons.length ? [] : [chapter]));
	const cited = citedExcerpts(carried);
	return {
		candidates: carried,
		stale: judged.flatMap(({ chapter, reasons }) =>
			reasons.length ? [staleEntry(chapter, reasons)] : [],
		),
		context: cited.size
			? { ...context, excerpts: context.excerpts.filter((entry) => cited.has(excerptKey(entry))) }
			: null,
	};
};

const unnarratedUnits = (
	classified: ClassifiedUnit[],
	carried: readonly Chapter[],
): UnnarratedUnit[] => {
	const narrated = new Set(
		carried.flatMap((chapter) =>
			chapter.hunkRefs.map((reference) => unitKey(reference.filePath, reference.oldStart)),
		),
	);
	return classified
		.filter((entry) => !narrated.has(unitKey(entry.unit.filePath, entry.unit.oldStart)))
		.map(({ unit, status }) => ({ filePath: unit.filePath, oldStart: unit.oldStart, status }));
};

export type RunDeltaInput = {
	run: PreparedRun;
	predecessor: PreparedRun;
	/** The predecessor's narration, or null when nobody narrated it. */
	chapters: RevueChaptersFile | null;
	/** The predecessor's frozen context, which is what carried citations are checked against. */
	context: RunContextFile | null;
};

export type RunDeltaResult = {
	delta: RunDeltaFile;
	/** Frozen context for the carried citations, or null when the carried chapters quote nothing. */
	context: RunContextFile | null;
};

/** The worklist a run inherits from the narrated run it supersedes. */
export async function computeRunDelta(input: RunDeltaInput): Promise<RunDeltaResult> {
	const classified = classifyReviewUnits(reviewUnits(input.predecessor), reviewUnits(input.run));
	const byHunks = chapterVerdicts(input.chapters, classified);
	const byExcerpts = await settleExcerpts(input.run, input.context, byHunks.candidates);
	const carried = byExcerpts.candidates;
	const delta = runDeltaFileSchema.parse({
		runId: input.run.manifest.runId,
		supersedes: input.predecessor.manifest.runId,
		carried,
		stale: [...byHunks.stale, ...byExcerpts.stale],
		unnarrated: unnarratedUnits(classified, carried),
	});
	return { delta, context: byExcerpts.context };
}

const pathExists = async (path: string): Promise<boolean> => {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
};

const writeJson = async (path: string, value: unknown): Promise<void> => {
	const temporary = `${path}.tmp-${randomUUID()}`;
	try {
		await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
};

const readNarration = async (directory: string): Promise<RevueChaptersFile | null> => {
	const path = join(directory, "chapters.json");
	if (!(await pathExists(path))) return null;
	const parsed = RevueChaptersFileSchema.safeParse(await parseJson(path));
	if (!parsed.success) {
		throw new RunArtifactError(
			`Could not carry narration forward from ${path}:\n${z.prettifyError(parsed.error)}\nPrep again with --no-carry to start a fresh review.`,
		);
	}
	return parsed.data;
};

/**
 * Record the delta a newly created run inherits: the chapters the change left alone, pre-copied
 * with every reference re-mapped, the stale ones it must re-narrate, and the review units nothing
 * narrates yet. Runs are immutable, so a narrated or already settled run keeps what it has.
 */
export async function recordRunDelta(
	run: PreparedRun,
	runsDirectory: string,
): Promise<RunDeltaFile | null> {
	const { supersedes } = run.manifest;
	if (!supersedes) return null;
	const settled = await Promise.all(
		[join(run.directory, "chapters.json"), runDeltaPath(run.directory)].map(pathExists),
	);
	if (settled.some(Boolean)) return null;
	const predecessor = await loadPreparedRun(join(runsDirectory, supersedes));
	const { delta, context } = await computeRunDelta({
		run,
		predecessor,
		chapters: await readNarration(predecessor.directory),
		context: await loadRunContext(predecessor),
	});
	if (context) await writeJson(runContextPath(run.directory), context);
	await writeJson(runDeltaPath(run.directory), delta);
	return delta;
}

/** A run's recorded delta, or null when it supersedes nothing. */
export async function loadRunDelta(run: PreparedRun): Promise<RunDeltaFile | null> {
	const path = runDeltaPath(run.directory);
	if (!(await pathExists(path))) return null;
	const parsed = runDeltaFileSchema.safeParse(await parseJson(path));
	if (!parsed.success) {
		throw new RunArtifactError(
			`${path} does not match the run delta schema:\n${z.prettifyError(parsed.error)}`,
		);
	}
	if (parsed.data.runId !== run.manifest.runId) {
		throw new RunArtifactError(`${path} was recorded for a different run`);
	}
	return parsed.data;
}

const parseJson = async (path: string): Promise<unknown> => {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		throw new RunArtifactError(`Could not read ${path}: ${describe(error)}`);
	}
	try {
		return JSON.parse(raw);
	} catch (error) {
		throw new RunArtifactError(`${path} is not valid JSON: ${describe(error)}`);
	}
};

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
