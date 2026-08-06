import type { CodeWidths, DiffChromeWidths } from "./layout.ts";
import { diffCodeWidths, lineNumberDigits, splitPaneWidths, stackGutterSides } from "./layout.ts";
import { buildDiffRows } from "./rows.ts";
import { sanitizeTerminalLine } from "./terminalText.ts";
import type {
	DiffCell,
	DiffFile,
	DiffLayout,
	DiffRow,
	DiffSide,
	DiffSourceLineIdentity,
	RangeDecoration,
	RenderSpan,
	SpanEmphasis,
} from "./types.ts";
import { wrapSpans } from "./wrap.ts";

export type DiffPlanStyles = {
	text: string;
	contextBackground: string;
	additionBackground: string;
	deletionBackground: string;
	additionFocusedBackground: string;
	deletionFocusedBackground: string;
	selectedHunkBackground: string;
	intralineAdditionBackground: string;
	intralineDeletionBackground: string;
};

export type DiffPlanVisibility = {
	lineNumbers: boolean;
	hunkHeaders: boolean;
};

export type PlannedGutter = {
	side: DiffSide;
	lineNumber?: number;
	focused: boolean;
};

export type PlannedVisualCell = {
	kind: DiffCell["kind"];
	continuationIndex: number;
	/** Empty split-cell padding deliberately inserted to match the other pane's height. */
	padding: boolean;
	changeSign: " " | "+" | "-";
	spans: RenderSpan[];
	backgroundColor: string;
	identities: Partial<Record<DiffSide, DiffSourceLineIdentity>>;
	/** Present only on the source line's first visual row. */
	gutters?: Partial<Record<DiffSide, PlannedGutter>>;
};

export type PlannedHunkHeaderRow = {
	type: "hunk-header";
	logical: Extract<DiffRow, { type: "hunk-header" }>;
	key: string;
	hunkIndex: number;
	height: 0 | 1;
	text: string;
	source: { fileId: string; filePath: string; hunkIndex: number; hunkOldStart: number };
};

export type PlannedSplitLineRow = {
	type: "split-line";
	logical: Extract<DiffRow, { type: "split-line" }>;
	key: string;
	hunkIndex: number;
	height: number;
	selectedBackground?: string;
	visualRows: { continuationIndex: number; old: PlannedVisualCell; new: PlannedVisualCell }[];
};

export type PlannedStackLineRow = {
	type: "stack-line";
	logical: Extract<DiffRow, { type: "stack-line" }>;
	key: string;
	hunkIndex: number;
	height: number;
	selectedBackground?: string;
	visualRows: { continuationIndex: number; cell: PlannedVisualCell }[];
};

export type PlannedDiffRow = PlannedHunkHeaderRow | PlannedSplitLineRow | PlannedStackLineRow;

export type DiffVisualPlan = {
	file: DiffFile;
	layout: DiffLayout;
	width: number;
	totalHeight: number;
	digits: number;
	visibility: DiffPlanVisibility;
	chrome: DiffChromeWidths;
	codeWidths: CodeWidths;
	paneWidths: { old: number; new: number };
	stackGutterSides: DiffSide[];
	rows: PlannedDiffRow[];
};

export type PlanDiffInput = {
	file: DiffFile;
	layout: DiffLayout;
	width: number;
	visibility: DiffPlanVisibility;
	styles: DiffPlanStyles;
	chrome: DiffChromeWidths;
	decorations?: readonly RangeDecoration[];
	focusedDecorationId?: string;
	emphasis?: SpanEmphasis;
	syntaxTheme?: string;
	selectedHunkIndex?: number;
};

const signFor = (kind: DiffCell["kind"]): " " | "+" | "-" =>
	kind === "addition" ? "+" : kind === "deletion" ? "-" : " ";

const identityFor = ({
	file,
	row,
	cell,
	side,
}: {
	file: DiffFile;
	row: DiffRow;
	cell: DiffCell;
	side: DiffSide;
}): DiffSourceLineIdentity | undefined => {
	const lineNumber = side === "deletions" ? cell.oldLineNumber : cell.newLineNumber;
	const hunk = file.metadata.hunks[row.hunkIndex];
	if (lineNumber === undefined || !hunk) return undefined;
	return {
		fileId: file.id,
		filePath: file.path,
		hunkIndex: row.hunkIndex,
		hunkOldStart: hunk.deletionStart,
		side,
		lineNumber,
	};
};

const backgroundFor = (cell: DiffCell, styles: DiffPlanStyles): string => {
	if (cell.focusedSides.includes("deletions"))
		return cell.focusedBackgrounds.deletions ?? styles.deletionFocusedBackground;
	if (cell.focusedSides.includes("additions"))
		return cell.focusedBackgrounds.additions ?? styles.additionFocusedBackground;
	if (cell.kind === "addition") return styles.additionBackground;
	if (cell.kind === "deletion") return styles.deletionBackground;
	return styles.contextBackground;
};

