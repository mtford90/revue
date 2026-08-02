import { type DiffFile, parsePatch } from "@revue/diff-model";
import type { Chapter, LineRef, RevueChaptersFile } from "@revue/types";
import type { PreparedRun } from "./artifact.ts";

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

const reviewUnitIssues = (run: PreparedRun, chapters: Chapter[]): string[] => {
	const expected = new Map(manifestUnitEntries(run));
	const occurrences = new Map<string, string[]>();
	for (const chapter of chapters) {
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
		if (!expected.has(key)) issues.push(`unknown review unit ${key} in chapter ${owners[0]}`);
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
	chapter: Chapter,
	keyChangeIndex: number,
	reference: LineRef,
	files: Map<string, DiffFile>,
): string | undefined => {
	const file = files.get(reference.filePath);
	const label = `chapter ${JSON.stringify(chapter.id)} key change ${keyChangeIndex + 1}`;
	if (!file) return `${label} references unknown file ${JSON.stringify(reference.filePath)}`;
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

const lineReferenceIssues = (files: Map<string, DiffFile>, chapters: Chapter[]): string[] => {
	return chapters.flatMap((chapter) =>
		chapter.keyChanges.flatMap((keyChange, keyChangeIndex) =>
			keyChange.lineRefs
				.map((reference) => lineReferenceIssue(chapter, keyChangeIndex, reference, files))
				.filter((issue): issue is string => Boolean(issue)),
		),
	);
};

export function validateReviewCoverage(run: PreparedRun, file: RevueChaptersFile): void {
	const files = parsePatch(run.patch);
	const issues = [
		...preparedUnitIssues(run, files),
		...chapterIdentityIssues(file.chapters),
		...reviewUnitIssues(run, file.chapters),
		...lineReferenceIssues(new Map(files.map((entry) => [entry.path, entry])), file.chapters),
	];
	if (issues.length) {
		throw new ReviewCoverageError(
			`chapters.json does not cover the prepared run:\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
		);
	}
}
