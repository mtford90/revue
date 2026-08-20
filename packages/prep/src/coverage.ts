import { type DiffFile, parsePatch } from "@revue/diff";
import {
	type Chapter,
	excerptKey,
	excerptRangeLabel,
	isEpilogue,
	type LineRef,
	type ReviewThread,
	type RevueChaptersFile,
	type RunContextFile,
	type RunDeltaFile,
	type RunExclusion,
	supersedesNarration,
	threadReferences,
} from "@revue/types";
import type { PreparedRun } from "./artifact.ts";
import { exclusionSource } from "./format.ts";

export class ReviewCoverageError extends Error {}

const unitKey = (path: string, oldStart: number): string => JSON.stringify([path, oldStart]);
const unitLabel = (path: string, oldStart: number): string => `${JSON.stringify(path)}@${oldStart}`;

type UnitEntry = [key: string, label: string];

const unitEntry = (path: string, oldStart: number): UnitEntry => [
	unitKey(path, oldStart),
	unitLabel(path, oldStart),
];

const manifestUnitEntries = (run: PreparedRun): UnitEntry[] =>
	run.manifest.files.flatMap((file) =>
		file.referenceStarts.map((oldStart) => unitEntry(file.path, oldStart)),
	);

const patchUnitEntries = (files: DiffFile[]): UnitEntry[] =>
	files.flatMap((file) => {
		const starts = file.metadata.hunks.length
			? file.metadata.hunks.map((hunk) => hunk.deletionStart)
			: [0];
		return starts.map((oldStart) => unitEntry(file.path, oldStart));
	});

const duplicateUnitIssues = (source: string, entries: UnitEntry[]): string[] => {
	const counts = new Map<string, { count: number; label: string }>();
	for (const [key, label] of entries) {
		const current = counts.get(key);
		counts.set(key, { count: (current?.count ?? 0) + 1, label });
	}
	return [...counts.values()].flatMap(({ count, label }) =>
		count > 1 ? [`duplicate ${source} review unit ${label}`] : [],
	);
};

const preparedUnitIssues = (run: PreparedRun, files: DiffFile[]): string[] => {
	const manifestEntries = manifestUnitEntries(run);
	const patchEntries = patchUnitEntries(files);
	const manifest = new Map(manifestEntries);
	const patch = new Map(patchEntries);
	return [
		...duplicateUnitIssues("run.json", manifestEntries),
		...duplicateUnitIssues("diff.patch", patchEntries),
		...[...manifest].flatMap(([key, label]) =>
			patch.has(key) ? [] : [`manifest review unit ${label} is absent from diff.patch`],
		),
		...[...patch].flatMap(([key, label]) =>
			manifest.has(key) ? [] : [`diff.patch review unit ${label} is absent from run.json`],
		),
	];
};

const chapterIdentityIssues = (chapters: Chapter[]): string[] => {
	const ids = new Set<string>();
	const orders = new Set<number>();
	const issues: string[] = [];
	for (const chapter of chapters) {
		if (ids.has(chapter.id)) issues.push(`duplicate chapter id ${JSON.stringify(chapter.id)}`);
		if (orders.has(chapter.order)) issues.push(`duplicate chapter order ${chapter.order}`);
		ids.add(chapter.id);
		orders.add(chapter.order);
	}
	return issues;
};

const exclusionForPath = (run: PreparedRun, path: string): RunExclusion | undefined =>
	run.manifest.exclusions.find(
		(exclusion) => exclusion.path === path || exclusion.matchedPath === path,
	);

const omittedPathExplanation = (
	run: PreparedRun,
	path: string,
	label: string,
): string | undefined => {
	const exclusion = exclusionForPath(run, path);
	if (!exclusion) return undefined;
	const matched =
		exclusion.matchedPath && exclusion.matchedPath !== exclusion.path
			? ` (matched path ${JSON.stringify(exclusion.matchedPath)})`
			: "";
	return `${label} references ${JSON.stringify(path)}, which prep omitted via ${exclusionSource(exclusion)} pattern ${JSON.stringify(exclusion.pattern)}${matched}; regenerate chapters.json from this run's hunks.txt, or adjust the ignore rule and prep a new run`;
};

const reviewUnitIssues = (run: PreparedRun, file: RevueChaptersFile): string[] => {
	const expected = new Map(manifestUnitEntries(run));
	const occurrences = new Map<string, string[]>();
	for (const chapter of file.chapters) {
		for (const reference of chapter.hunkRefs) {
			const key = unitKey(reference.filePath, reference.oldStart);
			occurrences.set(key, [...(occurrences.get(key) ?? []), chapter.id]);
		}
	}
	const issues: string[] = [];
	for (const [key, label] of expected) {
		const owners = occurrences.get(key) ?? [];
		if (!owners.length) issues.push(`missing review unit ${label}`);
		if (owners.length > 1) issues.push(`review unit ${label} appears ${owners.length} times`);
	}
	for (const [key, owners] of occurrences) {
		if (!expected.has(key)) {
			const [path] = JSON.parse(key) as [string, number];
			issues.push(
				omittedPathExplanation(run, path, `chapter ${JSON.stringify(owners[0])}`) ??
					`unknown review unit ${key} in chapter ${owners[0]}`,
			);
		}
	}
	return issues;
};

const hunkContaining = (
	file: DiffFile,
	reference: LineRef,
): DiffFile["metadata"]["hunks"][number] | undefined =>
	file.metadata.hunks.find((hunk) => {
		const start = reference.side === "additions" ? hunk.additionStart : hunk.deletionStart;
		const count = reference.side === "additions" ? hunk.additionCount : hunk.deletionCount;
		return count > 0 && reference.startLine >= start && reference.endLine <= start + count - 1;
	});

