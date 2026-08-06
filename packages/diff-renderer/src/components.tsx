import { type MouseEvent as OpenTUIMouseEvent, TextAttributes } from "@opentui/core";
import { createDiffFile } from "@revue/diff-model";
import type { Theme } from "@revue/theme";
import { useMemo, useRef, useState } from "react";
import { attachmentsForRow, rowHasAnchor, rowLineRange } from "./attachments.ts";
import { decorationAnchorId, findFocusedDecorationAnchor } from "./decorations.ts";
import {
	type CodeWidths,
	diffCodeWidths,
	lineNumberDigits,
	splitPaneWidths,
	stackGutterSides,
} from "./layout.ts";
import { diffLineId } from "./lineIds.ts";
import { buildDiffRows } from "./rows.ts";
import { sanitizeTerminalLine } from "./terminalText.ts";
import type {
	DiffCell,
	DiffFile,
	DiffFileInput,
	DiffInlineAttachment,
	DiffLayout,
	DiffLineRange,
	DiffRow,
	DiffSide,
	RangeDecoration,
	RenderSpan,
	SpanEmphasis,
} from "./types.ts";
import { wrapSpans } from "./wrap.ts";

const RIGHT_MOUSE_BUTTON = 2;

const lineNumber = (value: number | undefined, digits: number) =>
	value === undefined ? " ".repeat(digits) : String(value).padStart(digits);

function CellContent({ spans, theme }: { spans: readonly RenderSpan[]; theme: Theme }) {
	return (
		<>
			{spans.map((span, index) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: immutable syntax spans have no independent identity.
					key={`${index}:${span.text}`}
					fg={span.fg ?? theme.text}
					bg={span.bg}
					attributes={
						(span.bold ? TextAttributes.BOLD : 0) | (span.dim ? TextAttributes.DIM : 0) || undefined
					}
				>
					{span.text}
				</span>
			))}
		</>
	);
}

const signFor = (kind: DiffCell["kind"]) =>
	kind === "addition" ? "+" : kind === "deletion" ? "-" : " ";

/**
 * The change marker is chrome rather than code, so it stays out of anything the
 * reader drags over. It is padded either side: one column of air off the gutter,
 * one between sign and code. A wrapped line's later rows carry no sign at all.
 */
function LineContent({
	kind,
	spans,
	continuation,
	lineId,
	theme,
}: {
	kind: DiffCell["kind"];
	spans: readonly RenderSpan[];
	continuation: boolean;
	lineId?: string;
	theme: Theme;
}) {
	return (
		<>
			<text fg={theme.text} wrapMode="none" flexShrink={0} selectable={false}>
				{` ${continuation ? " " : signFor(kind)} `}
			</text>
			<text
				id={lineId}
				fg={theme.text}
				selectionBg={theme.badgeModified}
				selectionFg={theme.panelAlt}
				wrapMode="none"
				flexShrink={0}
				selectable
			>
				<CellContent spans={spans} theme={theme} />
			</text>
		</>
	);
}

type GutterHandlers = {
	onMouseDown?: (event: OpenTUIMouseEvent) => void;
	onMouseDrag?: (event: OpenTUIMouseEvent) => void;
	onMouseDragEnd?: (event: OpenTUIMouseEvent) => void;
	onMouseOver?: (event: OpenTUIMouseEvent) => void;
	onMouseUp?: (event: OpenTUIMouseEvent) => void;
};

type CellInteractions = Partial<Record<DiffSide, GutterHandlers>>;
type AttachmentCounts = Partial<Record<DiffSide, number>>;

const attachmentMarker = (count: number): string =>
	count > 0 ? `${String(count).padStart(2)}●` : "   ";

function Gutter({
	focused,
	number,
	digits,
	showLineNumbers,
	attachmentCount,
	handlers,
	theme,
}: {
	focused: boolean;
	number: number | undefined;
	digits: number;
	showLineNumbers: boolean;
	attachmentCount: number;
	handlers?: GutterHandlers;
	theme: Theme;
}) {
	return (
		<text
			fg={focused ? theme.accent : theme.lineNumberFg}
			wrapMode="none"
			flexShrink={0}
			selectable={false}
			{...handlers}
		>
			{focused ? "▌" : " "}
			{showLineNumbers ? lineNumber(number, digits) : ""}
			{attachmentMarker(attachmentCount)}
		</text>
	);
}

