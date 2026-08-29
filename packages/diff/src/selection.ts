import { diffStructure, structureRowIdentity } from "./plan.ts";
import type { DiffFile, DiffLayout, DiffRow, DiffSide } from "./types.ts";

export type NonEmptyArray<Value> = [Value, ...Value[]];

/** One independently authoritative segment of a file-scoped patch selection. */
export type DiffSelectionRange = {
	oldStart: number;
	side: DiffSide;
	startLine: number;
	endLine: number;
};

/** A non-empty selection on one patch file, independent of comments or any presentation adapter. */
export type DiffSelection = {
	filePath: string;
	ranges: NonEmptyArray<DiffSelectionRange>;
};

/** One selectable source-line position in canonical display order. */
export type DiffSelectionStop = {
	filePath: string;
	oldStart: number;
	side: DiffSide;
	lineNumber: number;
};

/**
 * One logical source row in the active presentation. Split rows may expose both panes; a stacked
 * context row may retain both source authorities while still occupying exactly one visible row.
 */
export type DiffPresentationRow = {
	key: string;
	index: number;
	filePath: string;
	oldStart: number;
	kind: "change" | "context";
	stops: NonEmptyArray<DiffSelectionStop>;
};

const stopKey = ({ filePath, oldStart, side, lineNumber }: DiffSelectionStop): string =>
	`${filePath}\u0000${oldStart}\u0000${side}\u0000${lineNumber}`;

const rangeContainsStop = (range: DiffSelectionRange, stop: DiffSelectionStop): boolean =>
	range.oldStart === stop.oldStart &&
	range.side === stop.side &&
	range.startLine <= stop.lineNumber &&
	stop.lineNumber <= range.endLine;

const stopForIdentity = (
	identity: ReturnType<typeof structureRowIdentity>,
): DiffSelectionStop | null =>
	identity
		? {
				filePath: identity.filePath,
				oldStart: identity.hunkOldStart,
				side: identity.side,
				lineNumber: identity.lineNumber,
			}
		: null;

const presentationKind = (row: Exclude<DiffRow, { type: "hunk-header" }>) =>
	(
		row.type === "stack-line"
			? row.cell.kind === "context"
			: row.old.kind === "context" || row.new.kind === "context"
	)
		? "context"
		: "change";

/**
 * Logical source rows with their old/new authorities. This is the presentation identity used by
 * keyboard motion; wrapping is deliberately absent, while stacked context keeps one row identity.
 */
export const diffPresentationRows = (
	file: DiffFile,
	layout: DiffLayout = "split",
): DiffPresentationRow[] => {
	const structure = diffStructure({ file, layout });
	return structure.rows.flatMap((row, index): DiffPresentationRow[] => {
		if (row.type === "hunk-header") return [];
		const seen = new Set<string>();
		const stops = (["deletions", "additions"] as const).flatMap((side) => {
			const stop = stopForIdentity(structureRowIdentity({ structure, row, side }));
			if (!stop || seen.has(stopKey(stop))) return [];
			seen.add(stopKey(stop));
			return [stop];
		});
		const first = stops[0];
		if (!first) return [];
		return [
			{
				key: row.key,
				index,
				filePath: first.filePath,
				oldStart: first.oldStart,
				kind: presentationKind(row),
				stops: [first, ...stops.slice(1)],
			},
		];
	});
};

/**
 * Every side-backed authority from parsed hunks in row-major presentation order. Pointer lanes use
 * the complete set; keyboard helpers below use the row identity so stacked context is one step.
 */
export const diffSelectionStops = (
	file: DiffFile,
	layout: DiffLayout = "split",
): DiffSelectionStop[] => diffPresentationRows(file, layout).flatMap((row) => row.stops);

const sameStop = (left: DiffSelectionStop, right: DiffSelectionStop): boolean =>
	stopKey(left) === stopKey(right);

const rowIndexForStop = (rows: readonly DiffPresentationRow[], stop: DiffSelectionStop): number =>
	rows.findIndex((row) => row.stops.some((candidate) => sameStop(candidate, stop)));

/** Prefer the requested lane when a row has it; stacked context otherwise uses current-side data. */
export const presentationRowStop = (
	row: DiffPresentationRow,
	preferredSide: DiffSide = "additions",
): DiffSelectionStop => row.stops.find((stop) => stop.side === preferredSide) ?? row.stops[0];

/** One stop per visible stacked row, retaining a preferred authority where the row has it. */
export const stackedVisibleSelectionStops = (
	rows: readonly DiffPresentationRow[],
	preferredSide: DiffSide = "additions",
): DiffSelectionStop[] => rows.map((row) => presentationRowStop(row, preferredSide));