const lineReferenceIssue = (
	run: PreparedRun,
	chapter: Chapter,
	keyChangeIndex: number,
	reference: LineRef,
	files: Map<string, DiffFile>,
): string | undefined => {
	const file = files.get(reference.filePath);
	const label = `chapter ${JSON.stringify(chapter.id)} key change ${keyChangeIndex + 1}`;
	if (!file) {
		return (
			omittedPathExplanation(run, reference.filePath, label) ??
			`${label} references unknown file ${JSON.stringify(reference.filePath)}`
		);
	}
	const hunk = hunkContaining(file, reference);
	if (!hunk) {
		return `${label} line range ${reference.side}:${reference.startLine}-${reference.endLine} is outside the pinned hunks for ${JSON.stringify(reference.filePath)}`;
	}
	const ownsHunk = chapter.hunkRefs.some(
		(candidate) =>
			candidate.filePath === reference.filePath && candidate.oldStart === hunk.deletionStart,
	);
	return ownsHunk
		? undefined
		: `${label} line range belongs to review unit ${unitLabel(reference.filePath, hunk.deletionStart)} outside that chapter`;
};

const lineReferenceIssues = (
	run: PreparedRun,
	files: Map<string, DiffFile>,
	chapters: Chapter[],
): string[] => {
	return chapters.flatMap((chapter) =>
		chapter.keyChanges.flatMap((keyChange, keyChangeIndex) =>
			keyChange.lineRefs
				.map((reference) => lineReferenceIssue(run, chapter, keyChangeIndex, reference, files))
				.filter((issue): issue is string => Boolean(issue)),
		),
	);
};

/**
 * An excerpt cites code the agent never transcribed, so the citation is only worth anything once
 * `revue context freeze` has pinned its bytes. A citation may legitimately name a file outside the
 * diff — quoting the untouched caller a change has to satisfy is the point — so the frozen context,
 * not the manifest, is what a citation is checked against.
 */
const excerptIssues = (
	run: PreparedRun,
	file: RevueChaptersFile,
	context: RunContextFile | null,
): string[] => {
	const frozen = new Set((context?.excerpts ?? []).map(excerptKey));
	const unresolved = new Map(
		(context?.unresolved ?? []).map((entry) => [excerptKey(entry), entry]),
	);
	return file.chapters.flatMap((chapter) =>
		chapter.excerpts.flatMap((excerpt) => {
			const label = `chapter ${JSON.stringify(chapter.id)} excerpt ${excerptRangeLabel(excerpt)}`;
			const failure = unresolved.get(excerptKey(excerpt));
			if (failure) return [`${label} could not be frozen: ${failure.reason}`];
			if (frozen.has(excerptKey(excerpt))) return [];
			return [
				`${label} has no frozen content; run \`revue context freeze ${run.directory}\` after writing chapters.json`,
			];
		}),
	);
};

/**
 * What a run inherited, which is what says whether its narration owes the reviewer an epilogue and
 * which threads it may cite. `threads` is null when the store could not be read: a broken store is
 * its own error with its own message wherever threads are used, and must never be reported here as
 * narration citing feedback that does not exist.
 */
export type NarrationLineage = {
	delta: RunDeltaFile | null;
	threads: readonly ReviewThread[] | null;
};

/**
 * A run that continues a narrated review ends with the epilogue the reviewer re-enters through, so
 * a narration that supersedes one and never says what changed is incomplete rather than merely
 * terse. A run starting a fresh lineage owes nothing.
 */
const epilogueIssues = (file: RevueChaptersFile, delta: RunDeltaFile | null): string[] => {
	const epilogues = file.chapters.filter(isEpilogue);
	const [epilogue] = epilogues;
	const last = [...file.chapters].sort((left, right) => left.order - right.order).at(-1);
	return [
		...(!epilogue && delta && supersedesNarration(delta)
			? [
					`this run supersedes narrated run ${delta.supersedes.slice(0, 12)} but no chapter has "role": "epilogue"; a superseding narration ends with what changed since the reviewer read it`,
				]
			: []),
		...(epilogues.length > 1
			? [`${epilogues.length} chapters claim the epilogue role; a review has one re-entry point`]
			: []),
		...(epilogue && last && !isEpilogue(last)
			? [`epilogue ${JSON.stringify(epilogue.id)} is not the last chapter of the narration`]
			: []),
	];
};

/** A citation of feedback the run does not have points the reviewer at nothing. */
const threadReferenceIssues = (
	file: RevueChaptersFile,
	threads: readonly ReviewThread[] | null,
): string[] => {
	if (!threads) return [];
	const known = new Set(threads.map((thread) => thread.id));
	return file.chapters.flatMap((chapter) =>
		threadReferences(chapter)
			.filter((id) => !known.has(id))
			.map(
				(id) =>
					`chapter ${JSON.stringify(chapter.id)} references thread ${id}, which this run does not have`,
			),
	);
};

export function validateReviewCoverage(
	run: PreparedRun,
	file: RevueChaptersFile,
	context: RunContextFile | null = null,
	lineage: NarrationLineage = { delta: null, threads: null },
): void {
	const files = parsePatch(run.patch);
	const issues = [
		...preparedUnitIssues(run, files),
		...chapterIdentityIssues(file.chapters),
		...reviewUnitIssues(run, file),
		...lineReferenceIssues(run, new Map(files.map((entry) => [entry.path, entry])), file.chapters),
		...excerptIssues(run, file, context),
		...epilogueIssues(file, lineage.delta),
		...threadReferenceIssues(file, lineage.threads),
	];
	if (issues.length) {
		throw new ReviewCoverageError(
			`chapters.json does not cover the prepared run:\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
		);
	}
}