function SplitCell({
	cell,
	spans,
	continuation,
	side,
	digits,
	showLineNumbers,
	width,
	attachmentCount,
	handlers,
	lineId,
	onContextMenu,
	theme,
}: {
	cell: DiffCell;
	/** This visual row's slice of the cell; later rows of a wrapped line carry the rest. */
	spans: readonly RenderSpan[];
	continuation: boolean;
	side: DiffSide;
	digits: number;
	showLineNumbers: boolean;
	width: number;
	attachmentCount: number;
	handlers?: GutterHandlers;
	lineId?: string;
	onContextMenu?: (event: OpenTUIMouseEvent) => void;
	theme: Theme;
}) {
	const focused = cell.focusedSides.includes(side);
	const gutterFocused = !continuation && cell.gutterFocusedSides.includes(side);
	const number = side === "deletions" ? cell.oldLineNumber : cell.newLineNumber;
	const backgroundColor = focused
		? (cell.focusedBackgrounds[side] ??
			(side === "additions" ? theme.addedContentBg : theme.removedContentBg))
		: cell.kind === "addition"
			? theme.addedBg
			: cell.kind === "deletion"
				? theme.removedBg
				: theme.contextBg;
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a right click anywhere on the line acts on that line.
		<box
			width={width}
			flexShrink={0}
			height={1}
			overflow="hidden"
			backgroundColor={backgroundColor}
			flexDirection="row"
			onMouseDown={onContextMenu}
		>
			<Gutter
				focused={gutterFocused}
				number={continuation ? undefined : number}
				digits={digits}
				showLineNumbers={showLineNumbers}
				attachmentCount={continuation ? 0 : attachmentCount}
				handlers={continuation || number === undefined ? undefined : handlers}
				theme={theme}
			/>
			<LineContent
				kind={cell.kind}
				spans={spans}
				continuation={continuation}
				lineId={lineId}
				theme={theme}
			/>
		</box>
	);
}

function StackCell({
	cell,
	spans,
	continuation,
	digits,
	showLineNumbers,
	sides,
	attachmentCounts,
	interactions,
	lineId,
	onContextMenu,
	theme,
}: {
	cell: DiffCell;
	/** This visual row's slice of the cell; later rows of a wrapped line carry the rest. */
	spans: readonly RenderSpan[];
	continuation: boolean;
	digits: number;
	showLineNumbers: boolean;
	sides: readonly DiffSide[];
	attachmentCounts: AttachmentCounts;
	interactions: CellInteractions;
	lineId?: string;
	onContextMenu?: (event: OpenTUIMouseEvent) => void;
	theme: Theme;
}) {
	const oldFocused = cell.focusedSides.includes("deletions");
	const newFocused = cell.focusedSides.includes("additions");
	const backgroundColor = oldFocused
		? (cell.focusedBackgrounds.deletions ?? theme.removedContentBg)
		: newFocused
			? (cell.focusedBackgrounds.additions ?? theme.addedContentBg)
			: cell.kind === "addition"
				? theme.addedBg
				: cell.kind === "deletion"
					? theme.removedBg
					: theme.contextBg;
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a right click anywhere on the line acts on that line.
		<box
			width="100%"
			height={1}
			overflow="hidden"
			backgroundColor={backgroundColor}
			flexDirection="row"
			onMouseDown={onContextMenu}
		>
			{sides.includes("deletions") ? (
				<Gutter
					focused={!continuation && cell.gutterFocusedSides.includes("deletions")}
					number={continuation ? undefined : cell.oldLineNumber}
					digits={digits}
					showLineNumbers={showLineNumbers}
					attachmentCount={continuation ? 0 : (attachmentCounts.deletions ?? 0)}
					handlers={
						continuation || cell.oldLineNumber === undefined ? undefined : interactions.deletions
					}
					theme={theme}
				/>
			) : null}
			{sides.includes("additions") ? (
				<Gutter
					focused={!continuation && cell.gutterFocusedSides.includes("additions")}
					number={continuation ? undefined : cell.newLineNumber}
					digits={digits}
					showLineNumbers={showLineNumbers}
					attachmentCount={continuation ? 0 : (attachmentCounts.additions ?? 0)}
					handlers={
						continuation || cell.newLineNumber === undefined ? undefined : interactions.additions
					}
					theme={theme}
				/>
			) : null}
			<LineContent
				kind={cell.kind}
				spans={spans}
				continuation={continuation}
				lineId={lineId}
				theme={theme}
			/>
		</box>
	);
}