/** Move vertically inside one split pane. Rows without that side are skipped, never jumped across. */
export const moveSplitSelectionStop = ({
	rows,
	current,
	delta,
}: {
	rows: readonly DiffPresentationRow[];
	current: DiffSelectionStop;
	delta: -1 | 1;
}): DiffSelectionStop => {
	const currentIndex = rowIndexForStop(rows, current);
	if (currentIndex < 0) return current;
	for (let index = currentIndex + delta; index >= 0 && index < rows.length; index += delta) {
		const candidate = rows[index]?.stops.find((stop) => stop.side === current.side);
		if (candidate) return candidate;
	}
	return current;
};

/** Switch to the requested side of the same split presentation row; no counterpart means no-op. */
export const switchSplitSelectionStop = ({
	rows,
	current,
	side,
}: {
	rows: readonly DiffPresentationRow[];
	current: DiffSelectionStop;
	side: DiffSide;
}): DiffSelectionStop => {
	const row = rows[rowIndexForStop(rows, current)];
	return row?.stops.find((stop) => stop.side === side) ?? current;
};

/** Move by one visible stacked source row, not by the number of authorities on a context row. */
export const moveStackedSelectionStop = ({
	rows,
	current,
	delta,
}: {
	rows: readonly DiffPresentationRow[];
	current: DiffSelectionStop;
	delta: -1 | 1;
}): DiffSelectionStop => {
	const currentIndex = rowIndexForStop(rows, current);
	if (currentIndex < 0) return current;
	const next = rows[currentIndex + delta];
	return next ? presentationRowStop(next, current.side) : current;
};

const selectionFromStops = (selectedStops: readonly DiffSelectionStop[]): DiffSelection | null => {
	const first = selectedStops[0];
	if (!first || selectedStops.some((stop) => stop.filePath !== first.filePath)) return null;
	const ranges: NonEmptyArray<DiffSelectionRange> = [
		{
			oldStart: first.oldStart,
			side: first.side,
			startLine: first.lineNumber,
			endLine: first.lineNumber,
		},
	];
	for (const stop of selectedStops.slice(1)) {
		const previous = ranges[ranges.length - 1] ?? ranges[0];
		if (
			previous.oldStart === stop.oldStart &&
			previous.side === stop.side &&
			stop.lineNumber === previous.endLine + 1
		) {
			ranges[ranges.length - 1] = { ...previous, endLine: stop.lineNumber };
		} else {
			ranges.push({
				oldStart: stop.oldStart,
				side: stop.side,
				startLine: stop.lineNumber,
				endLine: stop.lineNumber,
			});
		}
	}
	return { filePath: first.filePath, ranges };
};

/**
 * A split keyboard selection is vertical in one pane until its focus crosses sides. Once mixed, it
 * is the rectangle formed by both pane authorities over the inclusive presentation-row span.
 */
export const rectangularSelectionBetween = (
	rows: readonly DiffPresentationRow[],
	anchor: DiffSelectionStop | undefined,
	focus: DiffSelectionStop | undefined,
): DiffSelection | null => {
	if (!anchor || !focus || anchor.filePath !== focus.filePath) return null;
	const anchorIndex = rowIndexForStop(rows, anchor);
	const focusIndex = rowIndexForStop(rows, focus);
	if (anchorIndex < 0 || focusIndex < 0) return null;
	const sides: readonly DiffSide[] =
		anchor.side === focus.side ? [anchor.side] : ["deletions", "additions"];
	const selected = rows
		.slice(Math.min(anchorIndex, focusIndex), Math.max(anchorIndex, focusIndex) + 1)
		.flatMap((row) => sides.flatMap((side) => row.stops.find((stop) => stop.side === side) ?? []));
	return selectionFromStops(selected);
};

/** Inclusive selection in visible stacked order, choosing one authority for each presentation row. */
export const stackedSelectionBetween = (
	rows: readonly DiffPresentationRow[],
	anchor: DiffSelectionStop | undefined,
	focus: DiffSelectionStop | undefined,
): DiffSelection | null => {
	if (!anchor || !focus || anchor.filePath !== focus.filePath) return null;
	const anchorIndex = rowIndexForStop(rows, anchor);
	const focusIndex = rowIndexForStop(rows, focus);
	if (anchorIndex < 0 || focusIndex < 0) return null;
	let preferredSide = anchorIndex <= focusIndex ? anchor.side : focus.side;
	const selected = rows
		.slice(Math.min(anchorIndex, focusIndex), Math.max(anchorIndex, focusIndex) + 1)
		.map((row, index) => {
			const absoluteIndex = Math.min(anchorIndex, focusIndex) + index;
			const endpoint =
				absoluteIndex === anchorIndex ? anchor : absoluteIndex === focusIndex ? focus : undefined;
			const stop = endpoint ?? presentationRowStop(row, preferredSide);
			preferredSide = stop.side;
			return stop;
		});
	return selectionFromStops(selected);
};

