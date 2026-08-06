export {
	applicableDecorations,
	decorationsAtLine,
	findFocusedDecorationAnchor,
	rangeToHunkIndex,
} from "./decorations.ts";
export { type HighlightedLines, highlightedLines, prepareSyntaxHighlighting } from "./highlight.ts";
export type { IntralinePair, IntralineRange, IntralineSpans } from "./intraline.ts";
export { intralineSpans, pairChangedLines } from "./intraline.ts";
export {
	type CodeWidths,
	DEFAULT_DIFF_CHROME,
	type DiffChromeWidths,
	diffCodeWidths,
	lineNumberDigits,
	rowVisualHeight,
	splitPaneWidths,
	stackGutterSides,
} from "./layout.ts";
export { countDiffStats, createDiffFile, inferLanguage, parsePatch } from "./model.ts";
export {
	type DiffPlanStyles,
	type DiffPlanVisibility,
	type DiffVisualPlan,
	type PlanDiffInput,
	type PlannedDiffRow,
	type PlannedGutter,
	type PlannedHunkHeaderRow,
	type PlannedSplitLineRow,
	type PlannedStackLineRow,
	type PlannedVisualCell,
	planDiff,
} from "./plan.ts";
export { anchorRowIndex, rowHasAnchor, rowLineRange } from "./ranges.ts";
export {
	buildDiffRows,
	type DiffRowOptions,
	type IntralineColours,
	intralineRangesFor,
} from "./rows.ts";
export { sanitizeTerminalLine, sanitizeTerminalSpans } from "./terminalText.ts";
export type {
	DecorationAnchor,
	DiffCell,
	DiffChangeContent,
	DiffContextContent,
	DiffFile,
	DiffFileInput,
	DiffHunk,
	DiffHunkContent,
	DiffLayout,
	DiffLine,
	DiffLineRange,
	DiffMetadata,
	DiffRow,
	DiffSide,
	DiffSourceLineIdentity,
	DiffStats,
	DiffStatus,
	EmphasisRange,
	RangeDecoration,
	RenderSpan,
	SpanEmphasis,
} from "./types.ts";
export { columnWidth, wrappedRowCount, wrapSpans } from "./wrap.ts";
