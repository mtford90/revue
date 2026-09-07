import {
	CONTEXT_HUNK_OLD_START,
	type DiffFile,
	type DiffLineRange,
	type DiffSelection,
	type DiffSide,
} from "@revue/diff";
import { type Chapter, type ContextThreadAnchor, THREAD_ANCHOR_KIND } from "@revue/types";

// Revealed context is the file itself, read from the run's pinned new blob, so a comment on it
// names a new-side line range and no review unit — the same shape as a quoted excerpt, resolved
// against the blob instead of the frozen context. Everything here is arithmetic over the git hunks.

type Hunk = DiffFile["metadata"]["hunks"][number];

const hunksFor = (diffFiles: readonly DiffFile[] | null, path: string): Hunk[] =>
	diffFiles?.find((candidate) => candidate.path === path)?.metadata.hunks ?? [];

const holds = (hunk: Hunk, side: DiffSide, line: number): boolean => {
	const start = side === "additions" ? hunk.additionStart : hunk.deletionStart;
	const count = side === "additions" ? hunk.additionCount : hunk.deletionCount;
	return count > 0 && line >= start && line < start + count;
};

/**
 * The new-side number of an unchanged old-side line. Outside every hunk the two sides differ by
 * whatever the hunks above added and removed, so the nearest hunk above says how far to shift.
 */
export const newLineForOld = (hunks: readonly Hunk[], oldLine: number): number => {
	const above = hunks.filter((hunk) => hunk.deletionStart + hunk.deletionCount <= oldLine).at(-1);
	if (!above) return oldLine;
	return (
		oldLine + above.additionStart + above.additionCount - above.deletionStart - above.deletionCount
	);
};

/**
 * Where a displayed line of an expanded file resolves: inside a git hunk it is that review unit's
 * line, and outside every hunk it is revealed context, which both sides name by its new-side number.
 */
export const gitRangeResolver =
	(diffFiles: readonly DiffFile[] | null, path: string) =>
	(side: DiffSide, line: number): DiffLineRange | null => {
		const hunks = hunksFor(diffFiles, path);
		const hunk = hunks.find((candidate) => holds(candidate, side, line));
		if (hunk) {
			return {
				filePath: path,
				hunkOldStart: hunk.deletionStart,
				side,
				startLine: line,
				endLine: line,
			};
		}
		const newLine = side === "additions" ? line : newLineForOld(hunks, line);
		return {
			filePath: path,
			hunkOldStart: CONTEXT_HUNK_OLD_START,
			side: "additions",
			startLine: newLine,
			endLine: newLine,
		};
	};

const isContextRange = (range: DiffSelection["ranges"][number]): boolean =>
	range.oldStart === CONTEXT_HUNK_OLD_START;

/**
 * What a diff-body selection asks for: a patch anchor when it lies on review units, a context
 * anchor when every range is revealed context, and nothing when it mixes the two — a mixed
 * selection has no one authority to resolve against.
 */
export const contextSelectionKind = (selection: DiffSelection): "patch" | "context" | "mixed" => {
	const context = selection.ranges.filter(isContextRange).length;
	if (context === 0) return "patch";
	return context === selection.ranges.length ? "context" : "mixed";
};

export const contextAnchorFor = (selection: DiffSelection): ContextThreadAnchor => ({
	kind: THREAD_ANCHOR_KIND.CONTEXT,
	filePath: selection.filePath,
	startLine: Math.min(...selection.ranges.map((range) => range.startLine)),
	endLine: Math.max(...selection.ranges.map((range) => range.endLine)),
});

const distance = (hunk: Hunk, anchor: ContextThreadAnchor): number => {
	const top = hunk.additionCount ? hunk.additionStart : hunk.additionStart + 1;
	const bottom = hunk.additionStart + Math.max(0, hunk.additionCount - 1);
	if (anchor.endLine < top) return top - anchor.endLine;
	if (anchor.startLine > bottom) return anchor.startLine - bottom;
	return 0;
};

/**
 * Revealed context belongs to no review unit, so the chapter that reads it is the one narrating
 * the nearest hunk of that file. Without hunks to measure, any chapter naming the file will do.
 */
export const chapterOwnsContextAnchor = (
	chapter: Chapter,
	diffFiles: readonly DiffFile[] | null,
	anchor: ContextThreadAnchor,
): boolean => {
	const nearest = [...hunksFor(diffFiles, anchor.filePath)].sort(
		(left, right) => distance(left, anchor) - distance(right, anchor),
	)[0];
	return chapter.hunkRefs.some(
		(reference) =>
			reference.filePath === anchor.filePath &&
			(nearest === undefined || reference.oldStart === nearest.deletionStart),
	);
};