const rangeOrder = (range: DiffSelectionRange, stops: readonly DiffSelectionStop[]): number => {
	const index = stops.findIndex((stop) => rangeContainsStop(range, stop));
	return index < 0 ? Number.MAX_SAFE_INTEGER : index;
};

const sameRangeAuthority = (left: DiffSelectionRange, right: DiffSelectionRange): boolean =>
	left.oldStart === right.oldStart && left.side === right.side;

const coalesceRanges = (
	ranges: readonly DiffSelectionRange[],
): { range: DiffSelectionRange; originalIndex: number }[] => {
	const groups = new Map<string, { range: DiffSelectionRange; originalIndex: number }[]>();
	for (const [originalIndex, range] of ranges.entries()) {
		const key = `${range.oldStart}\u0000${range.side}`;
		groups.set(key, [...(groups.get(key) ?? []), { range: { ...range }, originalIndex }]);
	}
	return [...groups.values()].flatMap((group) => {
		const ordered = [...group].sort(
			(left, right) =>
				left.range.startLine - right.range.startLine ||
				left.range.endLine - right.range.endLine ||
				left.originalIndex - right.originalIndex,
		);
		const merged: { range: DiffSelectionRange; originalIndex: number }[] = [];
		for (const item of ordered) {
			const previous = merged[merged.length - 1];
			if (
				previous &&
				sameRangeAuthority(previous.range, item.range) &&
				item.range.startLine <= previous.range.endLine + 1
			) {
				previous.range = {
					...previous.range,
					startLine: Math.min(previous.range.startLine, item.range.startLine),
					endLine: Math.max(previous.range.endLine, item.range.endLine),
				};
				previous.originalIndex = Math.min(previous.originalIndex, item.originalIndex);
			} else merged.push(item);
		}
		return merged;
	});
};

/** Canonicalise range order and merge adjacent ranges without changing the selected authority. */
export const normalizeDiffSelection = (
	selection: DiffSelection,
	stops: readonly DiffSelectionStop[],
): DiffSelection => {
	const ordered = coalesceRanges(selection.ranges)
		.sort(
			(left, right) =>
				rangeOrder(left.range, stops) - rangeOrder(right.range, stops) ||
				left.originalIndex - right.originalIndex,
		)
		.map(({ range }) => range);
	const first = ordered[0];
	return first ? { filePath: selection.filePath, ranges: [first, ...ordered.slice(1)] } : selection;
};

/**
 * Canonical persisted order is intentionally independent of the active layout. Split structure is
 * only the stable storage ordering rule; interaction callers use presentation-row helpers.
 */
export const canonicalizeDiffSelection = (
	selection: DiffSelection,
	authoritativeFile: DiffFile,
): DiffSelection =>
	normalizeDiffSelection(selection, diffSelectionStops(authoritativeFile, "split"));

/** Inclusive selection between two file-local stops, independent of pointer event density. */
export const selectionBetween = (
	stops: readonly DiffSelectionStop[],
	anchor: DiffSelectionStop | undefined,
	focus: DiffSelectionStop | undefined,
): DiffSelection | null => {
	if (!anchor || !focus || anchor.filePath !== focus.filePath) return null;
	const anchorIndex = stops.findIndex((stop) => sameStop(stop, anchor));
	const focusIndex = stops.findIndex((stop) => sameStop(stop, focus));
	if (anchorIndex < 0 || focusIndex < 0) return null;
	return selectionFromStops(
		stops.slice(Math.min(anchorIndex, focusIndex), Math.max(anchorIndex, focusIndex) + 1),
	);
};

export const selectionContains = (selection: DiffSelection, stop: DiffSelectionStop): boolean =>
	selection.filePath === stop.filePath &&
	selection.ranges.some((range) => rangeContainsStop(range, stop));

export const firstSelectionRange = (selection: DiffSelection): DiffSelectionRange =>
	selection.ranges[0];

export const terminalSelectionRange = (selection: DiffSelection): DiffSelectionRange =>
	selection.ranges[selection.ranges.length - 1] ?? selection.ranges[0];
