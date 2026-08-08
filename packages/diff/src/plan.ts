import { applicableDecorations, decorationsAtLine } from "./decorations.ts";
import type { CodeWidths, DiffChromeWidths } from "./layout.ts";
import { diffCodeWidths, lineNumberDigits, splitPaneWidths, stackGutterSides } from "./layout.ts";
import { drawMermaid } from "./mermaidAscii.ts";
import { buildDiffRows, tabAdjustedRanges } from "./rows.ts";
import { plainTerminalLine, sanitizeTerminalSpans } from "./terminalText.ts";
import type {
	DiffCell,
	DiffFile,
	DiffLayout,
	DiffLineRange,
	DiffRow,
	DiffSide,
	DiffSourceLineIdentity,
	EmphasisRange,
	RangeDecoration,
	RenderSpan,
	SpanEmphasis,
} from "./types.ts";
import { wrappedRowCount, wrapSpans } from "./wrap.ts";

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
	changeMarkers: boolean;
	hunkHeaders: boolean;
};

export type DiffStructure = {
	file: DiffFile;
	layout: DiffLayout;
	rows: DiffRow[];
	digits: number;
	stackGutterSides: DiffSide[];
};

export type DiffMeasurement = {
	structure: DiffStructure;
	width: number;
	visibility: DiffPlanVisibility;
	chrome: DiffChromeWidths;
	heights: number[];
};

export type PlannedGutter = {
	side: DiffSide;
	lineNumber?: number;
};

export type PlannedCellPaintSource = {
	/**
	 * Offset-only, unsanitised source retained to translate paint ranges after tab expansion.
	 * It must never be serialised or rendered; use the planned cell spans for presentation.
	 */
	rawText: string;
	intralineRanges: readonly EmphasisRange[];
};

/** Stable, wrapped geometry for one side of one visual terminal row. */
export type PlannedVisualCell = {
	kind: DiffCell["kind"];
	continuationIndex: number;
	/** Empty split-cell padding deliberately inserted to match the other pane's height. */
	padding: boolean;
	changeSign: " " | "+" | "-";
	spans: RenderSpan[];
	/** UTF-16 offset of this visual fragment in the sanitized logical source line. */
	sourceOffset: number;
	paintSource: PlannedCellPaintSource;
	identities: Partial<Record<DiffSide, DiffSourceLineIdentity>>;
	/** Present only on the source line's first visual row. */
	gutters?: Partial<Record<DiffSide, PlannedGutter>>;
};

export type PlannedHunkHeaderRow = {
	type: "hunk-header";
	key: string;
	hunkIndex: number;
	height: 0 | 1;
	text: string;
	source: { fileId: string; filePath: string; hunkIndex: number; hunkOldStart: number };
};

export type PlannedSplitLineRow = {
	type: "split-line";
	key: string;
	hunkIndex: number;
	height: number;
	visualRows: { continuationIndex: number; old: PlannedVisualCell; new: PlannedVisualCell }[];
};

export type PlannedStackLineRow = {
	type: "stack-line";
	key: string;
	hunkIndex: number;
	height: number;
	visualRows: { continuationIndex: number; cell: PlannedVisualCell }[];
};

export type PlannedDiffRow = PlannedHunkHeaderRow | PlannedSplitLineRow | PlannedStackLineRow;

/** The band a folded excerpt collapses to, and the header and body an open one expands into. */
export type PlannedExcerptRow =
	| { type: "excerpt-band"; key: string; height: 1; label: string; action: string }
	| { type: "excerpt-header"; key: string; height: 1; label: string; action: string }
	| { type: "excerpt-caption"; key: string; height: number; lines: string[] }
	| {
			type: "excerpt-line";
			key: string;
			height: number;
			filePath: string;
			lineNumber: number;
			visualRows: { continuationIndex: number; spans: RenderSpan[] }[];
	  };

