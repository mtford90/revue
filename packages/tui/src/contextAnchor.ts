import {
	CONTEXT_HUNK_OLD_START,
	type DiffFile,
	type DiffLineRange,
	type DiffSelection,
	type DiffSelectionRange,
	type DiffSide,
} from "@revue/diff";
import {
	type Chapter,
	type ContextThreadAnchor,
	canonicalizeSelectionSegments,
	type SelectionThreadAnchor,
	THREAD_ANCHOR_KIND,
} from "@revue/types";

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
 * Expansion geometry is new-blob based. An unchanged old-side gap can therefore be revealed only
 * after mapping it to its identical new-side bytes; the durable anchor remains old-side.
 */
export const newRangeForOldContext = (
	hunks: readonly Hunk[],
	startLine: number,
	endLine: number,
): { startLine: number; endLine: number } | null => {
	if (
		hunks.some(
			(hunk) =>
				holds(hunk, "deletions", startLine) ||
				holds(hunk, "deletions", endLine) ||
				(hunk.deletionStart > startLine && hunk.deletionStart <= endLine),
		)
	)
		return null;
	return {
		startLine: newLineForOld(hunks, startLine),
		endLine: newLineForOld(hunks, endLine),
	};
};

/**
 * Resolve durable context authority into destination display geometry. A carried range may straddle
 * ordinary rows already present in original hunks and rows revealed only by expansion; each piece
 * keeps its semantic side while taking the row identity the renderer actually mounts.
 */
export const displayRangesForContext = (
	hunks: readonly Hunk[],
	side: DiffSide,
	startLine: number,
	endLine: number,
): DiffSelectionRange[] => {
	const ranges: DiffSelectionRange[] = [];
	let cursor = startLine;
	const intersecting = hunks
		.flatMap((hunk) => {
			const hunkStart = side === "additions" ? hunk.additionStart : hunk.deletionStart;
			const count = side === "additions" ? hunk.additionCount : hunk.deletionCount;
			const from = Math.max(startLine, hunkStart);
			const to = Math.min(endLine, hunkStart + count - 1);
			return count > 0 && from <= to ? [{ hunk, from, to }] : [];
		})
		.sort((left, right) => left.from - right.from);
	for (const { hunk, from, to } of intersecting) {
		if (cursor < from) {
			ranges.push({ oldStart: CONTEXT_HUNK_OLD_START, side, startLine: cursor, endLine: from - 1 });
		}
		ranges.push({ oldStart: hunk.deletionStart, side, startLine: from, endLine: to });
		cursor = to + 1;
	}
	if (cursor <= endLine) {
		ranges.push({ oldStart: CONTEXT_HUNK_OLD_START, side, startLine: cursor, endLine });
	}
	return ranges;
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
		return {
			filePath: path,
			hunkOldStart: CONTEXT_HUNK_OLD_START,
			side,
			startLine: line,
			endLine: line,
		};
	};

const isContextRange = (range: DiffSelection["ranges"][number]): boolean =>
	range.oldStart === CONTEXT_HUNK_OLD_START;

/**
 * Classify which authorities a diff-body selection spans before the TUI persists its segmented
 * selection anchor.
 */
export const contextSelectionKind = (selection: DiffSelection): "patch" | "context" | "mixed" => {
	const context = selection.ranges.filter(isContextRange).length;
	if (context === 0) return "patch";
	return context === selection.ranges.length ? "context" : "mixed";
};

/** Preserve each displayed authority; context geometry's private oldStart never reaches storage. */
export const selectionAnchorFor = (selection: DiffSelection): SelectionThreadAnchor => ({
	kind: "selection",
	filePath: selection.filePath,
	segments: canonicalizeSelectionSegments(
		selection.ranges.map((range) =>
			isContextRange(range)
				? {
						kind: THREAD_ANCHOR_KIND.CONTEXT,
						side: range.side,
						startLine: range.startLine,
						endLine: range.endLine,
					}
				: {
						kind: THREAD_ANCHOR_KIND.PATCH,
						oldStart: range.oldStart,
						side: range.side,
						startLine: range.startLine,
						endLine: range.endLine,
					},
		),
	) as SelectionThreadAnchor["segments"],
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
