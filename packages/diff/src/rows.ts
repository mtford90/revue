import { highlightedLines } from "./highlight.ts";
import { intralineSpans, pairChangedLines } from "./intraline.ts";
import { sanitizeTerminalLine, sanitizeTerminalSpans } from "./terminalText.ts";
import type {
	DiffCell,
	DiffFile,
	DiffLayout,
	DiffRow,
	DiffSide,
	EmphasisRange,
	RenderSpan,
} from "./types.ts";

const stripEol = (line: string | undefined) => (line ?? "").replace(/\r?\n$/, "");

const cleanLine = (line: string | undefined) =>
	sanitizeTerminalLine(stripEol(line)).replaceAll("\t", "  ");

/** Rendering doubles tabs, so shift raw-text offsets by the tabs preceding them. */
export const tabAdjustedRanges = (
	raw: string,
	ranges: readonly EmphasisRange[],
): EmphasisRange[] => {
	const extra = (upTo: number) => raw.slice(0, upTo).match(/\t/g)?.length ?? 0;
	return ranges.map((range) => ({
		start: range.start + extra(range.start),
		end: range.end + extra(range.end),
	}));
};

/** One parsed change block: a run of removed lines answered by a run of added ones. */
type ChangeBlock = Extract<
	DiffFile["metadata"]["hunks"][number]["hunkContent"][number],
	{ type: "change" }
>;

/** A change block's intra-line ranges, by side and offset within the block. */
export type IntralineRanges = {
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

// Pairing costs a comparison per removed×added line. A parsed change block is immutable and its
// object identity survives downstream file copies, so stable geometry can retain this analysis
// without repeating it on every paint-only interaction.
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

const intralineLookup = (ranges: IntralineRanges) => (side: DiffSide, offset: number) =>
	(side === "deletions" ? ranges.deletions : ranges.additions).get(offset) ?? [];

function makeCell({
	kind,
	text,
	spans,
	oldLineNumber,
	newLineNumber,
	intralineRanges = [],
}: {
	kind: DiffCell["kind"];
	text?: string;
	spans?: RenderSpan[];
	oldLineNumber?: number;
	newLineNumber?: number;
	intralineRanges?: readonly EmphasisRange[];
}): DiffCell {
	const rawText = stripEol(text);
	const safeText = cleanLine(text);
	const baseSpans = spans?.length
		? sanitizeTerminalSpans(spans)
		: safeText
			? [{ text: safeText }]
			: [];
	return {
		kind,
		text: safeText,
		rawText,
		spans: baseSpans,
		oldLineNumber,
		newLineNumber,
		intralineRanges: tabAdjustedRanges(rawText, intralineRanges),
	};
}

const emptyCell = (): DiffCell => ({
	kind: "empty",
	text: "",
	rawText: "",
	spans: [],
	intralineRanges: [],
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
};

/** Expand parsed metadata into stable split or stack rows with old/new source identities. */
export function buildDiffRows(
	file: DiffFile,
	layout: DiffLayout,
	{ syntaxTheme }: DiffRowOptions = {},
): DiffRow[] {
	const rows: DiffRow[] = [];
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

			const intralineAt = intralineLookup(
				intralineRangesFor({
					block: content,
					oldLines: file.metadata.deletionLines
						.slice(deletionIndex, deletionIndex + content.deletions)
						.map(stripEol),
					newLines: file.metadata.additionLines
						.slice(additionIndex, additionIndex + content.additions)
						.map(stripEol),
				}),
			);

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
										intralineRanges: intralineAt("deletions", offset),
									})
								: emptyCell(),
						new:
							offset < content.additions
								? makeCell({
										kind: "addition",
										text: file.metadata.additionLines[additionIndex + offset],
										spans: highlighted?.additions[additionIndex + offset],
										newLineNumber: newLine + offset,
										intralineRanges: intralineAt("additions", offset),
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
							intralineRanges: intralineAt("deletions", offset),
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
							intralineRanges: intralineAt("additions", offset),
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