/** The band a folded diagram collapses to, and the header and figure an open one expands into. */
export type PlannedDiagramRow =
	| { type: "diagram-band"; key: string; height: 1; label: string; action: string }
	| { type: "diagram-header"; key: string; height: 1; label: string; action: string }
	| {
			type: "diagram-line";
			key: string;
			height: number;
			visualRows: { continuationIndex: number; spans: RenderSpan[] }[];
	  };

/** Every row kind the engine plans, across file bodies and standalone quoted blocks. */
export type PlannedRow = PlannedDiffRow | PlannedExcerptRow | PlannedDiagramRow;

/** Stable geometry and source identities. Paint-only inputs are intentionally absent. */
export type DiffVisualPlan = {
	file: DiffFile;
	layout: DiffLayout;
	width: number;
	totalHeight: number;
	digits: number;
	visibility: DiffPlanVisibility;
	chrome: DiffChromeWidths;
	paneWidths: { old: number; new: number };
	stackGutterSides: DiffSide[];
	rows: PlannedDiffRow[];
};

type PlanDiffGeometryInput = {
	width: number;
	visibility: DiffPlanVisibility;
	chrome: DiffChromeWidths;
};

export type PlanDiffInput = PlanDiffGeometryInput &
	(
		| {
				file: DiffFile;
				layout: DiffLayout;
				/** Prepared syntax spans are stable geometry input; absent themes use raw text spans. */
				syntaxTheme?: string;
				structure?: never;
		  }
		| {
				structure: DiffStructure;
				file?: never;
				layout?: never;
				syntaxTheme?: never;
		  }
	);

export type MeasureDiffInput = {
	structure: DiffStructure;
	width: number;
	visibility: DiffPlanVisibility;
	chrome: DiffChromeWidths;
};

export type PaintedGutter = PlannedGutter & { focused: boolean };

export type PaintedVisualCell = Omit<PlannedVisualCell, "spans" | "gutters"> & {
	spans: RenderSpan[];
	backgroundColor: string;
	gutters?: Partial<Record<DiffSide, PaintedGutter>>;
};

export type PaintedHunkHeaderRow = PlannedHunkHeaderRow;
export type PaintedSplitLineRow = Omit<PlannedSplitLineRow, "visualRows"> & {
	selectedBackground?: string;
	visualRows: { continuationIndex: number; old: PaintedVisualCell; new: PaintedVisualCell }[];
};
export type PaintedStackLineRow = Omit<PlannedStackLineRow, "visualRows"> & {
	selectedBackground?: string;
	visualRows: { continuationIndex: number; cell: PaintedVisualCell }[];
};
export type PaintedDiffRow = PaintedHunkHeaderRow | PaintedSplitLineRow | PaintedStackLineRow;

export type PaintDiffInput = {
	plan: DiffVisualPlan;
	styles: DiffPlanStyles;
	/** Only this TUI-owned logical-row window is decorated and materialised. */
	window?: { start: number; end: number };
	decorations?: readonly RangeDecoration[];
	focusedDecorationId?: string;
	emphasis?: SpanEmphasis;
	selectedHunkIndex?: number;
};

export type PaintedDiffSlice = {
	plan: DiffVisualPlan;
	start: number;
	end: number;
	rows: PaintedDiffRow[];
};

const signFor = (kind: DiffCell["kind"]): " " | "+" | "-" =>
	kind === "addition" ? "+" : kind === "deletion" ? "-" : " ";

const structures = new WeakMap<DiffFile, Map<string, DiffStructure>>();

export const diffStructure = ({
	file,
	layout,
	syntaxTheme,
}: {
	file: DiffFile;
	layout: DiffLayout;
	syntaxTheme?: string;
}): DiffStructure => {
	let byLayout = structures.get(file);
	if (!byLayout) {
		byLayout = new Map();
		structures.set(file, byLayout);
	}
	const key = `${layout}:${syntaxTheme ?? ""}`;
	const cached = byLayout.get(key);
	if (cached) return cached;
	const rows = buildDiffRows(file, layout, { syntaxTheme });
	const structure = {
		file,
		layout,
		rows,
		digits: lineNumberDigits(file),
		stackGutterSides: stackGutterSides(rows),
	};
	byLayout.set(key, structure);
	return structure;
};

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

