export { findFocusedDecorationAnchor, rangeToHunkIndex } from "./decorations.ts";
export { type HighlightedLines, prepareSyntaxHighlighting } from "./highlight.ts";
export type { DiffChromeWidths } from "./layout.ts";
export { countDiffStats, createDiffFile, inferLanguage, parsePatch } from "./model.ts";
export {
	type DiffPlanStyles,
	type DiffPlanVisibility,
	type DiffVisualPlan,
	type PaintDiffInput,
	type PaintedDiffRow,
	type PaintedDiffSlice,
	type PaintedGutter,
	type PaintedHunkHeaderRow,
	type PaintedSplitLineRow,
	type PaintedStackLineRow,
	type PaintedVisualCell,
	type PlanDiffInput,
	type PlannedDiffRow,
	type PlannedGutter,
	type PlannedHunkHeaderRow,
	type PlannedSplitLineRow,
	type PlannedStackLineRow,
	type PlannedVisualCell,
	paintDiff,
	planDiff,
} from "./plan.ts";
export { anchorRowIndex, plannedRowIdentity } from "./ranges.ts";
export { sanitizeTerminalLine } from "./terminalText.ts";
export type {
	DecorationAnchor,
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
	DiffSide,
	DiffSourceLineIdentity,
	DiffStats,
	DiffStatus,
	EmphasisRange,
	RangeDecoration,
	RenderSpan,
	SpanEmphasis,
} from "./types.ts";
