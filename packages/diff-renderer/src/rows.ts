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

const cleanLine = (line: string | undefined) =>
	sanitizeTerminalLine((line ?? "").replace(/\r?\n$/, "")).replaceAll("\t", "  ");

/** Rendering doubles tabs, so shift raw-text offsets by the tabs preceding them. */
const tabAdjusted = (raw: string, range: EmphasisRange): EmphasisRange => {
	const extra = (upTo: number) => raw.slice(0, upTo).match(/\t/g)?.length ?? 0;
	return { start: range.start + extra(range.start), end: range.end + extra(range.end) };
};

/** Novel ranges glow in the side's colour while the rest of the line falls back to a dim base. */
const emphasiseSpans = (
	spans: RenderSpan[],
	ranges: readonly EmphasisRange[],
	fg: string,
): RenderSpan[] => {
	const result: RenderSpan[] = [];
	let offset = 0;
	for (const span of spans) {
		const end = offset + span.text.length;
		let cursor = offset;
		for (const range of ranges) {
			const from = Math.max(range.start, cursor);
			const to = Math.min(range.end, end);
			if (to <= from) continue;
			if (from > cursor)
				result.push({ ...span, text: span.text.slice(cursor - offset, from - offset), dim: true });
			result.push({ text: span.text.slice(from - offset, to - offset), fg, bold: true });
			cursor = to;
		}
		if (cursor < end) result.push({ ...span, text: span.text.slice(cursor - offset), dim: true });
		offset = end;
	}
	return result;
};

const applyEmphasis = ({
	spans,
	kind,
	raw,
	oldLineNumber,
	newLineNumber,
	emphasis,
}: {
	spans: RenderSpan[];
	kind: DiffCell["kind"];
	raw: string;
	oldLineNumber?: number;
	newLineNumber?: number;
	emphasis?: SpanEmphasis;
}): RenderSpan[] => {
	if (!emphasis) return spans;
	const side: DiffSide | null =
		kind === "deletion" ? "deletions" : kind === "addition" ? "additions" : null;
	const line = side === "deletions" ? oldLineNumber : newLineNumber;
	if (!side || line === undefined) return spans;
	const ranges = emphasis.rangesFor(side, line);
	if (!ranges?.length) return spans;
	return emphasiseSpans(
		spans,
		ranges.map((range) => tabAdjusted(raw, range)),
		side === "deletions" ? emphasis.deletionsFg : emphasis.additionsFg,
	);
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
}: {
	kind: DiffCell["kind"];
	text?: string;
	spans?: RenderSpan[];
	oldLineNumber?: number;
	newLineNumber?: number;
	decorations: readonly RangeDecoration[];
	focusedDecorationId?: string;
	emphasis?: SpanEmphasis;
}): DiffCell {
	const oldRanges = decorationsAtLine(decorations, "deletions", oldLineNumber);
	const newRanges = decorationsAtLine(decorations, "additions", newLineNumber);
	const isFocused = (range: RangeDecoration) =>
		focusedDecorationId !== undefined &&
		(range.id === focusedDecorationId || range.focusId === focusedDecorationId);
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
			raw: (text ?? "").replace(/\r?\n$/, ""),
			oldLineNumber,
			newLineNumber,
			emphasis,
		}),
		oldLineNumber,
		newLineNumber,
		decorations: {
			deletions: oldRanges.map((range) => range.id),
			additions: newRanges.map((range) => range.id),
		},
		focusedSides: [
			oldRanges.some(isFocused) ? "deletions" : undefined,
			newRanges.some(isFocused) ? "additions" : undefined,
		].filter(Boolean) as DiffSide[],
	};
}

const emptyCell = (): DiffCell => ({
	kind: "empty",
	text: "",
	spans: [],
	decorations: {},
	focusedSides: [],
});

function headerText(hunk: DiffFile["metadata"]["hunks"][number]) {
	return (
		hunk.hunkSpecs ??
		`@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@${hunk.hunkContext ? ` ${hunk.hunkContext}` : ""}`
	);
}

export type DiffRowOptions = {
	/** The prepared syntax theme to read spans for; raw text renders without one. */
	syntaxTheme?: string;
	decorations?: readonly RangeDecoration[];
	focusedDecorationId?: string;
	emphasis?: SpanEmphasis;
};

/** Expand Pierre metadata into stable split or stack rows with old/new identities. */
export function buildDiffRows(
	file: DiffFile,
	layout: DiffLayout,
	{ syntaxTheme, decorations = [], focusedDecorationId, emphasis }: DiffRowOptions = {},
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
