import type { DiffFile, DiffLineRange, DiffRow, DiffSide } from "@revue/diff";
import { rowLineRange } from "@revue/diff";
import type { ReactNode } from "react";

export type DiffInlineAttachment = {
	id: string;
	anchor: DiffLineRange;
	content: ReactNode;
};

/** The React-valued inline attachments anchored after this logical rendered row. */
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