/** Everything a rendered line needs from the body about one of its sides. */
type SideInteraction = {
	handlers?: GutterHandlers;
	lineId?: string;
	onContextMenu?: (event: OpenTUIMouseEvent) => void;
};

type LineRowProps = {
	digits: number;
	showLineNumbers: boolean;
	widths: CodeWidths;
	attachmentCounts: AttachmentCounts;
	/** Named on the first visual row only, so navigation lands on the line's top. */
	anchorId?: string;
	selectedBackground?: string;
	theme: Theme;
};

/**
 * One logical line as the visual rows its wrapped sides need. Both panes take the
 * taller side's height, padding with empty continuation rows, so the divider runs
 * straight however unevenly the two sides wrap.
 */
function SplitLine({
	row,
	panes,
	deletions,
	additions,
	digits,
	showLineNumbers,
	widths,
	attachmentCounts,
	anchorId,
	selectedBackground,
	theme,
}: LineRowProps & {
	row: Extract<DiffRow, { type: "split-line" }>;
	panes: { old: number; new: number };
	deletions: SideInteraction;
	additions: SideInteraction;
}) {
	const oldRows = wrapSpans(row.old.spans, widths.deletions);
	const newRows = wrapSpans(row.new.spans, widths.additions);
	return (
		<>
			{Array.from({ length: Math.max(oldRows.length, newRows.length) }, (_, index) => (
				<box
					// biome-ignore lint/suspicious/noArrayIndexKey: visual rows are positional slices of one line.
					key={index}
					id={index === 0 ? anchorId : undefined}
					width="100%"
					height={1}
					flexDirection="row"
					backgroundColor={selectedBackground}
				>
					<SplitCell
						cell={row.old}
						spans={oldRows[index] ?? []}
						continuation={index > 0}
						side="deletions"
						digits={digits}
						showLineNumbers={showLineNumbers}
						width={panes.old}
						attachmentCount={attachmentCounts.deletions ?? 0}
						handlers={deletions.handlers}
						lineId={deletions.lineId}
						onContextMenu={deletions.onContextMenu}
						theme={theme}
					/>
					<text fg={theme.border}>│</text>
					<SplitCell
						cell={row.new}
						spans={newRows[index] ?? []}
						continuation={index > 0}
						side="additions"
						digits={digits}
						showLineNumbers={showLineNumbers}
						width={panes.new}
						attachmentCount={attachmentCounts.additions ?? 0}
						handlers={additions.handlers}
						lineId={additions.lineId}
						onContextMenu={additions.onContextMenu}
						theme={theme}
					/>
				</box>
			))}
		</>
	);
}

function StackLine({
	row,
	sides,
	interactions,
	lineId,
	onContextMenu,
	digits,
	showLineNumbers,
	widths,
	attachmentCounts,
	anchorId,
	selectedBackground,
	theme,
}: LineRowProps & {
	row: Extract<DiffRow, { type: "stack-line" }>;
	sides: readonly DiffSide[];
	interactions: CellInteractions;
	lineId?: string;
	onContextMenu?: (event: OpenTUIMouseEvent) => void;
}) {
	return (
		<>
			{wrapSpans(row.cell.spans, widths.additions).map((spans, index) => (
				<box
					// biome-ignore lint/suspicious/noArrayIndexKey: visual rows are positional slices of one line.
					key={index}
					id={index === 0 ? anchorId : undefined}
					width="100%"
					height={1}
					backgroundColor={selectedBackground}
				>
					<StackCell
						cell={row.cell}
						spans={spans}
						continuation={index > 0}
						digits={digits}
						showLineNumbers={showLineNumbers}
						sides={sides}
						attachmentCounts={attachmentCounts}
						interactions={interactions}
						lineId={lineId}
						onContextMenu={onContextMenu}
						theme={theme}
					/>
				</box>
			))}
		</>
	);
}

