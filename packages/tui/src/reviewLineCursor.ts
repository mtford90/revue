import {
	type DiffLineRange,
	type DiffMeasurement,
	type DiffPresentationRow,
	type DiffSelection,
	type DiffSelectionStop,
	type DiffSide,
	type DiffVisualPlan,
	diffPresentationRows,
	moveSplitSelectionStop,
	moveStackedSelectionStop,
	presentationRowStop,
	rectangularSelectionBetween,
	stackedSelectionBetween,
	switchSplitSelectionStop,
} from "@revue/diff";

type ReviewLinePlan = DiffVisualPlan | DiffMeasurement;

export type ReviewLineFile = {
	filePath: string;
	layout: "split" | "stack";
	rows: readonly DiffPresentationRow[];
};

const sourceFile = (plan: ReviewLinePlan) =>
	"structure" in plan ? plan.structure.file : plan.file;

const sourceLayout = (plan: ReviewLinePlan) =>
	"structure" in plan ? plan.structure.layout : plan.layout;

const rangeForStop = (stop: DiffSelectionStop): DiffLineRange => ({
	filePath: stop.filePath,
	hunkOldStart: stop.oldStart,
	side: stop.side,
	startLine: stop.lineNumber,
	endLine: stop.lineNumber,
});

export const reviewStopForLine = (line: DiffLineRange): DiffSelectionStop => ({
	filePath: line.filePath,
	oldStart: line.hunkOldStart,
	side: line.side,
	lineNumber: line.startLine,
});

const sameStop = (left: DiffSelectionStop, right: DiffSelectionStop): boolean =>
	left.filePath === right.filePath &&
	left.oldStart === right.oldStart &&
	left.side === right.side &&
	left.lineNumber === right.lineNumber;

const rowHasStop = (row: DiffPresentationRow, stop: DiffSelectionStop): boolean =>
	row.stops.some((candidate) => sameStop(candidate, stop));

/** Changed presentation rows for ordinary source navigation. */
export const reviewLineFile = (plan: ReviewLinePlan): ReviewLineFile => {
	const file = sourceFile(plan);
	const layout = sourceLayout(plan);
	return {
		filePath: file.path,
		layout,
		rows: diffPresentationRows(file, layout).filter((row) => row.kind === "change"),
	};
};

/** Every original-hunk presentation row for file-local selection extension. */
export const selectionLineFile = (plan: ReviewLinePlan): ReviewLineFile => {
	const file = sourceFile(plan);
	const layout = sourceLayout(plan);
	return { filePath: file.path, layout, rows: diffPresentationRows(file, layout) };
};

/**
 * Ordered changed source lines for compatibility with callers that need a flat list. Split prefers
 * current-side code; stacked follows visible source-row order and counts context at most once.
 */
export const reviewableLines = (plan: ReviewLinePlan): DiffLineRange[] => {
	const file = reviewLineFile(plan);
	return file.rows.map((row) => rangeForStop(presentationRowStop(row, "additions")));
};

/** Start on current-side code whenever the file has any, retaining deletion-only reviewability. */
export const initialReviewLine = (file: ReviewLineFile | null): DiffLineRange | null => {
	if (!file) return null;
	const current = file.rows.flatMap(
		(row) => row.stops.find((stop) => stop.side === "additions") ?? [],
	)[0];
	const fallback = file.rows[0] ? presentationRowStop(file.rows[0]) : undefined;
	const selected = current ?? fallback;
	return selected ? rangeForStop(selected) : null;
};

export const reviewLineFileContains = (
	file: ReviewLineFile | null,
	line: DiffLineRange | null,
): line is DiffLineRange => {
	if (!file || !line || line.startLine !== line.endLine) return false;
	const stop = reviewStopForLine(line);
	return file.rows.some((row) => rowHasStop(row, stop));
};

const boundaryLine = ({
	file,
	delta,
	preferredSide,
}: {
	file: ReviewLineFile;
	delta: -1 | 1;
	preferredSide?: DiffSide;
}): DiffLineRange | null => {
	const rows = delta === 1 ? file.rows : [...file.rows].reverse();
	if (file.layout === "split" && preferredSide) {
		for (const row of rows) {
			const stop = row.stops.find((candidate) => candidate.side === preferredSide);
			if (stop) return rangeForStop(stop);
		}
	}
	const row = rows[0];
	return row ? rangeForStop(presentationRowStop(row)) : null;
};

/**
 * Ordinary movement crosses expanded files. Split retains its pane whenever the destination file
 * has that side; stacked follows its visible old-then-new source-row order.
 */
export const moveReviewLine = ({
	files,
	current,
	delta,
}: {
	files: readonly ReviewLineFile[];
	current: DiffLineRange | null;
	delta: -1 | 1;
}): DiffLineRange | null => {
	if (!files.length) return null;
	if (!current) return initialReviewLine(files[0] ?? null);
	const fileIndex = files.findIndex((file) => file.filePath === current.filePath);
	const file = files[fileIndex];
	if (!file) return initialReviewLine(files[0] ?? null);
	const stop = reviewStopForLine(current);
	const moved =
		file.layout === "split"
			? moveSplitSelectionStop({ rows: file.rows, current: stop, delta })
			: moveStackedSelectionStop({ rows: file.rows, current: stop, delta });
	if (!sameStop(moved, stop)) return rangeForStop(moved);
	for (let index = fileIndex + delta; index >= 0 && index < files.length; index += delta) {
		const candidate = files[index];
		if (!candidate?.rows.length) continue;
		const boundary = boundaryLine({
			file: candidate,
			delta,
			preferredSide: file.layout === "split" ? current.side : undefined,
		});
		if (boundary) return boundary;
	}
	return current;
};

/** Same-row old/new motion for split review; stacked is intentionally inert. */
export const switchReviewLineSide = ({
	file,
	current,
	side,
}: {
	file: ReviewLineFile | null;
	current: DiffLineRange | null;
	side: DiffSide;
}): DiffLineRange | null => {
	if (!file || !current || file.layout !== "split") return current;
	return rangeForStop(
		switchSplitSelectionStop({ rows: file.rows, current: reviewStopForLine(current), side }),
	);
};

/** File-local selection movement uses all original-hunk rows in the active presentation. */
export const moveSelectionReviewLine = ({
	file,
	current,
	delta,
}: {
	file: ReviewLineFile | null;
	current: DiffLineRange | null;
	delta: -1 | 1;
}): DiffLineRange | null => {
	if (!file || !current) return current;
	const stop = reviewStopForLine(current);
	return rangeForStop(
		file.layout === "split"
			? moveSplitSelectionStop({ rows: file.rows, current: stop, delta })
			: moveStackedSelectionStop({ rows: file.rows, current: stop, delta }),
	);
};

/** Active selection follows split rectangles or one-stop-per-visible-row stacked order. */
export const reviewLineSelection = ({
	file,
	anchor,
	cursor,
}: {
	file: ReviewLineFile | null;
	anchor: DiffLineRange;
	cursor: DiffLineRange;
}): DiffSelection | null => {
	if (!file) return null;
	const start = reviewStopForLine(anchor);
	const focus = reviewStopForLine(cursor);
	return file.layout === "split"
		? rectangularSelectionBetween(file.rows, start, focus)
		: stackedSelectionBetween(file.rows, start, focus);
};
