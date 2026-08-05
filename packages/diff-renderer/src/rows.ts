import { intralineSpans, pairChangedLines } from "@revue/diff-model";
import { applicableDecorations, decorationsAtLine } from "./decorations.ts";
import { highlightedLines } from "./highlight.ts";
import { sanitizeTerminalLine, sanitizeTerminalSpans } from "./terminalText.ts";
import type {
	DiffCell,
	DiffFile,
	DiffLayout,
	DiffRow,
	DiffSide,
	EmphasisRange,
	RangeDecoration,
	RenderSpan,
	SpanEmphasis,
} from "./types.ts";

const stripEol = (line: string | undefined) => (line ?? "").replace(/\r?\n$/, "");

const cleanLine = (line: string | undefined) =>
	sanitizeTerminalLine(stripEol(line)).replaceAll("\t", "  ");

/** Rendering doubles tabs, so shift raw-text offsets by the tabs preceding them. */
const tabAdjusted = (raw: string, range: EmphasisRange): EmphasisRange => {
	const extra = (upTo: number) => raw.slice(0, upTo).match(/\t/g)?.length ?? 0;
	return { start: range.start + extra(range.start), end: range.end + extra(range.end) };
};

/**
 * The two flavours of char-exact restyling: novel tokens glow in the side's colour against a
 * dim base, while intra-line changes take only a background and keep their syntax colours.
 */
type OverlayStyle = { kind: "novel"; fg: string } | { kind: "background"; bg: string };

const inRange = (span: RenderSpan, style: OverlayStyle): RenderSpan =>
	style.kind === "novel"
		? { text: span.text, fg: style.fg, bold: true }
		: { ...span, bg: style.bg };

const outOfRange = (span: RenderSpan, style: OverlayStyle): RenderSpan =>
	style.kind === "novel" ? { ...span, dim: true } : span;

/**
 * Cut spans at the range boundaries and restyle each piece by whether the overlay covers it.
 * Ranges must be sorted and non-overlapping: the cursor only moves forwards, so a range
 * starting behind it is dropped.
 */
const overlaySpans = (
	spans: RenderSpan[],
	ranges: readonly EmphasisRange[],
	style: OverlayStyle,
): RenderSpan[] => {
	const result: RenderSpan[] = [];
	let offset = 0;
	for (const span of spans) {
		const end = offset + span.text.length;
		const piece = (from: number, to?: number) => ({
			...span,
			text: span.text.slice(from - offset, to === undefined ? undefined : to - offset),
		});
		let cursor = offset;
		for (const range of ranges) {
			const from = Math.max(range.start, cursor);
			const to = Math.min(range.end, end);
			if (to <= from) continue;
			if (from > cursor) result.push(outOfRange(piece(cursor, from), style));
			result.push(inRange(piece(from, to), style));
			cursor = to;
		}
		if (cursor < end) result.push(outOfRange(piece(cursor), style));
		offset = end;
	}
	return result;
};

/** One cell's intra-line ranges, already resolved to that side's background colour. */
type IntralineEmphasis = { ranges: readonly EmphasisRange[]; bg: string };

type EmphasisSource = {
	kind: DiffCell["kind"];
	oldLineNumber?: number;
	newLineNumber?: number;
	emphasis?: SpanEmphasis;
	intraline?: IntralineEmphasis;
};

/** Novel emphasis is the host's own reading of a line, so it outranks the intra-line one. */
const overlayFor = ({
	kind,
	oldLineNumber,
	newLineNumber,
	emphasis,
	intraline,
}: EmphasisSource): { ranges: readonly EmphasisRange[]; style: OverlayStyle } | undefined => {
	const side: DiffSide | null =
		kind === "deletion" ? "deletions" : kind === "addition" ? "additions" : null;
	if (!side) return undefined;
	const line = side === "deletions" ? oldLineNumber : newLineNumber;
	const novel = emphasis && line !== undefined ? emphasis.rangesFor(side, line) : undefined;
	if (emphasis && novel?.length) {
		const fg = side === "deletions" ? emphasis.deletionsFg : emphasis.additionsFg;
		return { ranges: novel, style: { kind: "novel", fg } };
	}
	if (intraline?.ranges.length)
		return { ranges: intraline.ranges, style: { kind: "background", bg: intraline.bg } };
	return undefined;
};

const applyEmphasis = ({
	spans,
	raw,
	...source
}: EmphasisSource & { spans: RenderSpan[]; raw: string }): RenderSpan[] => {
	const overlay = overlayFor(source);
	if (!overlay) return spans;
	return overlaySpans(
		spans,
		overlay.ranges.map((range) => tabAdjusted(raw, range)),
		overlay.style,
	);
};

/** One parsed change block: a run of removed lines answered by a run of added ones. */
type ChangeBlock = Extract<
	DiffFile["metadata"]["hunks"][number]["hunkContent"][number],
	{ type: "change" }
>;

/** A change block's intra-line ranges, by side and offset within the block. */
type IntralineRanges = {
	deletions: ReadonlyMap<number, readonly EmphasisRange[]>;
	additions: ReadonlyMap<number, readonly EmphasisRange[]>;
};