export const structureRowIdentity = ({
	structure,
	row,
	side,
}: {
	structure: DiffStructure;
	row: DiffRow;
	side: DiffSide;
}): DiffSourceLineIdentity | undefined => {
	if (row.type === "hunk-header") return undefined;
	const cell = row.type === "stack-line" ? row.cell : side === "deletions" ? row.old : row.new;
	return identityFor({ file: structure.file, row, cell, side });
};

const plannedCells = ({
	file,
	row,
	cell,
	wrapped,
	height,
	sides,
	visibility,
}: {
	file: DiffFile;
	row: DiffRow;
	cell: DiffCell;
	wrapped: RenderSpan[][];
	height: number;
	sides: readonly DiffSide[];
	visibility: DiffPlanVisibility;
}): PlannedVisualCell[] => {
	const identities: Partial<Record<DiffSide, DiffSourceLineIdentity>> = {};
	for (const side of sides) {
		const identity = identityFor({ file, row, cell, side });
		if (identity) identities[side] = identity;
	}
	const paintSource: PlannedCellPaintSource = {
		rawText: cell.rawText,
		intralineRanges: cell.intralineRanges,
	};
	let sourceOffset = 0;
	return Array.from({ length: height }, (_, continuationIndex) => {
		const spans = wrapped[continuationIndex] ?? [];
		const gutters: Partial<Record<DiffSide, PlannedGutter>> = {};
		if (visibility.lineNumbers && continuationIndex === 0) {
			for (const side of sides) {
				gutters[side] = { side, lineNumber: identities[side]?.lineNumber };
			}
		}
		const planned: PlannedVisualCell = {
			kind: cell.kind,
			continuationIndex,
			padding: continuationIndex >= wrapped.length,
			changeSign: visibility.changeMarkers && continuationIndex === 0 ? signFor(cell.kind) : " ",
			spans,
			sourceOffset,
			paintSource,
			identities,
			gutters: visibility.lineNumbers && continuationIndex === 0 ? gutters : undefined,
		};
		sourceOffset += spans.reduce((length, span) => length + span.text.length, 0);
		return planned;
	});
};

export const measureDiff = ({
	structure,
	width,
	visibility,
	chrome,
}: MeasureDiffInput): DiffMeasurement => {
	const codeWidths: CodeWidths = diffCodeWidths({
		width,
		layout: structure.layout,
		digits: structure.digits,
		showLineNumbers: visibility.lineNumbers,
		showChangeMarkers: visibility.changeMarkers,
		stackGutters: structure.stackGutterSides.length,
		chrome,
	});
	const heights = structure.rows.map((row) => {
		if (row.type === "hunk-header") return visibility.hunkHeaders ? 1 : 0;
		return row.type === "stack-line"
			? wrappedRowCount(row.cell.spans, codeWidths.additions)
			: Math.max(
					wrappedRowCount(row.old.spans, codeWidths.deletions),
					wrappedRowCount(row.new.spans, codeWidths.additions),
				);
	});
	return { structure, width, visibility, chrome, heights };
};

/**
 * Produce stable width-aware geometry shared by measurement and presentation. Decorations,
 * focus, selection and colours are excluded so interactive paint changes cannot rebuild wrapping.
 */
