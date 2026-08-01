export {
	DiffBody,
	type DiffBodyProps,
	DiffFileHeader,
	type DiffFileHeaderProps,
} from "./components.tsx";
export {
	applicableDecorations,
	decorationAnchorId,
	decorationsAtLine,
	findFocusedDecorationAnchor,
	rangeToHunkIndex,
} from "./decorations.ts";
export { highlightedLines, prepareSyntaxHighlighting } from "./highlight.ts";
export { countDiffStats, createDiffFile, inferLanguage, parsePatch } from "./model.ts";
export { buildDiffRows } from "./rows.ts";
export { sanitizeTerminalLine, sanitizeTerminalSpans } from "./terminalText.ts";
export type {
	DecorationAnchor,
	DiffCell,
	DiffFile,
	DiffFileInput,
	DiffLayout,
	DiffRow,
	DiffSide,
	DiffStats,
	RangeDecoration,
	RenderSpan,
} from "./types.ts";