const pairedRanges = (
	oldLines: readonly string[],
	newLines: readonly string[],
): IntralineRanges => {
	const paired = pairChangedLines({ oldLines, newLines }).map(({ oldIndex, newIndex }) => ({
		oldIndex,
		newIndex,
		spans: intralineSpans({ oldLine: oldLines[oldIndex] ?? "", newLine: newLines[newIndex] ?? "" }),
	}));
	return {
		deletions: new Map(paired.map(({ oldIndex, spans }) => [oldIndex, spans.old])),
		additions: new Map(paired.map(({ newIndex, spans }) => [newIndex, spans.new])),
	};
};

// Pairing costs a comparison per removed×added line, while rows are rebuilt on every
// render, so the ranges are memoised on the parsed change block. Pierre parses a patch
// once and the metadata copies made downstream keep its block objects, so block identity
// is stable across renders; the lines a block covers never change under it.
const rangesByChangeBlock = new WeakMap<ChangeBlock, IntralineRanges>();

/** The intra-line ranges of one change block, computed once per parse. */
export const intralineRangesFor = ({
	block,
	oldLines,
	newLines,
}: {
	block: ChangeBlock;
	oldLines: readonly string[];
	newLines: readonly string[];
}): IntralineRanges => {
	const cached = rangesByChangeBlock.get(block);
	if (cached) return cached;
	const ranges = pairedRanges(oldLines, newLines);
	rangesByChangeBlock.set(block, ranges);
	return ranges;
};

/** Look up a change block's intra-line ranges by side and offset within the block. */
const intralineLookup =
	({ ranges, colours }: { ranges: IntralineRanges; colours: IntralineColours }) =>
	(side: DiffSide, offset: number): IntralineEmphasis | undefined => {
		const found = (side === "deletions" ? ranges.deletions : ranges.additions).get(offset);
		if (!found?.length) return undefined;
		return { ranges: found, bg: side === "deletions" ? colours.deletionsBg : colours.additionsBg };
	};

function makeCell({
	kind,
	text,
	spans,
	oldLineNumber,
	newLineNumber,
	decorations,
	focusedDecorationId,
	emphasis,
	intraline,
}: {
	kind: DiffCell["kind"];
	text?: string;
	spans?: RenderSpan[];
	oldLineNumber?: number;
	newLineNumber?: number;
	decorations: readonly RangeDecoration[];
	focusedDecorationId?: string;
	emphasis?: SpanEmphasis;
	intraline?: IntralineEmphasis;
}): DiffCell {
	const oldRanges = decorationsAtLine(decorations, "deletions", oldLineNumber);
	const newRanges = decorationsAtLine(decorations, "additions", newLineNumber);
	const isFocused = (range: RangeDecoration) =>
		range.active === true ||
		(focusedDecorationId !== undefined &&
			(range.id === focusedDecorationId || range.focusId === focusedDecorationId));
	const oldFocus = oldRanges.find(isFocused);
	const newFocus = newRanges.find(isFocused);
	const safeText = cleanLine(text);
	const baseSpans = spans?.length
		? sanitizeTerminalSpans(spans)
		: safeText
			? [{ text: safeText }]
			: [];
	return {
		kind,
		text: safeText,
		spans: applyEmphasis({
			spans: baseSpans,
			kind,
			raw: stripEol(text),
			oldLineNumber,
			newLineNumber,
			emphasis,
			intraline,
		}),
		oldLineNumber,
		newLineNumber,
		decorations: {
			deletions: oldRanges.map((range) => range.id),
			additions: newRanges.map((range) => range.id),
		},
		focusedSides: [oldFocus ? "deletions" : undefined, newFocus ? "additions" : undefined].filter(
			Boolean,
		) as DiffSide[],
		focusedBackgrounds: {
			deletions: oldFocus?.backgroundColor,
			additions: newFocus?.backgroundColor,
		},
		gutterFocusedSides: [
			oldFocus?.showGutterMarker !== false && oldFocus ? "deletions" : undefined,
			newFocus?.showGutterMarker !== false && newFocus ? "additions" : undefined,
		].filter(Boolean) as DiffSide[],
	};
}

const emptyCell = (): DiffCell => ({
	kind: "empty",
	text: "",
	spans: [],
	decorations: {},
	focusedSides: [],
	focusedBackgrounds: {},
	gutterFocusedSides: [],
});

function headerText(hunk: DiffFile["metadata"]["hunks"][number]) {
	return (
		hunk.hunkSpecs ??
		`@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@${hunk.hunkContext ? ` ${hunk.hunkContext}` : ""}`
	);
}

/** The backgrounds intra-line emphasis paints with, one per side. */
export type IntralineColours = { deletionsBg: string; additionsBg: string };

export type DiffRowOptions = {
	/** The prepared syntax theme to read spans for; raw text renders without one. */
	syntaxTheme?: string;
	decorations?: readonly RangeDecoration[];
	focusedDecorationId?: string;
	emphasis?: SpanEmphasis;
	/** Paints the changed characters of paired lines; omitted, no pairing is computed. */
	intralineEmphasis?: IntralineColours;
};