export function planDiff(input: PlanDiffInput): DiffVisualPlan {
	const { width, visibility, chrome } = input;
	const source =
		input.structure ??
		diffStructure({ file: input.file, layout: input.layout, syntaxTheme: input.syntaxTheme });
	const file = source.file;
	const rows = source.rows;
	const digits = source.digits;
	const stackSides = source.stackGutterSides;
	const codeWidths: CodeWidths = diffCodeWidths({
		width,
		layout: source.layout,
		digits,
		showLineNumbers: visibility.lineNumbers,
		showChangeMarkers: visibility.changeMarkers,
		stackGutters: stackSides.length,
		chrome,
	});
	const paneWidths = splitPaneWidths(width, chrome.divider);
	const planned: PlannedDiffRow[] = rows.map((row) => {
		if (row.type === "hunk-header") {
			const hunk = file.metadata.hunks[row.hunkIndex];
			return {
				type: "hunk-header",
				key: row.key,
				hunkIndex: row.hunkIndex,
				height: visibility.hunkHeaders ? 1 : 0,
				text: plainTerminalLine(row.text),
				source: {
					fileId: file.id,
					filePath: file.path,
					hunkIndex: row.hunkIndex,
					hunkOldStart: hunk?.deletionStart ?? 0,
				},
			};
		}
		if (row.type === "stack-line") {
			const wrapped = wrapSpans(row.cell.spans, codeWidths.additions);
			const cells = plannedCells({
				file,
				row,
				cell: row.cell,
				wrapped,
				height: wrapped.length,
				sides: stackSides,
				visibility,
			});
			return {
				type: "stack-line",
				key: row.key,
				hunkIndex: row.hunkIndex,
				height: wrapped.length,
				visualRows: cells.map((cell, continuationIndex) => ({ continuationIndex, cell })),
			};
		}
		const oldRows = wrapSpans(row.old.spans, codeWidths.deletions);
		const newRows = wrapSpans(row.new.spans, codeWidths.additions);
		const height = Math.max(oldRows.length, newRows.length);
		const oldCells = plannedCells({
			file,
			row,
			cell: row.old,
			wrapped: oldRows,
			height,
			sides: ["deletions"],
			visibility,
		});
		const newCells = plannedCells({
			file,
			row,
			cell: row.new,
			wrapped: newRows,
			height,
			sides: ["additions"],
			visibility,
		});
		return {
			type: "split-line",
			key: row.key,
			hunkIndex: row.hunkIndex,
			height,
			visualRows: Array.from({ length: height }, (_, continuationIndex) => ({
				continuationIndex,
				old: oldCells[continuationIndex] as PlannedVisualCell,
				new: newCells[continuationIndex] as PlannedVisualCell,
			})),
		};
	});
	return {
		file: source.file,
		layout: source.layout,
		width,
		totalHeight: planned.reduce((height, row) => height + row.height, 0),
		digits,
		visibility,
		chrome,
		paneWidths,
		stackGutterSides: stackSides,
		rows: planned,
	};
}

// ── Context excerpts ───────────────────────────────────────────────────────
// A quotation of unchanged code a chapter cites. It is scenery rather than work: the quoted
// lines keep the additions gutter so they land on the same column as reviewable code in the
// same file, the sign slot stays empty because nothing changed, and the block never divides
// into two panes — an unchanged quotation has no old side to compare against.

/**
 * Syntax spans for the quoted lines, one entry per line. Unlike a diff body, which reads the
 * shared highlight cache as it builds rows, a quotation is handed its colours: the plan stays
 * pure, and a caller that prepared nothing simply gets plain text.
 */
export type ExcerptSpans = readonly (readonly RenderSpan[])[];

/** One cited range together with the bytes frozen for it. */
export type ExcerptQuotation = {
	filePath: string;
	startLine: number;
	endLine: number;
	caption?: string;
	lines: readonly string[];
};

export type ExcerptVisualPlan = {
	key: string;
	quotation: ExcerptQuotation;
	folded: boolean;
	width: number;
	digits: number;
	chrome: DiffChromeWidths;
	/** Columns of chrome every excerpt row reserves before its code. */
	gutterColumns: number;
	codeWidth: number;
	totalHeight: number;
	rows: PlannedExcerptRow[];
};

export type PlanExcerptInput = {
	key: string;
	quotation: ExcerptQuotation;
	folded: boolean;
	width: number;
	chrome: DiffChromeWidths;
	spans?: ExcerptSpans;
};