export interface DiffBodyProps {
	file?: DiffFileInput;
	layout?: DiffLayout;
	width: number;
	theme: Theme;
	showLineNumbers?: boolean;
	showHunkHeaders?: boolean;
	selectedHunkIndex?: number;
	decorations?: readonly RangeDecoration[];
	/** A decoration id or shared focusId; all matching ranges receive focus styling. */
	focusedDecorationId?: string;
	selectedRange?: DiffLineRange;
	inlineAttachments?: readonly DiffInlineAttachment[];
	/**
	 * Char-exact restyling of novel tokens, e.g. from a semantic diff. A host's own reading
	 * of the changed lines replaces the intra-line emphasis drawn by default.
	 */
	emphasis?: SpanEmphasis;
	/**
	 * Overrides the hunk lookup behind each line's range, so a body whose own hunks
	 * are display-only can emit ranges anchored to the authoritative patch.
	 */
	resolveRange?: (side: DiffSide, lineNumber: number) => DiffLineRange | null;
	/**
	 * GitHub-style context expanders on hunk boundaries. Boundary 0 sits above the
	 * first hunk; boundary hunkCount below the last. Absent boundaries render nothing.
	 */
	expanders?: {
		actionsFor: (boundary: number) => readonly ExpandDirection[];
		onExpand: (boundary: number, action: ExpandDirection) => void;
	};
	/**
	 * Mounts only the given row range (end exclusive), for hosts that window a
	 * large diff; the host owns the spacers standing in for unmounted rows. The
	 * trailing expander band counts as a pseudo-row at index rows.length.
	 */
	window?: { start: number; end: number };
	/**
	 * Reports the renderable behind each mounted inline attachment (null on
	 * unmount), letting a windowing host measure real attachment heights.
	 */
	onAttachmentNode?: (id: string, node: { height: number } | null) => void;
	onRangeSelect?: (range: DiffLineRange) => void;
	onRangeContextMenu?: (range: DiffLineRange, position: { x: number; y: number }) => void;
}

export type ExpandDirection = "up" | "down" | "all";

const EXPAND_LABELS: Record<ExpandDirection, string> = {
	up: "▲ expand up",
	down: "▼ expand down",
	all: "↕ expand all",
};

function ExpanderBand({
	boundary,
	actions,
	theme,
	onExpand,
}: {
	boundary: number;
	actions: readonly ExpandDirection[];
	theme: Theme;
	onExpand: (boundary: number, action: ExpandDirection) => void;
}) {
	return (
		<box width="100%" height={1} backgroundColor={theme.panel} flexDirection="row">
			<text flexShrink={0} fg={theme.muted} selectable={false}>
				{"  ⋯"}
			</text>
			{actions.map((action) => (
				// biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI pointer affordances live on text renderables.
				<text
					key={action}
					flexShrink={0}
					fg={theme.accent}
					selectable={false}
					onMouseDown={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onExpand(boundary, action);
					}}
				>
					{`  [${EXPAND_LABELS[action]}]`}
				</text>
			))}
		</box>
	);
}

function emptyBodyMessage(file: DiffFile): string {
	if (file.isTooLarge) return "Diff too large to display.";
	if (file.isBinary) return "Binary file differs.";
	if (file.metadata.type === "rename-pure") return "Renamed without changes.";
	if (file.metadata.type === "new") return "New empty file.";
	if (file.metadata.type === "deleted") return "Deleted file.";
	return "No text changes.";
}