const visualCell = ({
	file,
	row,
	cell,
	spans,
	continuationIndex,
	padding,
	sides,
	styles,
}: {
	file: DiffFile;
	row: DiffRow;
	cell: DiffCell;
	spans: RenderSpan[];
	continuationIndex: number;
	padding: boolean;
	sides: readonly DiffSide[];
	styles: DiffPlanStyles;
}): PlannedVisualCell => {
	const identities: Partial<Record<DiffSide, DiffSourceLineIdentity>> = {};
	const gutters: Partial<Record<DiffSide, PlannedGutter>> = {};
	for (const side of sides) {
		const identity = identityFor({ file, row, cell, side });
		if (identity) identities[side] = identity;
		if (continuationIndex === 0) {
			gutters[side] = {
				side,
				lineNumber: identity?.lineNumber,
				focused: cell.gutterFocusedSides.includes(side),
			};
		}
	}
	return {
		kind: cell.kind,
		continuationIndex,
		padding,
		changeSign: continuationIndex === 0 ? signFor(cell.kind) : " ",
		spans: spans.map((span) => ({ ...span, fg: span.fg ?? styles.text })),
		backgroundColor: backgroundFor(cell, styles),
		identities,
		gutters: continuationIndex === 0 ? gutters : undefined,
	};
};

/**
 * Produce the complete width-aware visual plan shared by presentation adapters.
 * Adapters mount or serialise these wrapped rows; they do not recompute geometry or padding.
 */
export function planDiff({
	file,
	layout,
	width,
	visibility,
	styles,
	chrome,
	decorations = [],
	focusedDecorationId,
	emphasis,
	syntaxTheme,
	selectedHunkIndex,
}: PlanDiffInput): DiffVisualPlan {
	const rows = buildDiffRows(file, layout, {
		syntaxTheme,
		decorations,
		focusedDecorationId,
		emphasis,
		intralineEmphasis: emphasis
			? undefined
			: {
					deletionsBg: styles.intralineDeletionBackground,
					additionsBg: styles.intralineAdditionBackground,
				},
	});
	const digits = lineNumberDigits(file);
	const stackSides = stackGutterSides(rows);
	const codeWidths = diffCodeWidths({
		width,
		layout,
		digits,
		showLineNumbers: visibility.lineNumbers,
		stackGutters: stackSides.length,
		chrome,
	});
	const paneWidths = splitPaneWidths(width, chrome.divider);
	const planned: PlannedDiffRow[] = rows.map((row) => {
		if (row.type === "hunk-header") {
			const hunk = file.metadata.hunks[row.hunkIndex];
			return {
				type: "hunk-header",
				logical: row,
				key: row.key,
				hunkIndex: row.hunkIndex,
				height: visibility.hunkHeaders ? 1 : 0,
				text: sanitizeTerminalLine(row.text).replaceAll("\t", "  "),
				source: {
					fileId: file.id,
					filePath: file.path,
					hunkIndex: row.hunkIndex,
					hunkOldStart: hunk?.deletionStart ?? 0,
				},
			};
		}
		const selectedBackground =
			row.hunkIndex === selectedHunkIndex ? styles.selectedHunkBackground : undefined;
		if (row.type === "stack-line") {
			const wrapped = wrapSpans(row.cell.spans, codeWidths.additions);
			return {
				type: "stack-line",
				logical: row,
				key: row.key,
				hunkIndex: row.hunkIndex,
				height: wrapped.length,
				selectedBackground,
				visualRows: wrapped.map((spans, continuationIndex) => ({
					continuationIndex,
					cell: visualCell({
						file,
						row,
						cell: row.cell,
						spans,
						continuationIndex,
						padding: false,
						sides: stackSides,
						styles,
					}),
				})),
			};
		}
		const oldRows = wrapSpans(row.old.spans, codeWidths.deletions);
		const newRows = wrapSpans(row.new.spans, codeWidths.additions);
		const height = Math.max(oldRows.length, newRows.length);
		return {
			type: "split-line",
			logical: row,
			key: row.key,
			hunkIndex: row.hunkIndex,
			height,
			selectedBackground,
			visualRows: Array.from({ length: height }, (_, continuationIndex) => ({
				continuationIndex,
				old: visualCell({
					file,
					row,
					cell: row.old,
					spans: oldRows[continuationIndex] ?? [],
					continuationIndex,
					padding: continuationIndex >= oldRows.length,
					sides: ["deletions"],
					styles,
				}),
				new: visualCell({
					file,
					row,
					cell: row.new,
					spans: newRows[continuationIndex] ?? [],
					continuationIndex,
					padding: continuationIndex >= newRows.length,
					sides: ["additions"],
					styles,
				}),
			})),
		};
	});
	return {
		file,
		layout,
		width,
		totalHeight: planned.reduce((height, row) => height + row.height, 0),
		digits,
		visibility,
		chrome,
		codeWidths,
		paneWidths,
		stackGutterSides: stackSides,
		rows: planned,
	};
}