/** Expand Pierre metadata into stable split or stack rows with old/new identities. */
export function buildDiffRows(
	file: DiffFile,
	layout: DiffLayout,
	{
		syntaxTheme,
		decorations = [],
		focusedDecorationId,
		emphasis,
		intralineEmphasis,
	}: DiffRowOptions = {},
): DiffRow[] {
	const rows: DiffRow[] = [];
	const ranges = applicableDecorations(file, decorations);
	const highlighted = highlightedLines(file, syntaxTheme);

	for (const [hunkIndex, hunk] of file.metadata.hunks.entries()) {
		rows.push({
			type: "hunk-header",
			key: `${file.id}:header:${hunkIndex}`,
			hunkIndex,
			text: headerText(hunk),
		});
		let deletionIndex = hunk.deletionLineIndex;
		let additionIndex = hunk.additionLineIndex;
		let oldLine = hunk.deletionStart;
		let newLine = hunk.additionStart;

		for (const content of hunk.hunkContent) {
			if (content.type === "context") {
				for (let offset = 0; offset < content.lines; offset += 1) {
					const common = {
						kind: "context" as const,
						text: file.metadata.additionLines[additionIndex + offset],
						spans: highlighted?.additions[additionIndex + offset],
						oldLineNumber: oldLine + offset,
						newLineNumber: newLine + offset,
						decorations: ranges,
						focusedDecorationId,
						emphasis,
					};
					if (layout === "split") {
						rows.push({
							type: "split-line",
							key: `${file.id}:split:${hunkIndex}:context:${deletionIndex + offset}:${additionIndex + offset}`,
							hunkIndex,
							old: makeCell({ ...common, newLineNumber: undefined }),
							new: makeCell({ ...common, oldLineNumber: undefined }),
						});
					} else {
						rows.push({
							type: "stack-line",
							key: `${file.id}:stack:${hunkIndex}:context:${additionIndex + offset}`,
							hunkIndex,
							cell: makeCell(common),
						});
					}
				}
				deletionIndex += content.lines;
				additionIndex += content.lines;
				oldLine += content.lines;
				newLine += content.lines;
				continue;
			}

			const intralineAt = intralineEmphasis
				? intralineLookup({
						ranges: intralineRangesFor({
							block: content,
							oldLines: file.metadata.deletionLines
								.slice(deletionIndex, deletionIndex + content.deletions)
								.map(stripEol),
							newLines: file.metadata.additionLines
								.slice(additionIndex, additionIndex + content.additions)
								.map(stripEol),
						}),
						colours: intralineEmphasis,
					})
				: () => undefined;

			if (layout === "split") {
				for (let offset = 0; offset < Math.max(content.deletions, content.additions); offset += 1) {
					rows.push({
						type: "split-line",
						key: `${file.id}:split:${hunkIndex}:change:${deletionIndex + offset}:${additionIndex + offset}`,
						hunkIndex,
						old:
							offset < content.deletions
								? makeCell({
										kind: "deletion",
										text: file.metadata.deletionLines[deletionIndex + offset],
										spans: highlighted?.deletions[deletionIndex + offset],
										oldLineNumber: oldLine + offset,
										decorations: ranges,
										focusedDecorationId,
										emphasis,
										intraline: intralineAt("deletions", offset),
									})
								: emptyCell(),
						new:
							offset < content.additions
								? makeCell({
										kind: "addition",
										text: file.metadata.additionLines[additionIndex + offset],
										spans: highlighted?.additions[additionIndex + offset],
										newLineNumber: newLine + offset,
										decorations: ranges,
										focusedDecorationId,
										emphasis,
										intraline: intralineAt("additions", offset),
									})
								: emptyCell(),
					});
				}
			} else {
				for (let offset = 0; offset < content.deletions; offset += 1) {
					rows.push({
						type: "stack-line",
						key: `${file.id}:stack:${hunkIndex}:deletion:${deletionIndex + offset}`,
						hunkIndex,
						cell: makeCell({
							kind: "deletion",
							text: file.metadata.deletionLines[deletionIndex + offset],
							spans: highlighted?.deletions[deletionIndex + offset],
							oldLineNumber: oldLine + offset,
							decorations: ranges,
							focusedDecorationId,
							emphasis,
							intraline: intralineAt("deletions", offset),
						}),
					});
				}
				for (let offset = 0; offset < content.additions; offset += 1) {
					rows.push({
						type: "stack-line",
						key: `${file.id}:stack:${hunkIndex}:addition:${additionIndex + offset}`,
						hunkIndex,
						cell: makeCell({
							kind: "addition",
							text: file.metadata.additionLines[additionIndex + offset],
							spans: highlighted?.additions[additionIndex + offset],
							newLineNumber: newLine + offset,
							decorations: ranges,
							focusedDecorationId,
							emphasis,
							intraline: intralineAt("additions", offset),
						}),
					});
				}
			}
			deletionIndex += content.deletions;
			additionIndex += content.additions;
			oldLine += content.deletions;
			newLine += content.additions;
		}
	}
	return rows;
}
