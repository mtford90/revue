import type { DiffFile, DiffLayout, DiffRow, DiffSide } from "./types.ts";

/** Declarative terminal chrome reserved around code by a presentation adapter. */
export type DiffChromeWidths = {
	focusMarker: number;
	attachmentMarker: number;
	sign: number;
	edge: number;
	divider: number;
	minimumCode: number;
};

/** Columns one line-number gutter occupies. */
const gutterColumns = ({
	digits,
	showLineNumbers,
	chrome,
}: {
	digits: number;
	showLineNumbers: boolean;
	chrome: DiffChromeWidths;
}): number => chrome.focusMarker + (showLineNumbers ? digits : 0) + chrome.attachmentMarker;

/** The two panes a split row divides `width` into after its declared divider. */
export const splitPaneWidths = (
	width: number,
	dividerColumns: number,
): { old: number; new: number } => {
	const content = Math.max(0, width - dividerColumns);
	const old = Math.floor(content / 2);
	return { old, new: content - old };
};

/** Code columns a row's text is wrapped to, per side. Both sides match when stacked. */
export type CodeWidths = { deletions: number; additions: number };

const codeColumns = ({
	pane,
	gutters,
	gutter,
	chrome,
}: {
	pane: number;
	gutters: number;
	gutter: number;
	chrome: DiffChromeWidths;
}) => Math.max(chrome.minimumCode, pane - gutters * gutter - chrome.sign - chrome.edge);

/** Resolve the code budgets for one explicit adapter chrome request. */
export const diffCodeWidths = ({
	width,
	layout,
	digits,
	showLineNumbers,
	stackGutters,
	chrome,
}: {
	width: number;
	layout: DiffLayout;
	digits: number;
	showLineNumbers: boolean;
	stackGutters: number;
	chrome: DiffChromeWidths;
}): CodeWidths => {
	const gutter = gutterColumns({ digits, showLineNumbers, chrome });
	if (layout === "stack") {
		const columns = codeColumns({ pane: width, gutters: stackGutters, gutter, chrome });
		return { deletions: columns, additions: columns };
	}
	const panes = splitPaneWidths(width, chrome.divider);
	return {
		deletions: codeColumns({ pane: panes.old, gutters: 1, gutter, chrome }),
		additions: codeColumns({ pane: panes.new, gutters: 1, gutter, chrome }),
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

/** Drop stacked gutters that can never contain a line number. */
export const stackGutterSides = (rows: readonly DiffRow[]): DiffSide[] =>
	(["deletions", "additions"] as const).filter((side) =>
		rows.some(
			(row) =>
				row.type === "stack-line" &&
				(side === "deletions" ? row.cell.oldLineNumber : row.cell.newLineNumber) !== undefined,
		),
	);
