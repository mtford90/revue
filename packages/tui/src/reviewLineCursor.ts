import {
	type DiffLineRange,
	type DiffMeasurement,
	type DiffSide,
	type DiffSourceLineIdentity,
	type DiffVisualPlan,
	plannedRowIdentity,
	structureRowIdentity,
} from "@revue/diff";

type ReviewLinePlan = DiffVisualPlan | DiffMeasurement;

const lineRange = (identity: DiffSourceLineIdentity): DiffLineRange => ({
	filePath: identity.filePath,
	hunkOldStart: identity.hunkOldStart,
	side: identity.side,
	startLine: identity.lineNumber,
	endLine: identity.lineNumber,
});

const measurementLines = (measurement: DiffMeasurement): DiffLineRange[] =>
	measurement.structure.rows.flatMap((row) => {
		if (row.type === "hunk-header") return [];
		if (row.type === "split-line") {
			const side: DiffSide | null =
				row.new.kind === "addition"
					? "additions"
					: row.old.kind === "deletion"
						? "deletions"
						: null;
			const identity = side
				? structureRowIdentity({ structure: measurement.structure, row, side })
				: undefined;
			return identity ? [lineRange(identity)] : [];
		}
		const side: DiffSide | null =
			row.cell.kind === "addition"
				? "additions"
				: row.cell.kind === "deletion"
					? "deletions"
					: null;
		const identity = side
			? structureRowIdentity({ structure: measurement.structure, row, side })
			: undefined;
		return identity ? [lineRange(identity)] : [];
	});

const visualPlanLines = (plan: DiffVisualPlan): DiffLineRange[] =>
	plan.rows.flatMap((row) => {
		if (row.type === "hunk-header") return [];
		if (row.type === "split-line") {
			const first = row.visualRows[0];
			const side: DiffSide | null =
				first?.new.kind === "addition"
					? "additions"
					: first?.old.kind === "deletion"
						? "deletions"
						: null;
			const identity = side ? plannedRowIdentity(row, side) : undefined;
			return identity ? [lineRange(identity)] : [];
		}
		const first = row.visualRows[0]?.cell;
		const side: DiffSide | null =
			first?.kind === "addition" ? "additions" : first?.kind === "deletion" ? "deletions" : null;
		const identity = side ? plannedRowIdentity(row, side) : undefined;
		return identity ? [lineRange(identity)] : [];
	});

/** Ordered changed source lines for keyboard review. Context rows are scenery, not review stops. */
export const reviewableLines = (plan: ReviewLinePlan): DiffLineRange[] =>
	"structure" in plan ? measurementLines(plan) : visualPlanLines(plan);

const sameLine = (left: DiffLineRange, right: DiffLineRange): boolean =>
	left.filePath === right.filePath &&
	left.hunkOldStart === right.hunkOldStart &&
	left.side === right.side &&
	left.startLine === right.startLine;

const sameAnchorDomain = (left: DiffLineRange, right: DiffLineRange): boolean =>
	left.filePath === right.filePath &&
	left.hunkOldStart === right.hunkOldStart &&
	left.side === right.side;

/** Start on current-side code whenever the file has any, retaining deletion-only reviewability. */
export const initialReviewLine = (lines: readonly DiffLineRange[]): DiffLineRange | null =>
	lines.find((line) => line.side === "additions") ?? lines[0] ?? null;

/** Move one source line without wrapping; a live selection cannot cross its anchor contract. */
export const moveReviewLine = ({
	lines,
	current,
	delta,
	selectionAnchor,
}: {
	lines: readonly DiffLineRange[];
	current: DiffLineRange | null;
	delta: -1 | 1;
	selectionAnchor?: DiffLineRange | null;
}): DiffLineRange | null => {
	if (!lines.length) return null;
	const fallback = initialReviewLine(lines);
	if (!current) return fallback;
	const index = lines.findIndex((line) => sameLine(line, current));
	if (index < 0) return selectionAnchor ? current : fallback;
	const candidateIndex = Math.max(0, Math.min(index + delta, lines.length - 1));
	if (!selectionAnchor) return lines[candidateIndex] ?? current;
	for (
		let nextIndex = candidateIndex;
		nextIndex >= 0 && nextIndex < lines.length;
		nextIndex += delta
	) {
		const candidate = lines[nextIndex];
		if (!candidate) break;
		if (
			candidate.filePath !== selectionAnchor.filePath ||
			candidate.hunkOldStart !== selectionAnchor.hunkOldStart
		)
			break;
		if (sameAnchorDomain(selectionAnchor, candidate)) return candidate;
	}
	return current;
};

/** Inclusive anchor range for the shared pointer/keyboard selection renderer. */
export const reviewLineSelection = (
	anchor: DiffLineRange,
	cursor: DiffLineRange,
): DiffLineRange | null =>
	sameAnchorDomain(anchor, cursor)
		? {
				...anchor,
				startLine: Math.min(anchor.startLine, cursor.startLine),
				endLine: Math.max(anchor.endLine, cursor.endLine),
			}
		: null;
