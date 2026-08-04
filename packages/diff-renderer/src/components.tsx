import { type MouseEvent as OpenTUIMouseEvent, TextAttributes } from "@opentui/core";
import { createDiffFile } from "@revue/diff-model";
import type { Theme } from "@revue/theme";
import { useMemo, useRef, useState } from "react";
import { attachmentsForRow, rowHasAnchor, rowLineRange } from "./attachments.ts";
import { decorationAnchorId, findFocusedDecorationAnchor } from "./decorations.ts";
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
	SpanEmphasis,
} from "./types.ts";

const RIGHT_MOUSE_BUTTON = 2;

const lineNumber = (value: number | undefined, digits: number) =>
	value === undefined ? " ".repeat(digits) : String(value).padStart(digits);

function CellContent({ cell, theme }: { cell: DiffCell; theme: Theme }) {
	return (
		<>
			{cell.spans.map((span, index) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: immutable syntax spans have no independent identity.
					key={`${index}:${span.text}`}
					fg={span.fg ?? theme.text}
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

/** The change marker is chrome rather than code, so it stays out of anything the reader drags over. */
function LineContent({ cell, lineId, theme }: { cell: DiffCell; lineId?: string; theme: Theme }) {
	const sign = cell.kind === "addition" ? "+" : cell.kind === "deletion" ? "-" : " ";
	return (
		<>
			<text fg={theme.text} wrapMode="none" flexShrink={0} selectable={false}>
				{sign}{" "}
			</text>
			<text id={lineId} fg={theme.text} wrapMode="none" flexShrink={0} selectable>
				<CellContent cell={cell} theme={theme} />
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
	const number = side === "deletions" ? cell.oldLineNumber : cell.newLineNumber;
	const backgroundColor = focused
		? side === "additions"
			? theme.addedContentBg
			: theme.removedContentBg
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
				focused={focused}
				number={number}
				digits={digits}
				showLineNumbers={showLineNumbers}
				attachmentCount={attachmentCount}
				handlers={number === undefined ? undefined : handlers}
				theme={theme}
			/>
			<LineContent cell={cell} lineId={lineId} theme={theme} />
		</box>
	);
}

function StackCell({
	cell,
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
	digits: number;
	showLineNumbers: boolean;
	sides: DiffSide[];
	attachmentCounts: AttachmentCounts;
	interactions: CellInteractions;
	lineId?: string;
	onContextMenu?: (event: OpenTUIMouseEvent) => void;
	theme: Theme;
}) {
	const oldFocused = cell.focusedSides.includes("deletions");
	const newFocused = cell.focusedSides.includes("additions");
	const backgroundColor = oldFocused
		? theme.removedContentBg
		: newFocused
			? theme.addedContentBg
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
					focused={oldFocused}
					number={cell.oldLineNumber}
					digits={digits}
					showLineNumbers={showLineNumbers}
					attachmentCount={attachmentCounts.deletions ?? 0}
					handlers={cell.oldLineNumber === undefined ? undefined : interactions.deletions}
					theme={theme}
				/>
			) : null}
			{sides.includes("additions") ? (
				<Gutter
					focused={newFocused}
					number={cell.newLineNumber}
					digits={digits}
					showLineNumbers={showLineNumbers}
					attachmentCount={attachmentCounts.additions ?? 0}
					handlers={cell.newLineNumber === undefined ? undefined : interactions.additions}
					theme={theme}
				/>
			) : null}
			<LineContent cell={cell} lineId={lineId} theme={theme} />
		</box>
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
	/** Char-exact restyling of novel tokens, e.g. from a semantic diff. */
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
		? { ...displayedRange, id: "diff-pointer-selection" }
		: null;
	const renderedDecorations = selectionDecoration
		? [...decorations, selectionDecoration]
		: decorations;
	const renderedFocusId = selectionDecoration?.id ?? focusedDecorationId;
	const rows = useMemo(
		() =>
			normalized
				? buildDiffRows(normalized, layout, {
						syntaxTheme: theme.syntaxTheme,
						decorations: renderedDecorations,
						focusedDecorationId: renderedFocusId,
						emphasis,
					})
				: [],
		[normalized, layout, theme.syntaxTheme, renderedDecorations, renderedFocusId, emphasis],
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
	const highestLine = normalized
		? Math.max(
				1,
				...normalized.metadata.hunks.flatMap((hunk) => [
					hunk.deletionStart + Math.max(0, hunk.deletionCount - 1),
					hunk.additionStart + Math.max(0, hunk.additionCount - 1),
				]),
			)
		: 1;
	const digits = String(highestLine).length;
	// A new or deleted file has one dead gutter for every row; drop it rather
	// than indent the whole body past a column that can never hold a number.
	const stackSides: DiffSide[] = (["deletions", "additions"] as const).filter((side) =>
		rows.some(
			(row) =>
				row.type === "stack-line" &&
				(side === "deletions" ? row.cell.oldLineNumber : row.cell.newLineNumber) !== undefined,
		),
	);
	const splitContentWidth = Math.max(0, width - 1);
	const oldPaneWidth = Math.floor(splitContentWidth / 2);
	const newPaneWidth = splitContentWidth - oldPaneWidth;

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
							<box
								id={id}
								width="100%"
								height={1}
								flexDirection="row"
								backgroundColor={selected ? theme.selectedHunk : undefined}
							>
								<SplitCell
									cell={row.old}
									side="deletions"
									digits={digits}
									showLineNumbers={showLineNumbers}
									width={oldPaneWidth}
									attachmentCount={counts.deletions ?? 0}
									handlers={gutterHandlers(lineRange(row, "deletions"))}
									lineId={lineId(lineRange(row, "deletions"))}
									onContextMenu={contextHandler(lineRange(row, "deletions"))}
									theme={theme}
								/>
								<text fg={theme.border}>│</text>
								<SplitCell
									cell={row.new}
									side="additions"
									digits={digits}
									showLineNumbers={showLineNumbers}
									width={newPaneWidth}
									attachmentCount={counts.additions ?? 0}
									handlers={gutterHandlers(lineRange(row, "additions"))}
									lineId={lineId(lineRange(row, "additions"))}
									onContextMenu={contextHandler(lineRange(row, "additions"))}
									theme={theme}
								/>
							</box>
							{attachments.map((attachment) => (
								<box
									key={attachment.id}
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
						<box
							id={id}
							width="100%"
							height={1}
							backgroundColor={selected ? theme.selectedHunk : undefined}
						>
							<StackCell
								cell={row.cell}
								digits={digits}
								showLineNumbers={showLineNumbers}
								sides={stackSides}
								attachmentCounts={counts}
								interactions={{
									deletions: gutterHandlers(lineRange(row, "deletions")),
									additions: gutterHandlers(lineRange(row, "additions")),
								}}
								lineId={lineId(stackRange(row))}
								onContextMenu={contextHandler(stackRange(row))}
								theme={theme}
							/>
						</box>
						{attachments.map((attachment) => (
							<box
								key={attachment.id}
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
	onSelect?: () => void;
}

/** Compact path and stats row used inside Revue's existing collapse shell. */
export function DiffFileHeader({ file, width, theme, onSelect }: DiffFileHeaderProps) {
	const normalized = useMemo(() => createDiffFile(file), [file]);
	const state =
		normalized.metadata.type === "new"
			? " (new)"
			: normalized.metadata.type === "deleted"
				? " (deleted)"
				: "";
	const path =
		normalized.previousPath && normalized.previousPath !== normalized.path
			? `${normalized.previousPath} -> ${normalized.path}`
			: normalized.path;
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