/**
 * An excerpt quotes unchanged content from the run's new endpoint, so a range over it is
 * new-side and belongs to no git hunk. Zero is the same "no textual hunk" sentinel review
 * units already use, and it keeps every quoted line of one file in a single draggable span.
 */
export const EXCERPT_HUNK_OLD_START = 0;

/** The range one quoted line acts on, so excerpt lines answer the diff's verbs unchanged. */
export const excerptLineRange = ({
	filePath,
	lineNumber,
}: {
	filePath: string;
	lineNumber: number;
}): DiffLineRange => ({
	filePath,
	hunkOldStart: EXCERPT_HUNK_OLD_START,
	side: "additions",
	startLine: lineNumber,
	endLine: lineNumber,
});

/** Narrower than this the open header sheds its state word rather than truncating the path. */
const EXCERPT_STATE_WIDTH = 100;
/** The caption is a figure label, indented under the block rather than heading it. */
const EXCERPT_CAPTION_INDENT = 3;

const excerptLabel = ({ filePath, startLine, endLine }: ExcerptQuotation): string =>
	`context · ${plainTerminalLine(filePath)} ${startLine}–${endLine}`;

const excerptDigits = ({ startLine, endLine }: ExcerptQuotation): number =>
	String(Math.max(startLine, endLine)).length;

const captionRow = (key: string, caption: string, width: number): PlannedExcerptRow => {
	const indent = " ".repeat(EXCERPT_CAPTION_INDENT);
	const lines = wrapSpans(
		[{ text: plainTerminalLine(caption) }],
		Math.max(1, width - EXCERPT_CAPTION_INDENT),
	).map((row) => indent + row.map((span) => span.text).join(""));
	return { type: "excerpt-caption", key: `${key}:caption`, height: lines.length, lines };
};

const excerptLineRow = ({
	key,
	quotation,
	index,
	codeWidth,
	spans,
}: {
	key: string;
	quotation: ExcerptQuotation;
	index: number;
	codeWidth: number;
	spans: ExcerptSpans | undefined;
}): PlannedExcerptRow => {
	// As a diff cell does: coloured spans when the quotation was prepared, plain text otherwise.
	const highlighted = spans?.[index];
	const wrapped = wrapSpans(
		highlighted?.length
			? sanitizeTerminalSpans(highlighted)
			: [{ text: plainTerminalLine(quotation.lines[index] ?? "") }],
		codeWidth,
	);
	const lineNumber = quotation.startLine + index;
	return {
		type: "excerpt-line",
		key: `${key}:line:${lineNumber}`,
		height: wrapped.length,
		filePath: quotation.filePath,
		lineNumber,
		visualRows: wrapped.map((spans, continuationIndex) => ({ continuationIndex, spans })),
	};
};

const openExcerptRows = ({
	key,
	quotation,
	width,
	codeWidth,
	spans,
}: {
	key: string;
	quotation: ExcerptQuotation;
	width: number;
	codeWidth: number;
	spans: ExcerptSpans | undefined;
}): PlannedExcerptRow[] => {
	const label = excerptLabel(quotation);
	return [
		...(quotation.caption ? [captionRow(key, quotation.caption, width)] : []),
		{
			type: "excerpt-header",
			key: `${key}:header`,
			height: 1,
			label: width < EXCERPT_STATE_WIDTH ? label : `${label} · unchanged`,
			action: "▲ hide",
		},
		...quotation.lines.map((_, index) =>
			excerptLineRow({ key, quotation, index, codeWidth, spans }),
		),
	];
};

const foldedExcerptRow = (key: string, quotation: ExcerptQuotation): PlannedExcerptRow => {
	const count = quotation.lines.length;
	return {
		type: "excerpt-band",
		key: `${key}:band`,
		height: 1,
		label: excerptLabel(quotation),
		action: `▼ show ${count} line${count === 1 ? "" : "s"}`,
	};
};

/**
 * Plan one excerpt block at a known width. Fold state is an input rather than something
 * measured after mount, so the viewport can window a folded block as one row and an open one
 * as its header, caption and quoted lines without rendering either first.
 */
