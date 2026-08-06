import type { DiffVisualPlan, PlannedDiffRow, PlannedVisualCell } from "./plan.ts";
import type { DecorationAnchor, DiffSide, DiffSourceLineIdentity } from "./types.ts";

const firstCell = (
	row: Exclude<PlannedDiffRow, { type: "hunk-header" }>,
	side: DiffSide,
): PlannedVisualCell | undefined => {
	if (row.type === "stack-line") return row.visualRows[0]?.cell;
	const visual = row.visualRows[0];
	return side === "deletions" ? visual?.old : visual?.new;
};

/** Read one logical planned row's durable source identity on the requested side. */
export const plannedRowIdentity = (
	row: PlannedDiffRow,
	side: DiffSide,
): DiffSourceLineIdentity | undefined =>
	row.type === "hunk-header" ? undefined : firstCell(row, side)?.identities[side];

/** Resolve an anchor against the exact planned logical identities used for height and rendering. */
export const anchorRowIndex = (plan: DiffVisualPlan, anchor: DecorationAnchor): number =>
	plan.rows.findIndex((row) => {
		const identity = plannedRowIdentity(row, anchor.side);
		return identity?.hunkIndex === anchor.hunkIndex && identity.lineNumber === anchor.lineNumber;
	});
