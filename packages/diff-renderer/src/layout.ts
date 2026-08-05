import type { DiffFile, DiffLayout, DiffRow, DiffSide } from "./types.ts";
import { wrappedRowCount } from "./wrap.ts";

/** The focus bar a gutter opens with. */
const FOCUS_MARKER_COLUMNS = 1;
/** The attachment count a gutter closes with. */
const ATTACHMENT_MARKER_COLUMNS = 3;
/** Breathing room, the change sign, and the space after it. */
const SIGN_COLUMNS = 3;
/** Held clear so code never touches the split divider or the right edge. */
const EDGE_COLUMNS = 1;
/** The divider between split panes. */
const DIVIDER_COLUMNS = 1;
/** Wrapping code any tighter than this shreds it, so a cramped pane overflows instead. */
const MIN_CODE_COLUMNS = 8;

/** Columns one line-number gutter occupies. */
const gutterColumns = ({
	digits,
	showLineNumbers,
}: {
	digits: number;
	showLineNumbers: boolean;
}): number => FOCUS_MARKER_COLUMNS + (showLineNumbers ? digits : 0) + ATTACHMENT_MARKER_COLUMNS;

/** The two panes a split row divides `width` into, the divider taken out of the middle. */
export const splitPaneWidths = (width: number): { old: number; new: number } => {
	const content = Math.max(0, width - DIVIDER_COLUMNS);
	const old = Math.floor(content / 2);
	return { old, new: content - old };
};

/** Code columns a row's text is wrapped to, per side. Both sides match when stacked. */
export type CodeWidths = { deletions: number; additions: number };

const codeColumns = ({
	pane,
	gutters,
	gutter,
}: {
	pane: number;
	gutters: number;
	gutter: number;
}) => Math.max(MIN_CODE_COLUMNS, pane - gutters * gutter - SIGN_COLUMNS - EDGE_COLUMNS);

/**
 * The wrap budget a body of this width gives its code, gutters, sign, and the
 * padding either side of the text taken out. Row heights and rendering both read
 * it, so a planned height always matches what the body draws.
 */
export const diffCodeWidths = ({
	width,
	layout,
	digits,
	showLineNumbers = true,
	stackGutters = 2,
}: {
	width: number;
	layout: DiffLayout;
	digits: number;
	showLineNumbers?: boolean;
	/** Gutters a stacked row draws; a new or deleted file drops one. */
	stackGutters?: number;
}): CodeWidths => {
	const gutter = gutterColumns({ digits, showLineNumbers });
	if (layout === "stack") {
		const columns = codeColumns({ pane: width, gutters: stackGutters, gutter });
		return { deletions: columns, additions: columns };
	}
	const panes = splitPaneWidths(width);
	return {
		deletions: codeColumns({ pane: panes.old, gutters: 1, gutter }),
		additions: codeColumns({ pane: panes.new, gutters: 1, gutter }),
	};
};

/** Line numbers are right-aligned to the file's widest, so every gutter is one width. */
export const lineNumberDigits = (file: DiffFile): number => {
	const highest = Math.max(
		1,
		...file.metadata.hunks.flatMap((hunk) => [
			hunk.deletionStart + Math.max(0, hunk.deletionCount - 1),
			hunk.additionStart + Math.max(0, hunk.additionCount - 1),
		]),
	);
	return String(highest).length;
};

/**
 * The gutters a stacked body draws. A new or deleted file has one dead gutter
 * for every row; drop it rather than indent the whole body past a column that
 * can never hold a number.
 */
export const stackGutterSides = (rows: readonly DiffRow[]): DiffSide[] =>
	(["deletions", "additions"] as const).filter((side) =>
		rows.some(
			(row) =>
				row.type === "stack-line" &&
				(side === "deletions" ? row.cell.oldLineNumber : row.cell.newLineNumber) !== undefined,
		),
	);

/**
 * Visual rows one logical row renders as. Paired panes stay row-synced, so a
 * split row is as tall as its longer side.
 */
export const rowVisualHeight = (row: DiffRow, widths: CodeWidths): number => {
	if (row.type === "hunk-header") return 1;
	if (row.type === "stack-line") return wrappedRowCount(row.cell.spans, widths.additions);
	return Math.max(
		wrappedRowCount(row.old.spans, widths.deletions),
		wrappedRowCount(row.new.spans, widths.additions),
	);
};