export function planExcerpt({
	key,
	quotation,
	folded,
	width,
	chrome,
	spans,
}: PlanExcerptInput): ExcerptVisualPlan {
	const digits = excerptDigits(quotation);
	const gutterColumns = 2 * (chrome.focusMarker + digits + chrome.attachmentMarker) + chrome.sign;
	const codeWidth = diffCodeWidths({
		width,
		layout: "stack",
		digits,
		showLineNumbers: true,
		// Quoted code carries no sign, but the slot stays reserved so it starts in the same
		// column as diff code and the eye reads one edge down the page.
		showChangeMarkers: true,
		stackGutters: 2,
		chrome,
	}).additions;
	const rows = folded
		? [foldedExcerptRow(key, quotation)]
		: openExcerptRows({ key, quotation, width, codeWidth, spans });
	return {
		key,
		quotation,
		folded,
		width,
		digits,
		chrome,
		gutterColumns,
		codeWidth,
		totalHeight: rows.reduce((height, row) => height + row.height, 0),
		rows,
	};
}

// ── Diagrams ───────────────────────────────────────────────────────────────
// A figure a chapter draws rather than a range it quotes. It wears the excerpt's chrome so the
// two read as one family, but it cites no file: nothing is numbered, and the gutter is blank
// width whose only job is to land the figure on the column quoted code starts on.

export type DiagramKind = "ascii" | "mermaid";

/** One figure, already separated from the narration that carried it. */
export type Diagram = { kind: DiagramKind; lines: readonly string[] };

export type DiagramVisualPlan = {
	key: string;
	diagram: Diagram;
	/** False only for Mermaid this subset cannot lay out, whose own source is shown instead. */
	drawn: boolean;
	folded: boolean;
	width: number;
	chrome: DiffChromeWidths;
	/** Columns of blank chrome every figure row reserves before its text. */
	gutterColumns: number;
	codeWidth: number;
	totalHeight: number;
	rows: PlannedDiagramRow[];
};

export type PlanDiagramInput = {
	key: string;
	diagram: Diagram;
	folded: boolean;
	width: number;
	chrome: DiffChromeWidths;
};

/**
 * A diagram numbers nothing, but keeping the excerpt's default numbering width means a figure
 * and a quotation start on the same column.
 */
const DIAGRAM_GUTTER_DIGITS = 3;

const DIAGRAM_LABELS: Record<DiagramKind, string> = {
	ascii: "diagram · ascii",
	mermaid: "diagram · mermaid",
};

/**
 * What the block actually holds: the figure itself, or the source it could not be drawn from. A
 * folded block still lays out, because whether it drew is what its own label has to say.
 */
type DiagramFigure = { drawn: boolean; label: string; lines: readonly string[] };

const diagramFigure = (diagram: Diagram, codeWidth: number): DiagramFigure => {
	const label = DIAGRAM_LABELS[diagram.kind];
	if (diagram.kind !== "mermaid") return { drawn: true, label, lines: diagram.lines };
	const drawing = drawMermaid({ source: diagram.lines, maxWidth: codeWidth });
	return drawing
		? { drawn: true, label, lines: drawing }
		: { drawn: false, label: `${label} source`, lines: diagram.lines };
};

const diagramLineRow = ({
	key,
	line,
	index,
	codeWidth,
}: {
	key: string;
	line: string;
	index: number;
	codeWidth: number;
}): PlannedDiagramRow => {
	const wrapped = wrapSpans([{ text: plainTerminalLine(line) }], codeWidth);
	return {
		type: "diagram-line",
		key: `${key}:line:${index}`,
		height: wrapped.length,
		visualRows: wrapped.map((spans, continuationIndex) => ({ continuationIndex, spans })),
	};
};

const openDiagramRows = ({
	key,
	figure,
	codeWidth,
}: {
	key: string;
	figure: DiagramFigure;
	codeWidth: number;
}): PlannedDiagramRow[] => [
	{
		type: "diagram-header",
		key: `${key}:header`,
		height: 1,
		label: figure.label,
		action: "▲ hide",
	},
	...figure.lines.map((line, index) => diagramLineRow({ key, line, index, codeWidth })),
];

