import type { DiffFile } from "@revue/diff-model";
import type {
	DecorationAnchor,
	DiffInlineAttachment,
	DiffLineRange,
	DiffRow,
	DiffSide,
} from "./types.ts";

/**
 * The range a click on `side` of a rendered row would emit: either from the
 * row's own hunk, or through `resolveRange` when the body's hunks are
 * display-only (e.g. an expanded-context variant of an authoritative patch).
 */
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

/** The inline attachments anchored to this rendered row (on its `endLine`). */
export const attachmentsForRow = ({
	file,
	row,
	attachments,
	resolveRange,
}: {
	file: DiffFile;
	row: DiffRow;
	attachments: readonly DiffInlineAttachment[];
	resolveRange?: (side: DiffSide, lineNumber: number) => DiffLineRange | null;
}): DiffInlineAttachment[] => {
	if (row.type === "hunk-header") return [];
	return attachments.filter((attachment) => {
		const range = rowLineRange({ file, row, side: attachment.anchor.side, resolveRange });
		return (
			range !== null &&
			range.filePath === attachment.anchor.filePath &&
			range.hunkOldStart === attachment.anchor.hunkOldStart &&
			range.endLine === attachment.anchor.endLine
		);
	});
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