/** Render a file body while leaving navigation, scrolling, and shell chrome to the host. */
export function DiffBody({
	file,
	layout = "split",
	width,
	theme,
	showLineNumbers = true,
	showHunkHeaders = true,
	selectedHunkIndex = 0,
	decorations = [],
	focusedDecorationId,
	selectedRange,
	inlineAttachments = [],
	emphasis,
	resolveRange,
	expanders,
	window: rowWindow,
	onAttachmentNode,
	onRangeSelect,
	onRangeContextMenu,
}: DiffBodyProps) {
	const normalized = useMemo(() => (file ? createDiffFile(file) : undefined), [file]);
	const activeStart = useRef<DiffLineRange | null>(null);
	const activeRange = useRef<DiffLineRange | null>(null);
	const [dragRange, setDragRange] = useState<DiffLineRange | null>(null);
	const displayedRange = dragRange ?? selectedRange;
	const selectionDecoration: RangeDecoration | null = displayedRange
		? {
				...displayedRange,
				id: "diff-pointer-selection",
				active: true,
				backgroundColor: theme.selectedHunk,
			}
		: null;
	const renderedDecorations = selectionDecoration
		? [selectionDecoration, ...decorations]
		: decorations;
	const intralineEmphasis = useMemo(
		() =>
			emphasis
				? undefined
				: { deletionsBg: theme.removedEmphasisBg, additionsBg: theme.addedEmphasisBg },
		[emphasis, theme.removedEmphasisBg, theme.addedEmphasisBg],
	);
	const rows = useMemo(
		() =>
			normalized
				? buildDiffRows(normalized, layout, {
						syntaxTheme: theme.syntaxTheme,
						decorations: renderedDecorations,
						focusedDecorationId,
						emphasis,
						intralineEmphasis,
					})
				: [],
		[
			normalized,
			layout,
			theme.syntaxTheme,
			renderedDecorations,
			focusedDecorationId,
			emphasis,
			intralineEmphasis,
		],
	);
	const anchor = useMemo(
		() =>
			normalized && focusedDecorationId
				? findFocusedDecorationAnchor(normalized, decorations, focusedDecorationId)
				: null,
		[normalized, decorations, focusedDecorationId],
	);
	const anchorRowKey = anchor ? rows.find((row) => rowHasAnchor(row, anchor))?.key : undefined;
	const anchorId = anchor ? decorationAnchorId(anchor) : undefined;
	const digits = normalized ? lineNumberDigits(normalized) : 1;
	const stackSides = stackGutterSides(rows);
	const panes = splitPaneWidths(width);
	const widths = diffCodeWidths({
		width,
		layout,
		digits,
		showLineNumbers,
		stackGutters: stackSides.length,
	});

	const lineRange = (row: DiffRow, side: DiffSide): DiffLineRange | null =>
		normalized ? rowLineRange({ file: normalized, row, side, resolveRange }) : null;
	const lineId = (range: DiffLineRange | null) => (range ? diffLineId(range) : undefined);
	/** A stacked row shows one line, so a click away from the gutters means the side that line lives on. */
	const stackRange = (row: Extract<DiffRow, { type: "stack-line" }>): DiffLineRange | null =>
		row.cell.kind === "deletion"
			? lineRange(row, "deletions")
			: (lineRange(row, "additions") ?? lineRange(row, "deletions"));
	const updateRange = (target: DiffLineRange): DiffLineRange | null => {
		const start = activeStart.current;
		if (
			!start ||
			start.filePath !== target.filePath ||
			start.hunkOldStart !== target.hunkOldStart ||
			start.side !== target.side
		) {
			return activeRange.current;
		}
		const next = {
			...start,
			startLine: Math.min(start.startLine, target.startLine),
			endLine: Math.max(start.endLine, target.endLine),
		};
		activeRange.current = next;
		setDragRange(next);
		return next;
	};
	const finishRange = () => {
		if (!activeStart.current) return;
		const completed = activeRange.current;
		activeStart.current = null;
		activeRange.current = null;
		setDragRange(null);
		if (completed) onRangeSelect?.(completed);
	};
	/** A right click inside the highlighted selection acts on all of it, not the one line under it. */
	const contextRange = (target: DiffLineRange): DiffLineRange =>
		displayedRange &&
		displayedRange.filePath === target.filePath &&
		displayedRange.side === target.side &&
		displayedRange.startLine <= target.startLine &&
		target.endLine <= displayedRange.endLine
			? displayedRange
			: target;
	const openContextMenu = (target: DiffLineRange, event: OpenTUIMouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		onRangeContextMenu?.(contextRange(target), { x: event.x, y: event.y });
	};
	/** Backs the gutter's own handler so the whole line answers to a right click, not just its number. */
	const contextHandler = (target: DiffLineRange | null) =>
		target && onRangeContextMenu
			? (event: OpenTUIMouseEvent) => {
					if (event.button === RIGHT_MOUSE_BUTTON) openContextMenu(target, event);
				}
			: undefined;
	const gutterHandlers = (target: DiffLineRange | null): GutterHandlers | undefined =>
		target && (onRangeSelect || onRangeContextMenu)
			? {
					onMouseDown: (event) => {
						if (event.button === RIGHT_MOUSE_BUTTON) {
							openContextMenu(target, event);
							return;
						}
						if (event.button !== 0) return;
						event.preventDefault();
						event.stopPropagation();
						activeStart.current = target;
						activeRange.current = target;
						setDragRange(target);
					},
					onMouseDrag: (event) => {
						event.preventDefault();
						event.stopPropagation();
					},
					onMouseOver: (event) => {
						if (!activeStart.current) return;
						event.preventDefault();
						event.stopPropagation();
						updateRange(target);
					},
					onMouseDragEnd: (event) => {
						event.preventDefault();
						event.stopPropagation();
						finishRange();
					},
					onMouseUp: (event) => {
						event.preventDefault();
						event.stopPropagation();
						finishRange();
					},
				}
			: undefined;
	const sideInteraction = (row: DiffRow, side: DiffSide): SideInteraction => {
		const range = lineRange(row, side);
		return {
			handlers: gutterHandlers(range),
			lineId: lineId(range),
			onContextMenu: contextHandler(range),
		};
	};
	const rowAttachments = (row: DiffRow): DiffInlineAttachment[] =>
		normalized
			? attachmentsForRow({ file: normalized, row, attachments: inlineAttachments, resolveRange })
			: [];
	const cancelActiveRange = () => {
		activeStart.current = null;
		activeRange.current = null;
		setDragRange(null);
	};
	const attachmentCounts = (row: DiffRow): AttachmentCounts => {
		const attachments = rowAttachments(row);
		return {
			deletions: attachments.filter((item) => item.anchor.side === "deletions").length,
			additions: attachments.filter((item) => item.anchor.side === "additions").length,
		};
	};

	if (!normalized) return <text fg={theme.muted}>No file selected.</text>;
	if (normalized.isTooLarge || normalized.isBinary || !normalized.metadata.hunks.length) {
		return <text fg={theme.muted}>{emptyBodyMessage(normalized)}</text>;
	}

	const visibleRows = rowWindow ? rows.slice(rowWindow.start, rowWindow.end) : rows;
	// A windowing host models the trailing band as a pseudo-row at index
	// rows.length, so the band mounts only when the window covers that index.
	const windowReachesEnd = !rowWindow || rowWindow.end > rows.length;
	const trailingBoundary = normalized.metadata.hunks.length;
	const trailingActions = windowReachesEnd ? (expanders?.actionsFor(trailingBoundary) ?? []) : [];

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the body clears incomplete gutter drags outside a selectable line.
		<box
			width={width}
			flexDirection="column"
			onMouseUp={cancelActiveRange}
			onMouseDragEnd={cancelActiveRange}
		>
			{visibleRows.map((row) => {
				if (row.type === "hunk-header") {
					const actions = expanders?.actionsFor(row.hunkIndex) ?? [];
					const band =
						expanders && actions.length ? (
							<ExpanderBand
								boundary={row.hunkIndex}
								actions={actions}
								theme={theme}
								onExpand={expanders.onExpand}
							/>
						) : null;
					if (!band && !showHunkHeaders) return null;
					return (
						<box key={row.key} flexDirection="column" width="100%">
							{band}
							{showHunkHeaders ? (
								<box width="100%" height={1} backgroundColor={theme.panel}>
									<text fg={theme.accent} wrapMode="none" truncate>
										{row.hunkIndex === selectedHunkIndex ? "▎" : " "}{" "}
										{sanitizeTerminalLine(row.text).replaceAll("\t", "  ")}
									</text>
								</box>
							) : null}
						</box>
					);
				}
				const selected = row.hunkIndex === selectedHunkIndex;
				const id = row.key === anchorRowKey ? anchorId : undefined;
				const attachments = rowAttachments(row);
				const counts = attachmentCounts(row);
				if (row.type === "split-line") {
					return (
						<box key={row.key} flexDirection="column" width="100%">
							<SplitLine
								row={row}
								panes={panes}
								deletions={sideInteraction(row, "deletions")}
								additions={sideInteraction(row, "additions")}
								digits={digits}
								showLineNumbers={showLineNumbers}
								widths={widths}
								attachmentCounts={counts}
								anchorId={id}
								selectedBackground={selected ? theme.selectedHunk : undefined}
								theme={theme}
							/>
							{attachments.map((attachment) => (
								<box
									key={attachment.id}
									id={attachment.id}
									width="100%"
									flexDirection="column"
									ref={(node) => onAttachmentNode?.(attachment.id, node)}
								>
									{attachment.content}
								</box>
							))}
						</box>
					);
				}
				return (
					<box key={row.key} flexDirection="column" width="100%">
						<StackLine
							row={row}
							sides={stackSides}
							interactions={{
								deletions: gutterHandlers(lineRange(row, "deletions")),
								additions: gutterHandlers(lineRange(row, "additions")),
							}}
							lineId={lineId(stackRange(row))}
							onContextMenu={contextHandler(stackRange(row))}
							digits={digits}
							showLineNumbers={showLineNumbers}
							widths={widths}
							attachmentCounts={counts}
							anchorId={id}
							selectedBackground={selected ? theme.selectedHunk : undefined}
							theme={theme}
						/>
						{attachments.map((attachment) => (
							<box
								key={attachment.id}
								id={attachment.id}
								width="100%"
								flexDirection="column"
								ref={(node) => onAttachmentNode?.(attachment.id, node)}
							>
								{attachment.content}
							</box>
						))}
					</box>
				);
			})}
			{expanders && trailingActions.length ? (
				<ExpanderBand
					boundary={trailingBoundary}
					actions={trailingActions}
					theme={theme}
					onExpand={expanders.onExpand}
				/>
			) : null}
		</box>
	);
}