const foldedDiagramRow = (key: string, figure: DiagramFigure): PlannedDiagramRow => {
	const count = figure.lines.length;
	return {
		type: "diagram-band",
		key: `${key}:band`,
		height: 1,
		label: figure.label,
		action: `▼ show ${count} line${count === 1 ? "" : "s"}`,
	};
};

/** Plan one diagram block at a known width, with the fold an input exactly as for an excerpt. */
export function planDiagram({
	key,
	diagram,
	folded,
	width,
	chrome,
}: PlanDiagramInput): DiagramVisualPlan {
	const digits = DIAGRAM_GUTTER_DIGITS;
	const gutterColumns = 2 * (chrome.focusMarker + digits + chrome.attachmentMarker) + chrome.sign;
	const codeWidth = diffCodeWidths({
		width,
		layout: "stack",
		digits,
		showLineNumbers: true,
		showChangeMarkers: true,
		stackGutters: 2,
		chrome,
	}).additions;
	const figure = diagramFigure(diagram, codeWidth);
	const rows = folded
		? [foldedDiagramRow(key, figure)]
		: openDiagramRows({ key, figure, codeWidth });
	return {
		key,
		diagram,
		drawn: figure.drawn,
		folded,
		width,
		chrome,
		gutterColumns,
		codeWidth,
		totalHeight: rows.reduce((height, row) => height + row.height, 0),
		rows,
	};
}

type OverlayStyle = { kind: "novel"; fg: string } | { kind: "background"; bg: string };

const inRange = (span: RenderSpan, style: OverlayStyle): RenderSpan =>
	style.kind === "novel"
		? { text: span.text, fg: style.fg, bold: true }
		: { ...span, bg: style.bg };

const outOfRange = (span: RenderSpan, style: OverlayStyle): RenderSpan =>
	style.kind === "novel" ? { ...span, dim: true } : span;

