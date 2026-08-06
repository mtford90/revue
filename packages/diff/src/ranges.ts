import type { DecorationAnchor, DiffFile, DiffLineRange, DiffRow, DiffSide } from "./types.ts";

/** Resolve one logical source row to its durable side-aware hunk range. */
export const rowLineRange = ({
	file,
	row,
	side,
	resolveRange,
}: {
	file: DiffFile;
	row: DiffRow;
	side: DiffSide;
	resolveRange?: (side: DiffSide, lineNumber: number) => DiffLineRange | null;
}): DiffLineRange | null => {
	if (row.type === "hunk-header") return null;
	const cell = row.type === "split-line" ? (side === "deletions" ? row.old : row.new) : row.cell;
	const number = side === "deletions" ? cell.oldLineNumber : cell.newLineNumber;
	if (number === undefined) return null;
	if (resolveRange) return resolveRange(side, number);
	const hunk = file.metadata.hunks[row.hunkIndex];
	if (!hunk) return null;
	return {
		filePath: file.path,
		hunkOldStart: hunk.deletionStart,
		side,
		startLine: number,
		endLine: number,
	};
};

export const rowHasAnchor = (row: DiffRow, anchor: DecorationAnchor): boolean => {
	if (row.type === "hunk-header" || row.hunkIndex !== anchor.hunkIndex) return false;
	if (row.type === "split-line") {
		return anchor.side === "deletions"
			? row.old.oldLineNumber === anchor.lineNumber
			: row.new.newLineNumber === anchor.lineNumber;
	}
	return anchor.side === "deletions"
		? row.cell.oldLineNumber === anchor.lineNumber
		: row.cell.newLineNumber === anchor.lineNumber;
};

export const anchorRowIndex = (rows: readonly DiffRow[], anchor: DecorationAnchor): number =>
	rows.findIndex((row) => rowHasAnchor(row, anchor));
