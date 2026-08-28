import { diffStructure, structureRowIdentity } from "./plan.ts";
import type { DiffFile, DiffSide } from "./types.ts";

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

/**
 * Every side-backed row from the original parsed hunks, in split display order (old then current).
 * Calling this on the authoritative parsed file, rather than an expanded display variant, keeps
 * synthesised-only context out by construction.
 */
export const diffSelectionStops = (file: DiffFile): DiffSelectionStop[] => {
	const structure = diffStructure({ file, layout: "split" });
	const seen = new Set<string>();
	const stops: DiffSelectionStop[] = [];
	for (const row of structure.rows) {
		if (row.type === "hunk-header") continue;
		for (const side of ["deletions", "additions"] as const) {
			const stop = stopForIdentity(structureRowIdentity({ structure, row, side }));
			if (!stop) continue;
			const key = stopKey(stop);
			if (seen.has(key)) continue;
			seen.add(key);
			stops.push(stop);
		}
	}
	return stops;
};

const rangeOrder = (range: DiffSelectionRange, stops: readonly DiffSelectionStop[]): number => {
	const index = stops.findIndex((stop) => rangeContainsStop(range, stop));
	return index < 0 ? Number.MAX_SAFE_INTEGER : index;
};

const canMerge = (left: DiffSelectionRange, right: DiffSelectionRange): boolean =>
	left.oldStart === right.oldStart &&
	left.side === right.side &&
	right.startLine <= left.endLine + 1;

/** Canonicalise range order and merge adjacent ranges without changing the selected authority. */
export const normalizeDiffSelection = (
	selection: DiffSelection,
	stops: readonly DiffSelectionStop[],
): DiffSelection => {
	const ordered = selection.ranges
		.map((range, index) => ({ range, index }))
		.sort(
			(left, right) =>
				rangeOrder(left.range, stops) - rangeOrder(right.range, stops) || left.index - right.index,
		)
		.map(({ range }) => ({ ...range }));
	const first = ordered[0];
	if (!first) return selection;
	const ranges: NonEmptyArray<DiffSelectionRange> = [first];
	for (const range of ordered.slice(1)) {
		const previous = ranges[ranges.length - 1] ?? ranges[0];
		if (canMerge(previous, range)) {
			ranges[ranges.length - 1] = {
				...previous,
				startLine: Math.min(previous.startLine, range.startLine),
				endLine: Math.max(previous.endLine, range.endLine),
			};
		} else ranges.push(range);
	}
	return { filePath: selection.filePath, ranges };
};

const sameStop = (left: DiffSelectionStop, right: DiffSelectionStop): boolean =>
	stopKey(left) === stopKey(right);

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
	const selectedStops = stops.slice(
		Math.min(anchorIndex, focusIndex),
		Math.max(anchorIndex, focusIndex) + 1,
	);
	const first = selectedStops[0];
	if (!first) return null;
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
	return { filePath: anchor.filePath, ranges };
};

export const selectionContains = (selection: DiffSelection, stop: DiffSelectionStop): boolean =>
	selection.filePath === stop.filePath &&
	selection.ranges.some((range) => rangeContainsStop(range, stop));

export const firstSelectionRange = (selection: DiffSelection): DiffSelectionRange =>
	selection.ranges[0];

export const terminalSelectionRange = (selection: DiffSelection): DiffSelectionRange =>
	selection.ranges[selection.ranges.length - 1] ?? selection.ranges[0];
