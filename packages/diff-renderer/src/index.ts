export { countDiffStats, createDiffFile, inferLanguage, parsePatch } from "@revue/diff-model";
export { anchorRowIndex, attachmentsForRow, rowLineRange } from "./attachments.ts";
export {
	DiffBody,
	type DiffBodyProps,
	DiffFileHeader,
	type DiffFileHeaderProps,
	type ExpandDirection,
} from "./components.tsx";
export {
	applicableDecorations,
	decorationAnchorId,
	decorationsAtLine,
	findFocusedDecorationAnchor,
	rangeToHunkIndex,
} from "./decorations.ts";
export { highlightedLines, prepareSyntaxHighlighting } from "./highlight.ts";
export {
	type CodeWidths,
	diffCodeWidths,
	lineNumberDigits,
	rowVisualHeight,
	stackGutterSides,
} from "./layout.ts";
export { diffLineId, diffRangeWithin } from "./lineIds.ts";
export { buildDiffRows, type DiffRowOptions } from "./rows.ts";
export { sanitizeTerminalLine, sanitizeTerminalSpans } from "./terminalText.ts";
export type {
	DecorationAnchor,
	DiffCell,
	DiffFile,
	DiffFileInput,
	DiffInlineAttachment,
	DiffLayout,
	DiffLineRange,
	DiffRow,
	DiffSide,
	DiffStats,
	EmphasisRange,
	RangeDecoration,
	RenderSpan,
	SpanEmphasis,
} from "./types.ts";
