import type { DiffLineRange, DiffSide } from "./types.ts";

const TAG = "diff-line";

/** Names a rendered code line so a text selection can be mapped back to the lines it covers. */
export const diffLineId = ({ hunkOldStart, side, startLine, filePath }: DiffLineRange): string =>
	[TAG, hunkOldStart, side, startLine, filePath].join(":");

const parseDiffLineId = (id: string): DiffLineRange | null => {
	// A path may hold colons of its own, so only the fixed prefix is split off.
	const parts = id.split(":");
	const filePath = parts.slice(4).join(":");
	const [tag, hunkOldStart, side, line] = parts;
	if (tag !== TAG || !filePath) return null;
	if (side !== "additions" && side !== "deletions") return null;
	return {
		filePath,
		hunkOldStart: Number(hunkOldStart),
		side: side satisfies DiffSide,
		startLine: Number(line),
		endLine: Number(line),
	};
};

/**
 * The span the highlighted lines cover within one anchor's file, side and hunk, so a selection
 * that runs past any of those still yields a range the anchor can express.
 */
export const diffRangeWithin = (
	anchor: DiffLineRange,
	ids: readonly string[],
): DiffLineRange | null => {
	const lines = ids
		.map(parseDiffLineId)
		.filter(
			(line): line is DiffLineRange =>
				line !== null &&
				line.filePath === anchor.filePath &&
				line.side === anchor.side &&
				line.hunkOldStart === anchor.hunkOldStart,
		)
		.map((line) => line.startLine);
	if (!lines.length) return null;
	return { ...anchor, startLine: Math.min(...lines), endLine: Math.max(...lines) };
};
