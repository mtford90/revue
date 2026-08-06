import {
	type DiffLineRange,
	type DiffRow,
	type DiffSide,
	type DiffStructure,
	type PlannedDiffRow,
	plannedRowIdentity,
	structureRowIdentity,
} from "@revue/diff";
import type { ReactNode } from "react";

export type DiffInlineAttachment = {
	id: string;
	anchor: DiffLineRange;
	content: ReactNode;
};

/** The React-valued inline attachments anchored after this exact planned logical row. */
export const attachmentsForRow = ({
	row,
	attachments,
	resolveRange,
}: {
	row: PlannedDiffRow | { structure: DiffStructure; row: DiffRow };
	attachments: readonly DiffInlineAttachment[];
	resolveRange?: (side: DiffSide, lineNumber: number) => DiffLineRange | null;
}): DiffInlineAttachment[] => {
	const logical = "structure" in row ? row.row : row;
	if (logical.type === "hunk-header") return [];
	return attachments.filter((attachment) => {
		const identity =
			"structure" in row
				? structureRowIdentity({
						structure: row.structure,
						row: row.row,
						side: attachment.anchor.side,
					})
				: plannedRowIdentity(row, attachment.anchor.side);
		if (!identity) return false;
		const range = resolveRange
			? resolveRange(identity.side, identity.lineNumber)
			: {
					filePath: identity.filePath,
					hunkOldStart: identity.hunkOldStart,
					side: identity.side,
					startLine: identity.lineNumber,
					endLine: identity.lineNumber,
				};
		return (
			range !== null &&
			range.filePath === attachment.anchor.filePath &&
			range.hunkOldStart === attachment.anchor.hunkOldStart &&
			range.endLine === attachment.anchor.endLine
		);
	});
};