/** Cut one already-wrapped visual fragment at paint boundaries without changing its geometry. */
const overlaySpans = (
	spans: readonly RenderSpan[],
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

const emphasisOverlay = ({
	cell,
	emphasis,
	styles,
}: {
	cell: PlannedVisualCell;
	emphasis?: SpanEmphasis;
	styles: DiffPlanStyles;
}): { ranges: readonly EmphasisRange[]; style: OverlayStyle } | undefined => {
	const side: DiffSide | null =
		cell.kind === "deletion" ? "deletions" : cell.kind === "addition" ? "additions" : null;
	if (!side) return undefined;
	const line = cell.identities[side]?.lineNumber;
	const novel = emphasis && line !== undefined ? emphasis.rangesFor(side, line) : undefined;
	if (novel?.length && emphasis) {
		return {
			ranges: tabAdjustedRanges(cell.paintSource.rawText, novel),
			style: {
				kind: "novel",
				fg: side === "deletions" ? emphasis.deletionsFg : emphasis.additionsFg,
			},
		};
	}
	if (!cell.paintSource.intralineRanges.length) return undefined;
	return {
		ranges: cell.paintSource.intralineRanges,
		style: {
			kind: "background",
			bg:
				side === "deletions"
					? styles.intralineDeletionBackground
					: styles.intralineAdditionBackground,
		},
	};
};

const localRanges = (
	ranges: readonly EmphasisRange[],
	offset: number,
	length: number,
): EmphasisRange[] =>
	ranges.flatMap((range) => {
		const start = Math.max(range.start, offset);
		const end = Math.min(range.end, offset + length);
		return end > start ? [{ start: start - offset, end: end - offset }] : [];
	});

const focusFor = ({
	cell,
	side,
	decorations,
	focusedDecorationId,
}: {
	cell: PlannedVisualCell;
	side: DiffSide;
	decorations: readonly RangeDecoration[];
	focusedDecorationId?: string;
}): RangeDecoration | undefined => {
	const line = cell.identities[side]?.lineNumber;
	return decorationsAtLine(decorations, side, line).find(
		(range) =>
			range.active === true ||
			(focusedDecorationId !== undefined &&
				(range.id === focusedDecorationId || range.focusId === focusedDecorationId)),
	);
};

const paintCell = ({
	cell,
	styles,
	decorations,
	focusedDecorationId,
	emphasis,
}: {
	cell: PlannedVisualCell;
	styles: DiffPlanStyles;
	decorations: readonly RangeDecoration[];
	focusedDecorationId?: string;
	emphasis?: SpanEmphasis;
}): PaintedVisualCell => {
	const deletionFocus = focusFor({
		cell,
		side: "deletions",
		decorations,
		focusedDecorationId,
	});
	const additionFocus = focusFor({
		cell,
		side: "additions",
		decorations,
		focusedDecorationId,
	});
	const backgroundColor = deletionFocus
		? (deletionFocus.backgroundColor ?? styles.deletionFocusedBackground)
		: additionFocus
			? (additionFocus.backgroundColor ?? styles.additionFocusedBackground)
			: cell.kind === "addition"
				? styles.additionBackground
				: cell.kind === "deletion"
					? styles.deletionBackground
					: styles.contextBackground;
	const overlay = emphasisOverlay({ cell, emphasis, styles });
	const length = cell.spans.reduce((total, span) => total + span.text.length, 0);
	const spans = (
		overlay
			? overlaySpans(
					cell.spans,
					localRanges(overlay.ranges, cell.sourceOffset, length),
					overlay.style,
				)
			: [...cell.spans]
	).map((span) => ({ ...span, fg: span.fg ?? styles.text }));
	const gutters = cell.gutters
		? (Object.fromEntries(
				Object.entries(cell.gutters).map(([side, gutter]) => {
					const focus = side === "deletions" ? deletionFocus : additionFocus;
					return [
						side,
						{
							...gutter,
							focused: Boolean(focus && focus.showGutterMarker !== false),
						},
					];
				}),
			) as Partial<Record<DiffSide, PaintedGutter>>)
		: undefined;
	return { ...cell, spans, backgroundColor, gutters };
};

/**
 * Apply transient styling only to the mounted logical-row window. This stage has no width input and
 * consumes already-wrapped cells, so navigation, focus and pointer drags cannot recompute geometry.
 */
export function paintDiff({
	plan,
	styles,
	window,
	decorations = [],
	focusedDecorationId,
	emphasis,
	selectedHunkIndex,
}: PaintDiffInput): PaintedDiffSlice {
	const start = Math.max(0, Math.min(plan.rows.length, window?.start ?? 0));
	const end = Math.max(start, Math.min(plan.rows.length, window?.end ?? plan.rows.length));
	const applicable = applicableDecorations(plan.file, decorations);
	const rows = plan.rows.slice(start, end).map((row): PaintedDiffRow => {
		if (row.type === "hunk-header") return row;
		const selectedBackground =
			row.hunkIndex === selectedHunkIndex ? styles.selectedHunkBackground : undefined;
		if (row.type === "stack-line") {
			return {
				...row,
				selectedBackground,
				visualRows: row.visualRows.map(({ continuationIndex, cell }) => ({
					continuationIndex,
					cell: paintCell({
						cell,
						styles,
						decorations: applicable,
						focusedDecorationId,
						emphasis,
					}),
				})),
			};
		}
		return {
			...row,
			selectedBackground,
			visualRows: row.visualRows.map(({ continuationIndex, old, new: addition }) => ({
				continuationIndex,
				old: paintCell({
					cell: old,
					styles,
					decorations: applicable,
					focusedDecorationId,
					emphasis,
				}),
				new: paintCell({
					cell: addition,
					styles,
					decorations: applicable,
					focusedDecorationId,
					emphasis,
				}),
			})),
		};
	});
	return { plan, start, end, rows };
}
