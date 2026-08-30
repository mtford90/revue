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
import { attachmentAnchoredAt } from "@revue/diff-opentui";

type ReviewLinePlan = DiffVisualPlan | DiffMeasurement;

/** What the cursor needs of an inline card: the thread it holds and the line it hangs from. */
export type ReviewCard = { id: string; anchor: DiffLineRange };

/** Where the review cursor rests: a source line, or a thread card hanging beneath one. */
export type ReviewStop =
	| { kind: "line"; line: DiffLineRange }
	| { kind: "thread"; threadId: string; anchor: DiffLineRange };

export type ReviewLineFile = {
	filePath: string;
	layout: "split" | "stack";
	/** Every presentation row, retained so pointer and selection cursors keep their identity. */
	rows: readonly DiffPresentationRow[];
	/** Changed rows are the actionable boundaries and destinations for ordinary vertical motion. */
	changedRows: readonly DiffPresentationRow[];
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

/** Full presentation identity paired with the actionable changed rows. */
export const reviewLineFile = (plan: ReviewLinePlan): ReviewLineFile => {
	const file = sourceFile(plan);
	const layout = sourceLayout(plan);
	const rows = diffPresentationRows(file, layout);
	return {
		filePath: file.path,
		layout,
		rows,
		changedRows: rows.filter((row) => row.kind === "change"),
	};
};

/** Every original-hunk presentation row for file-local selection extension. */
export const selectionLineFile = reviewLineFile;

/**
 * Ordered changed source lines for compatibility with callers that need a flat list. Split prefers
 * current-side code; stacked follows visible source-row order and counts context at most once.
 */
export const reviewableLines = (plan: ReviewLinePlan): DiffLineRange[] => {
	const file = reviewLineFile(plan);
	return file.changedRows.map((row) => rangeForStop(presentationRowStop(row, "additions")));
};

/** Start on current-side code whenever the file has any, retaining deletion-only reviewability. */
export const initialReviewLine = (file: ReviewLineFile | null): DiffLineRange | null => {
	if (!file) return null;
	const current = file.changedRows.flatMap(
		(row) => row.stops.find((stop) => stop.side === "additions") ?? [],
	)[0];
	const fallback = file.changedRows[0] ? presentationRowStop(file.changedRows[0]) : undefined;
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

/** The line a stop reads from: a card answers with the line it hangs from, never with itself. */
export const reviewStopRange = (stop: ReviewStop): DiffLineRange =>
	stop.kind === "line" ? stop.line : stop.anchor;

const sameRange = (left: DiffLineRange, right: DiffLineRange): boolean =>
	left.filePath === right.filePath &&
	left.hunkOldStart === right.hunkOldStart &&
	left.side === right.side &&
	left.startLine === right.startLine &&
	left.endLine === right.endLine;

const sameReviewStop = (left: ReviewStop, right: ReviewStop): boolean =>
	left.kind === "thread"
		? right.kind === "thread" && left.threadId === right.threadId
		: right.kind === "line" && sameRange(left.line, right.line);

/** The cards one row carries, matched by the rule inline attachments are placed with. */
const cardsForRow = (
	row: DiffPresentationRow,
	cards: readonly ReviewCard[],
): readonly ReviewCard[] =>
	cards.filter((card) => {
		const stop = row.stops.find((candidate) => candidate.side === card.anchor.side);
		return (
			stop !== undefined &&
			attachmentAnchoredAt({ anchor: card.anchor, candidate: rangeForStop(stop) })
		);
	});

/** The lane a changed row offers: a split pane skips the rows it has no authority on. */
const laneStop = (
	row: DiffPresentationRow,
	layout: "split" | "stack",
	side?: DiffSide,
): DiffSelectionStop | undefined => {
	if (side === undefined) return presentationRowStop(row);
	return layout === "split"
		? row.stops.find((candidate) => candidate.side === side)
		: presentationRowStop(row, side);
};

/** A stop with the row it belongs to, so a cursor resting between stops still knows its place. */
type PlacedStop = { stop: ReviewStop; rowIndex: number };

const placeStops = ({
	file,
	cards,
	side,
}: {
	file: ReviewLineFile;
	cards: readonly ReviewCard[];
	side?: DiffSide;
}): PlacedStop[] =>
	file.rows.flatMap((row, rowIndex): PlacedStop[] => {
		const line = row.kind === "change" ? laneStop(row, file.layout, side) : undefined;
		return [
			...(line ? [{ stop: { kind: "line" as const, line: rangeForStop(line) }, rowIndex }] : []),
			...cardsForRow(row, cards).map((card) => ({
				stop: { kind: "thread" as const, threadId: card.id, anchor: card.anchor },
				rowIndex,
			})),
		];
	});

/** A file with nothing in the requested lane is walked on the authority its rows do have. */
const placedWalk = (args: {
	file: ReviewLineFile;
	cards: readonly ReviewCard[];
	side?: DiffSide;
}): PlacedStop[] => {
	const placed = placeStops(args);
	return placed.some(({ stop }) => stop.kind === "line")
		? placed
		: placeStops({ ...args, side: undefined });
};

/**
 * One file's stops in walking order: each changed row in the lane, then the cards hanging from it.
 * Cards are side-neutral, so a card on the other pane still stops the walk that passes it.
 */
export const reviewStops = ({
	file,
	cards = [],
	side,
}: {
	file: ReviewLineFile;
	cards?: readonly ReviewCard[];
	side?: DiffSide;
}): ReviewStop[] => placedWalk({ file, cards, side }).map(({ stop }) => stop);

const firstReviewStop = (file: ReviewLineFile | null): ReviewStop | null => {
	const line = initialReviewLine(file);
	return line ? { kind: "line", line } : null;
};

/** The stop next to a cursor that is not itself a stop, such as a line clicked on context. */
const stopBesideRow = (stops: readonly PlacedStop[], rowIndex: number, delta: -1 | 1) =>
	delta === 1
		? stops.find(
				(placed) =>
					placed.rowIndex > rowIndex ||
					(placed.rowIndex === rowIndex && placed.stop.kind === "thread"),
			)
		: [...stops].reverse().find((placed) => placed.rowIndex < rowIndex);

const stepWithinFile = ({
	stops,
	file,
	current,
	delta,
}: {
	stops: readonly PlacedStop[];
	file: ReviewLineFile;
	current: ReviewStop;
	delta: -1 | 1;
}): ReviewStop | null => {
	const at = stops.findIndex((placed) => sameReviewStop(placed.stop, current));
	if (at >= 0) return stops[at + delta]?.stop ?? null;
	// A card the walk does not hold — a quoted one, say — re-enters this file at its edge.
	if (current.kind === "thread") return (delta === 1 ? stops[0] : stops.at(-1))?.stop ?? null;
	const rowIndex = file.rows.findIndex((row) => rowHasStop(row, reviewStopForLine(current.line)));
	if (rowIndex < 0) return null;
	return stopBesideRow(stops, rowIndex, delta)?.stop ?? null;
};

/**
 * Ordinary movement crosses expanded files. Split retains its pane whenever the destination file
 * has that side; stacked follows its visible old-then-new source-row order.
 */
export const moveReviewStop = ({
	files,
	cards = [],
	current,
	delta,
}: {
	files: readonly ReviewLineFile[];
	cards?: readonly ReviewCard[];
	current: ReviewStop | null;
	delta: -1 | 1;
}): ReviewStop | null => {
	if (!files.length) return null;
	if (!current) return firstReviewStop(files[0] ?? null);
	const from = reviewStopRange(current);
	const fileIndex = files.findIndex((file) => file.filePath === from.filePath);
	const file = files[fileIndex];
	if (!file) return firstReviewStop(files[0] ?? null);
	const within = stepWithinFile({
		stops: placedWalk({ file, cards, side: from.side }),
		file,
		current,
		delta,
	});
	if (within) return within;
	for (let index = fileIndex + delta; index >= 0 && index < files.length; index += delta) {
		const candidate = files[index];
		if (!candidate?.changedRows.length) continue;
		const stops = placedWalk({
			file: candidate,
			cards,
			side: file.layout === "split" ? from.side : undefined,
		});
		const boundary = delta === 1 ? stops[0] : stops.at(-1);
		if (boundary) return boundary.stop;
	}
	return current;
};

/** File-local old/new motion for split review; stacked is intentionally inert. */
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
