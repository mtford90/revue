import type { DiffMeasurement, DiffVisualPlan, PlannedDiffRow, PlannedVisualCell } from "./plan.ts";
import { structureRowIdentity } from "./plan.ts";
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

const matchesAnchor = (identity: DiffSourceLineIdentity | undefined, anchor: DecorationAnchor) =>
	identity?.hunkIndex === anchor.hunkIndex && identity.lineNumber === anchor.lineNumber;

/** Resolve an anchor against the exact logical identities used for height and rendering. */
export const anchorRowIndex = (
	plan: DiffVisualPlan | DiffMeasurement,
	anchor: DecorationAnchor,
): number => {
	if ("rows" in plan)
		return plan.rows.findIndex((row) =>
			matchesAnchor(plannedRowIdentity(row, anchor.side), anchor),
		);
	return plan.structure.rows.findIndex((row) =>
		matchesAnchor(
			structureRowIdentity({ structure: plan.structure, row, side: anchor.side }),
			anchor,
		),
	);
};