export interface DiffFileHeaderProps {
	file: DiffFileInput;
	width: number;
	theme: Theme;
	formatPath?: (path: string, width: number) => string;
	onSelect?: () => void;
}

/** Compact path and stats row used inside Revue's existing collapse shell. */
export function DiffFileHeader({ file, width, theme, formatPath, onSelect }: DiffFileHeaderProps) {
	const normalized = useMemo(() => createDiffFile(file), [file]);
	const state =
		normalized.metadata.type === "new"
			? " (new)"
			: normalized.metadata.type === "deleted"
				? " (deleted)"
				: "";
	const fullPath =
		normalized.previousPath && normalized.previousPath !== normalized.path
			? `${normalized.previousPath} -> ${normalized.path}`
			: normalized.path;
	const statsWidth = `+${normalized.stats.additions} -${normalized.stats.deletions} `.length + 2;
	const path = formatPath
		? formatPath(fullPath, Math.max(1, width - statsWidth - state.length))
		: fullPath;
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI boxes expose pointer handlers without DOM roles.
		<box
			width={width}
			height={1}
			paddingLeft={1}
			flexDirection="row"
			justifyContent="space-between"
			backgroundColor={theme.panel}
			onMouseUp={onSelect}
		>
			<text fg={theme.text} wrapMode="none" flexShrink={1} minWidth={0} truncate>
				{sanitizeTerminalLine(path).replaceAll("\t", "  ")}
				<span fg={theme.muted}>{state}</span>
			</text>
			<text wrapMode="none" flexShrink={0} paddingLeft={1}>
				<span fg={theme.badgeAdded}>+{normalized.stats.additions}</span>
				<span fg={theme.muted}> </span>
				<span fg={theme.badgeRemoved}>-{normalized.stats.deletions}</span>
				<span> </span>
			</text>
		</box>
	);
}
