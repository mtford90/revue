import { type MouseEvent as OpenTUIMouseEvent, TextAttributes } from "@opentui/core";
import {
	anchorRowIndex,
	createDiffFile,
	type DiagramVisualPlan,
	type DiffFile,
	type DiffFileInput,
	type DiffLayout,
	type DiffLineRange,
	type DiffSelection,
	type DiffSelectionRange,
	type DiffSelectionStop,
	type DiffSide,
	type DiffVisualPlan,
	diffSelectionStops,
	type ExcerptVisualPlan,
	excerptLineRange,
	findFocusedDecorationAnchor,
	type PaintedDiffRow,
	type PaintedSplitLineRow,
	type PaintedStackLineRow,
	type PaintedVisualCell,
	paintDiff,
	planDiff,
	type RangeDecoration,
	type RenderSpan,
	sanitizeTerminalLine,
	selectionBetween,
	selectionContains,
	terminalSelectionRange,
} from "@revue/diff";
import type { Theme } from "@revue/theme";
import { useMemo, useRef, useState } from "react";
import {
	attachmentsForExcerptLine,
	attachmentsForRow,
	type DiffInlineAttachment,
} from "./attachments.ts";
import { decorationAnchorId } from "./ids.ts";
import { diffLineId, parseDiffLineId } from "./selectionIds.ts";
import { diffPlanStyles, OPENTUI_DIFF_CHROME } from "./styles.ts";

const RIGHT_MOUSE_BUTTON = 2;
const EMPTY_DECORATIONS: readonly RangeDecoration[] = [];
const EMPTY_ATTACHMENTS: readonly DiffInlineAttachment[] = [];

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

function LineContent({
	cell,
	lineId,
	showChangeMarkers,
	theme,
}: {
	cell: PaintedVisualCell;
	lineId?: string;
	showChangeMarkers: boolean;
	theme: Theme;
}) {
	return (
		<>
			{showChangeMarkers ? (
				<text fg={theme.text} wrapMode="none" flexShrink={0} selectable={false}>
					{` ${cell.changeSign} `}
				</text>
			) : null}
			<text
				id={lineId}
				fg={theme.text}
				selectionBg={theme.badgeModified}
				selectionFg={theme.panelAlt}
				wrapMode="none"
				flexShrink={0}
				selectable
			>
				<CellContent spans={cell.spans} theme={theme} />
			</text>
		</>
	);
}

type GutterNode = { x: number; y: number; width: number; height: number };

type GutterHandlers = {
	ref?: (node: GutterNode | null) => void;
	onMouseDown?: (event: OpenTUIMouseEvent) => void;
	onMouseDrag?: (event: OpenTUIMouseEvent) => void;
	onMouseDragEnd?: (event: OpenTUIMouseEvent) => void;
	onMouseOver?: (event: OpenTUIMouseEvent) => void;
	onMouseUp?: (event: OpenTUIMouseEvent) => void;
};

type CellInteractions = Partial<Record<DiffSide, GutterHandlers>>;
type AttachmentCounts = Partial<Record<DiffSide, number>>;

type RangeSelectionInput = {
	selectedRange?: DiffLineRange;
	selectedSelection?: DiffSelection;
	/** Legacy single-range drag callback retained for standalone embedders. */
	onRangeSelect?: (range: DiffLineRange) => void;
	/** A single click moves the cursor and does not create a selection. */
	onRangeStart?: (range: DiffLineRange) => void;
	onSelectionChange?: (selection: DiffSelection) => void;
	onSelectionActivate?: (selection: DiffSelection) => void;
	onRangeContextMenu?: (range: DiffLineRange, position: { x: number; y: number }) => void;
	onSelectionContextMenu?: (selection: DiffSelection, position: { x: number; y: number }) => void;
	selectionStops?: readonly DiffSelectionStop[];
};

const stopForRange = (range: DiffLineRange): DiffSelectionStop => ({
	filePath: range.filePath,
	oldStart: range.hunkOldStart,
	side: range.side,
	lineNumber: range.startLine,
});

const selectionForRange = (range: DiffLineRange): DiffSelection => ({
	filePath: range.filePath,
	ranges: [
		{
			oldStart: range.hunkOldStart,
			side: range.side,
			startLine: range.startLine,
			endLine: range.endLine,
		},
	],
});

const lineRangeFor = (filePath: string, range: DiffSelectionRange): DiffLineRange => ({
	filePath,
	hunkOldStart: range.oldStart,
	side: range.side,
	startLine: range.startLine,
	endLine: range.endLine,
});

const DOUBLE_CLICK_MS = 400;

/** Pointer cursor, actual drag selection, activation, and context action are separate gestures. */
const useRangeSelection = ({
	selectedRange,
	selectedSelection,
	onRangeSelect,
	onRangeStart,
	onSelectionChange,
	onSelectionActivate,
	onRangeContextMenu,
	onSelectionContextMenu,
	selectionStops = [],
}: RangeSelectionInput) => {
	const activeStart = useRef<DiffSelectionStop | null>(null);
	const activeSelection = useRef<DiffSelection | null>(null);
	const dragged = useRef(false);
	const doubleClickCandidate = useRef(false);
	const lastClick = useRef<{ key: string; at: number } | null>(null);
	const gutterNodes = useRef(new Map<string, { node: GutterNode; range: DiffLineRange }>());
	const [dragSelection, setDragSelection] = useState<DiffSelection | null>(null);
	const displayedSelection =
		dragSelection ??
		selectedSelection ??
		(selectedRange ? selectionForRange(selectedRange) : undefined);
	const updateSelection = (target: DiffLineRange) => {
		const start = activeStart.current;
		if (!start) return;
		const targetStop = stopForRange(target);
		if (
			targetStop.filePath === start.filePath &&
			targetStop.oldStart === start.oldStart &&
			targetStop.side === start.side &&
			targetStop.lineNumber === start.lineNumber
		)
			return;
		const next = selectionBetween(selectionStops, start, targetStop);
		if (!next) return;
		dragged.current = true;
		activeSelection.current = next;
		setDragSelection(next);
		onSelectionChange?.(next);
		if (onRangeSelect) {
			const matching = next.ranges.filter(
				(range) => range.oldStart === start.oldStart && range.side === start.side,
			);
			if (matching.length) {
				onRangeSelect({
					filePath: start.filePath,
					hunkOldStart: start.oldStart,
					side: start.side,
					startLine: Math.min(...matching.map((range) => range.startLine)),
					endLine: Math.max(...matching.map((range) => range.endLine)),
				});
			}
		}
	};
	const finishAtEventTarget = (event: OpenTUIMouseEvent) => {
		const eventTarget = event.target?.id ? parseDiffLineId(event.target.id) : null;
		const coordinateTarget = [...gutterNodes.current.values()].find(
			({ node }) =>
				event.x >= node.x &&
				event.x < node.x + node.width &&
				event.y >= node.y &&
				event.y < node.y + node.height,
		)?.range;
		const target = coordinateTarget ?? eventTarget;
		const start = activeStart.current;
		const targetStop = target ? stopForRange(target) : null;
		const moved = Boolean(
			start &&
				targetStop &&
				(start.filePath !== targetStop.filePath ||
					start.oldStart !== targetStop.oldStart ||
					start.side !== targetStop.side ||
					start.lineNumber !== targetStop.lineNumber),
		);
		if (target && moved) updateSelection(target);
		finishSelection();
	};
	const finishSelection = () => {
		if (!activeStart.current) return;
		const activated = !dragged.current && doubleClickCandidate.current;
		const legacyClick =
			!dragged.current &&
			!activated &&
			Boolean(onRangeSelect) &&
			!onSelectionChange &&
			!onSelectionActivate &&
			!onRangeStart;
		const completed = dragged.current || legacyClick ? activeSelection.current : null;
		const activation = activated ? activeSelection.current : null;
		activeStart.current = null;
		activeSelection.current = null;
		dragged.current = false;
		doubleClickCandidate.current = false;
		setDragSelection(null);
		if (activation) onSelectionActivate?.(activation);
		if (!completed) return;
		onSelectionChange?.(completed);
		if (completed.ranges.length === 1) {
			onRangeSelect?.(lineRangeFor(completed.filePath, completed.ranges[0]));
		}
	};
	const cancelActiveRange = () => {
		activeStart.current = null;
		activeSelection.current = null;
		dragged.current = false;
		doubleClickCandidate.current = false;
		setDragSelection(null);
	};
	const contextSelection = (target: DiffLineRange): DiffSelection => {
		const stop = stopForRange(target);
		return displayedSelection && selectionContains(displayedSelection, stop)
			? displayedSelection
			: selectionForRange(target);
	};
	const openContextMenu = (target: DiffLineRange, event: OpenTUIMouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		const selection = contextSelection(target);
		if (onSelectionContextMenu) {
			onSelectionContextMenu(selection, { x: event.x, y: event.y });
			return;
		}
		const terminal = terminalSelectionRange(selection);
		onRangeContextMenu?.(lineRangeFor(selection.filePath, terminal), { x: event.x, y: event.y });
	};
	const contextHandler = (target: DiffLineRange | null) =>
		target && (onRangeContextMenu || onSelectionContextMenu)
			? (event: OpenTUIMouseEvent) => {
					if (event.button === RIGHT_MOUSE_BUTTON) openContextMenu(target, event);
				}
			: undefined;
	const gutterHandlers = (target: DiffLineRange | null): GutterHandlers | undefined =>
		target &&
		(onRangeSelect ||
			onRangeStart ||
			onSelectionChange ||
			onSelectionActivate ||
			onRangeContextMenu ||
			onSelectionContextMenu)
			? {
					ref: (node) => {
						const key = `${target.filePath}:${target.hunkOldStart}:${target.side}:${target.startLine}`;
						if (node) gutterNodes.current.set(key, { node, range: target });
						else gutterNodes.current.delete(key);
					},
					onMouseDown: (event) => {
						if (event.button === RIGHT_MOUSE_BUTTON) {
							openContextMenu(target, event);
							return;
						}
						if (event.button !== 0) return;
						event.preventDefault();
						event.stopPropagation();
						onRangeStart?.(target);
						const stop = stopForRange(target);
						const key = `${stop.filePath}:${stop.oldStart}:${stop.side}:${stop.lineNumber}`;
						const now = Date.now();
						doubleClickCandidate.current =
							lastClick.current?.key === key && now - lastClick.current.at <= DOUBLE_CLICK_MS;
						lastClick.current = doubleClickCandidate.current ? null : { key, at: now };
						activeStart.current = stop;
						activeSelection.current = selectionForRange(target);
						dragged.current = false;
					},
					onMouseDrag: (event) => {
						event.preventDefault();
						event.stopPropagation();
						updateSelection(target);
					},
					onMouseOver: (event) => {
						if (!activeStart.current) return;
						event.preventDefault();
						event.stopPropagation();
						updateSelection(target);
					},
					onMouseDragEnd: (event) => {
						event.preventDefault();
						event.stopPropagation();
						finishAtEventTarget(event);
					},
					onMouseUp: (event) => {
						event.preventDefault();
						event.stopPropagation();
						finishAtEventTarget(event);
					},
				}
			: undefined;
	return { displayedSelection, gutterHandlers, contextHandler, cancelActiveRange };
};

const attachmentMarker = (count: number): string =>
	count > 0 ? `${String(count).padStart(2)}●` : "   ";

function Gutter({
	focused,
	selectionEdge,
	id,
	number,
	digits,
	showLineNumbers,
	attachmentCount,
	handlers,
	theme,
}: {
	focused: boolean;
	selectionEdge: boolean;
	id?: string;
	number: number | undefined;
	digits: number;
	showLineNumbers: boolean;
	attachmentCount: number;
	handlers?: GutterHandlers;
	theme: Theme;
}) {
	return (
		<>
			{/* Continuation edges are paint only; only the numbered gutter below accepts gestures. */}
			<text fg={selectionEdge ? theme.accent : theme.lineNumberFg} selectable={false}>
				{selectionEdge ? "▌" : " "}
			</text>
			<text
				id={id ? `diff-gutter:${id}` : undefined}
				fg={focused ? theme.accent : theme.lineNumberFg}
				wrapMode="none"
				flexShrink={0}
				selectable={false}
				{...handlers}
			>
				{showLineNumbers ? lineNumber(number, digits) : ""}
				{attachmentMarker(attachmentCount)}
			</text>
		</>
	);
}

function SplitCell({
	cell,
	side,
	digits,
	showLineNumbers,
	showChangeMarkers,
	width,
	attachmentCount,
	handlers,
	lineId,
	onContextMenu,
	theme,
}: {
	cell: PaintedVisualCell;
	side: DiffSide;
	digits: number;
	showLineNumbers: boolean;
	showChangeMarkers: boolean;
	width: number;
	attachmentCount: number;
	handlers?: GutterHandlers;
	lineId?: string;
	onContextMenu?: (event: OpenTUIMouseEvent) => void;
	theme: Theme;
}) {
	const gutter = cell.gutters?.[side];
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a right click anywhere on the line acts on that line.
		<box
			width={width}
			flexShrink={0}
			height={1}
			overflow="hidden"
			backgroundColor={cell.backgroundColor}
			flexDirection="row"
			onMouseDown={onContextMenu}
		>
			{showLineNumbers ? (
				<Gutter
					focused={gutter?.focused ?? false}
					selectionEdge={(cell.selectionEdges[side] ?? false) || (gutter?.focused ?? false)}
					id={lineId}
					number={gutter?.lineNumber}
					digits={digits}
					showLineNumbers
					attachmentCount={gutter ? attachmentCount : 0}
					handlers={gutter?.lineNumber === undefined ? undefined : handlers}
					theme={theme}
				/>
			) : null}
			<LineContent
				cell={cell}
				lineId={lineId}
				showChangeMarkers={showChangeMarkers}
				theme={theme}
			/>
		</box>
	);
}

function StackCell({
	cell,
	digits,
	showLineNumbers,
	showChangeMarkers,
	sides,
	attachmentCounts,
	interactions,
	lineId,
	onContextMenu,
	theme,
}: {
	cell: PaintedVisualCell;
	digits: number;
	showLineNumbers: boolean;
	showChangeMarkers: boolean;
	sides: readonly DiffSide[];
	attachmentCounts: AttachmentCounts;
	interactions: CellInteractions;
	lineId?: string;
	onContextMenu?: (event: OpenTUIMouseEvent) => void;
	theme: Theme;
}) {
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a right click anywhere on the line acts on that line.
		<box
			width="100%"
			height={1}
			overflow="hidden"
			backgroundColor={cell.backgroundColor}
			flexDirection="row"
			onMouseDown={onContextMenu}
		>
			{sides.map((side) => {
				const gutter = cell.gutters?.[side];
				return (
					<Gutter
						key={side}
						focused={gutter?.focused ?? false}
						selectionEdge={(cell.selectionEdges[side] ?? false) || (gutter?.focused ?? false)}
						id={
							cell.identities[side]
								? diffLineId({
										filePath: cell.identities[side].filePath,
										hunkOldStart: cell.identities[side].hunkOldStart,
										side,
										startLine: cell.identities[side].lineNumber,
										endLine: cell.identities[side].lineNumber,
									})
								: undefined
						}
						number={gutter?.lineNumber}
						digits={digits}
						showLineNumbers={showLineNumbers}
						attachmentCount={gutter ? (attachmentCounts[side] ?? 0) : 0}
						handlers={gutter?.lineNumber === undefined ? undefined : interactions[side]}
						theme={theme}
					/>
				);
			})}
			<LineContent
				cell={cell}
				lineId={lineId}
				showChangeMarkers={showChangeMarkers}
				theme={theme}
			/>
		</box>
	);
}

type SideInteraction = {
	handlers?: GutterHandlers;
	lineId?: string;
	onContextMenu?: (event: OpenTUIMouseEvent) => void;
};

type LineRowProps = {
	digits: number;
	showLineNumbers: boolean;
	showChangeMarkers: boolean;
	attachmentCounts: AttachmentCounts;
	anchorId?: string;
	theme: Theme;
};

/** Mount an already-wrapped and already-padded split row from the engine plan. */
function SplitLine({
	row,
	panes,
	deletions,
	additions,
	digits,
	showLineNumbers,
	showChangeMarkers,
	attachmentCounts,
	anchorId,
	theme,
}: LineRowProps & {
	row: PaintedSplitLineRow;
	panes: { old: number; new: number };
	deletions: SideInteraction;
	additions: SideInteraction;
}) {
	return (
		<>
			{row.visualRows.map(({ continuationIndex, old, new: addition }) => (
				<box
					key={continuationIndex}
					id={continuationIndex === 0 ? anchorId : undefined}
					width="100%"
					height={1}
					flexDirection="row"
					backgroundColor={row.selectedBackground}
				>
					<SplitCell
						cell={old}
						side="deletions"
						digits={digits}
						showLineNumbers={showLineNumbers}
						showChangeMarkers={showChangeMarkers}
						width={panes.old}
						attachmentCount={attachmentCounts.deletions ?? 0}
						handlers={deletions.handlers}
						lineId={deletions.lineId}
						onContextMenu={deletions.onContextMenu}
						theme={theme}
					/>
					<text fg={theme.border}>│</text>
					<SplitCell
						cell={addition}
						side="additions"
						digits={digits}
						showLineNumbers={showLineNumbers}
						showChangeMarkers={showChangeMarkers}
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

/** Mount an already-wrapped stacked row from the engine plan. */
function StackLine({
	row,
	sides,
	interactions,
	lineId,
	onContextMenu,
	digits,
	showLineNumbers,
	showChangeMarkers,
	attachmentCounts,
	anchorId,
	theme,
}: LineRowProps & {
	row: PaintedStackLineRow;
	sides: readonly DiffSide[];
	interactions: CellInteractions;
	lineId?: string;
	onContextMenu?: (event: OpenTUIMouseEvent) => void;
}) {
	return (
		<>
			{row.visualRows.map(({ continuationIndex, cell }) => (
				<box
					key={continuationIndex}
					id={continuationIndex === 0 ? anchorId : undefined}
					width="100%"
					height={1}
					backgroundColor={row.selectedBackground}
				>
					<StackCell
						cell={cell}
						digits={digits}
						showLineNumbers={showLineNumbers}
						showChangeMarkers={showChangeMarkers}
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

interface DiffBodyPaintProps {
	theme: Theme;
	selectedHunkIndex?: number;
	decorations?: readonly RangeDecoration[];
	focusedDecorationId?: string;
	selectedRange?: DiffLineRange;
	selectedSelection?: DiffSelection;
	inlineAttachments?: readonly DiffInlineAttachment[];
	resolveRange?: (side: DiffSide, lineNumber: number) => DiffLineRange | null;
	expanders?: {
		actionsFor: (boundary: number) => readonly ExpandDirection[];
		onExpand: (boundary: number, action: ExpandDirection) => void;
	};
	window?: { start: number; end: number };
	onAttachmentNode?: (id: string, node: { height: number } | null) => void;
	onRangeSelect?: (range: DiffLineRange) => void;
	onRangeStart?: (range: DiffLineRange) => void;
	onSelectionChange?: (selection: DiffSelection) => void;
	onSelectionActivate?: (selection: DiffSelection) => void;
	onRangeContextMenu?: (range: DiffLineRange, position: { x: number; y: number }) => void;
	onSelectionContextMenu?: (selection: DiffSelection, position: { x: number; y: number }) => void;
}

/** Host-authoritative geometry: redundant planning inputs are deliberately forbidden. */
export type DiffBodySuppliedPlanProps = DiffBodyPaintProps & {
	plan: DiffVisualPlan;
	file?: never;
	layout?: never;
	width?: never;
	showLineNumbers?: never;
	showChangeMarkers?: never;
	showHunkHeaders?: never;
};

/** Standalone embedding: the adapter owns one plan from these explicit geometry inputs. */
export type DiffBodyStandaloneProps = DiffBodyPaintProps & {
	plan?: undefined;
	file: DiffFileInput;
	layout?: DiffLayout;
	width: number;
	showLineNumbers?: boolean;
	showChangeMarkers?: boolean;
	showHunkHeaders?: boolean;
};

/** Exactly one geometry authority: either a complete host plan or standalone planning inputs. */
export type DiffBodyProps = DiffBodySuppliedPlanProps | DiffBodyStandaloneProps;

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

/** Render a file body by mounting the engine's complete visual plan. */
export function DiffBody(props: DiffBodyProps) {
	const {
		theme,
		selectedHunkIndex = 0,
		decorations = EMPTY_DECORATIONS,
		focusedDecorationId,
		selectedRange,
		selectedSelection,
		inlineAttachments = EMPTY_ATTACHMENTS,
		resolveRange,
		expanders,
		window: rowWindow,
		onAttachmentNode,
		onRangeSelect,
		onRangeStart,
		onSelectionChange,
		onSelectionActivate,
		onRangeContextMenu,
		onSelectionContextMenu,
	} = props;
	const geometry = useMemo(() => {
		if (props.plan) return props.plan;
		return planDiff({
			file: createDiffFile(props.file),
			layout: props.layout ?? "split",
			width: props.width,
			visibility: {
				lineNumbers: props.showLineNumbers ?? true,
				changeMarkers: props.showChangeMarkers ?? true,
				hunkHeaders: props.showHunkHeaders ?? true,
			},
			chrome: OPENTUI_DIFF_CHROME,
			syntaxTheme: theme.syntaxTheme,
		});
	}, [
		props.plan,
		props.file,
		props.layout,
		props.width,
		props.showLineNumbers,
		props.showChangeMarkers,
		props.showHunkHeaders,
		theme.syntaxTheme,
	]);
	const normalized = geometry.file;
	const selectableStops = useMemo(() => {
		const seen = new Set<string>();
		return diffSelectionStops(normalized).flatMap((stop) => {
			const resolved = resolveRange
				? resolveRange(stop.side, stop.lineNumber)
				: {
						filePath: stop.filePath,
						hunkOldStart: stop.oldStart,
						side: stop.side,
						startLine: stop.lineNumber,
						endLine: stop.lineNumber,
					};
			if (!resolved) return [];
			const authoritative = stopForRange(resolved);
			const key = `${authoritative.filePath}:${authoritative.oldStart}:${authoritative.side}:${authoritative.lineNumber}`;
			if (seen.has(key)) return [];
			seen.add(key);
			return [authoritative];
		});
	}, [normalized, resolveRange]);
	const { displayedSelection, gutterHandlers, contextHandler, cancelActiveRange } =
		useRangeSelection({
			selectedRange,
			selectedSelection,
			onRangeSelect,
			onRangeStart,
			onSelectionChange,
			onSelectionActivate,
			onRangeContextMenu,
			onSelectionContextMenu,
			selectionStops: selectableStops,
		});
	const selectionDecorations = useMemo<RangeDecoration[]>(
		() =>
			displayedSelection?.ranges.map((range, index) => ({
				...range,
				filePath: displayedSelection.filePath,
				hunkOldStart: range.oldStart,
				id: `diff-pointer-selection:${index}`,
				active: true,
				backgroundColor: theme.selectedHunk,
			})) ?? [],
		[displayedSelection, theme.selectedHunk],
	);
	const renderedDecorations = useMemo(
		() => [...selectionDecorations, ...decorations],
		[selectionDecorations, decorations],
	);
	const styles = useMemo(() => diffPlanStyles(theme), [theme]);
	const painted = useMemo(
		() =>
			paintDiff({
				plan: geometry,
				styles,
				window: rowWindow,
				decorations: renderedDecorations,
				focusedDecorationId,
				selectedHunkIndex,
			}),
		[geometry, styles, rowWindow, renderedDecorations, focusedDecorationId, selectedHunkIndex],
	);
	const anchor = useMemo(
		() =>
			focusedDecorationId
				? findFocusedDecorationAnchor(normalized, decorations, focusedDecorationId)
				: null,
		[normalized, decorations, focusedDecorationId],
	);
	const anchorIndex = anchor && geometry ? anchorRowIndex(geometry, anchor) : -1;
	const anchorRowKey = anchorIndex >= 0 ? geometry?.rows[anchorIndex]?.key : undefined;
	const anchorId = anchor ? decorationAnchorId(anchor) : undefined;

	const rangeForIdentity = (
		identity: PaintedVisualCell["identities"][DiffSide],
	): DiffLineRange | null => {
		if (!identity) return null;
		if (resolveRange) return resolveRange(identity.side, identity.lineNumber);
		return {
			filePath: identity.filePath,
			hunkOldStart: identity.hunkOldStart,
			side: identity.side,
			startLine: identity.lineNumber,
			endLine: identity.lineNumber,
		};
	};
	const interaction = (cell: PaintedVisualCell, side: DiffSide): SideInteraction => {
		const range = rangeForIdentity(cell.identities[side]);
		return {
			handlers: gutterHandlers(range),
			lineId: range ? diffLineId(range) : undefined,
			onContextMenu: contextHandler(range),
		};
	};
	const rowAttachments = (row: Exclude<PaintedDiffRow, { type: "hunk-header" }>) =>
		attachmentsForRow({ row, attachments: inlineAttachments, resolveRange });

	if (normalized.isTooLarge || normalized.isBinary || !normalized.metadata.hunks.length)
		return <text fg={theme.muted}>{emptyBodyMessage(normalized)}</text>;

	const visibleRows = painted.rows;
	const windowReachesEnd = !rowWindow || rowWindow.end > geometry.rows.length;
	const trailingBoundary = normalized.metadata.hunks.length;
	const trailingActions = windowReachesEnd ? (expanders?.actionsFor(trailingBoundary) ?? []) : [];

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the body clears incomplete gutter drags outside a selectable line.
		<box
			width={geometry.width}
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
					if (!band && row.height === 0) return null;
					return (
						<box key={row.key} flexDirection="column" width="100%">
							{band}
							{row.height ? (
								<box width="100%" height={1} backgroundColor={theme.panel}>
									<text fg={theme.accent} wrapMode="none" truncate>
										{row.hunkIndex === selectedHunkIndex ? "▎" : " "} {row.text}
									</text>
								</box>
							) : null}
						</box>
					);
				}
				const attachments = rowAttachments(row);
				const counts: AttachmentCounts = {
					deletions: attachments.filter((item) => item.anchor.side === "deletions").length,
					additions: attachments.filter((item) => item.anchor.side === "additions").length,
				};
				const id = row.key === anchorRowKey ? anchorId : undefined;
				const firstCell =
					row.type === "split-line" ? row.visualRows[0]?.old : row.visualRows[0]?.cell;
				const secondCell = row.type === "split-line" ? row.visualRows[0]?.new : undefined;
				const body =
					row.type === "split-line" && firstCell && secondCell ? (
						<SplitLine
							row={row}
							panes={geometry.paneWidths}
							deletions={interaction(firstCell, "deletions")}
							additions={interaction(secondCell, "additions")}
							digits={geometry.digits}
							showLineNumbers={geometry.visibility.lineNumbers}
							showChangeMarkers={geometry.visibility.changeMarkers}
							attachmentCounts={counts}
							anchorId={id}
							theme={theme}
						/>
					) : row.type === "stack-line" && firstCell ? (
						<StackLine
							row={row}
							sides={geometry.visibility.lineNumbers ? geometry.stackGutterSides : []}
							interactions={{
								deletions: interaction(firstCell, "deletions").handlers,
								additions: interaction(firstCell, "additions").handlers,
							}}
							lineId={
								interaction(firstCell, firstCell.kind === "deletion" ? "deletions" : "additions")
									.lineId ?? interaction(firstCell, "deletions").lineId
							}
							onContextMenu={
								interaction(firstCell, firstCell.kind === "deletion" ? "deletions" : "additions")
									.onContextMenu ?? interaction(firstCell, "deletions").onContextMenu
							}
							digits={geometry.digits}
							showLineNumbers={geometry.visibility.lineNumbers}
							showChangeMarkers={geometry.visibility.changeMarkers}
							attachmentCounts={counts}
							anchorId={id}
							theme={theme}
						/>
					) : null;
				return (
					<box key={row.key} flexDirection="column" width="100%">
						{body}
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

/**
 * The one row a folded block collapses to, and the header an open one leads with. Excerpts and
 * diagrams share it so the two blocks cannot drift apart visually.
 */
function BlockBand({
	band,
	label,
	action,
	labelFg,
	theme,
	onToggle,
}: {
	band: boolean;
	label: string;
	action: string;
	labelFg: string;
	theme: Theme;
	onToggle?: (event: OpenTUIMouseEvent) => void;
}) {
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI pointer affordances live on text renderables.
		<box
			width="100%"
			height={1}
			backgroundColor={theme.panel}
			flexDirection="row"
			onMouseDown={onToggle}
		>
			<text flexShrink={0} fg={band ? theme.muted : theme.lineNumberFg} selectable={false}>
				{band ? "  ⋯" : "│"}
			</text>
			<text
				flexGrow={band ? 0 : 1}
				flexShrink={1}
				minWidth={0}
				fg={labelFg}
				wrapMode="none"
				truncate
				selectable={false}
			>
				{band ? `  ${label}` : ` ${label}`}
			</text>
			<text flexShrink={0} fg={theme.accent} selectable={false}>
				{band ? `  [${action}]` : `[${action}] `}
			</text>
		</box>
	);
}

/**
 * A figure a chapter draws. It borrows the excerpt's chrome and fold, but cites no file: the
 * gutter is blank rather than numbered. Mermaid the engine could not draw renders in `muted`,
 * because what is on the page is then source text rather than a picture.
 */
export function DiagramBlock({
	plan,
	theme,
	window: rowWindow,
	onToggle,
}: {
	plan: DiagramVisualPlan;
	theme: Theme;
	window?: { start: number; end: number };
	onToggle?: (key: string) => void;
}) {
	const start = Math.max(0, Math.min(plan.rows.length, rowWindow?.start ?? 0));
	const end = Math.max(start, Math.min(plan.rows.length, rowWindow?.end ?? plan.rows.length));
	const toggle = onToggle
		? (event: OpenTUIMouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				onToggle(plan.key);
			}
		: undefined;
	const bodyFg = plan.drawn ? theme.text : theme.muted;
	const blankGutter = " ".repeat(Math.max(0, plan.gutterColumns - 1));
	return (
		<box width="100%" flexDirection="column">
			{plan.rows.slice(start, end).map((row) => {
				if (row.type === "diagram-band" || row.type === "diagram-header") {
					return (
						<BlockBand
							key={row.key}
							band={row.type === "diagram-band"}
							label={row.label}
							action={row.action}
							labelFg={theme.muted}
							theme={theme}
							onToggle={toggle}
						/>
					);
				}
				return (
					<box key={row.key} width="100%" flexDirection="column">
						{row.visualRows.map(({ continuationIndex, spans }) => (
							<box
								key={continuationIndex}
								width="100%"
								height={1}
								overflow="hidden"
								backgroundColor={theme.contextBg}
								flexDirection="row"
							>
								<text flexShrink={0} fg={theme.lineNumberFg} wrapMode="none" selectable={false}>
									{`│${blankGutter}`}
								</text>
								{/* A figure carries no syntax, so its spans are plain text under one colour. */}
								<text
									fg={bodyFg}
									selectionBg={theme.badgeModified}
									selectionFg={theme.panelAlt}
									wrapMode="none"
									flexShrink={0}
									selectable
								>
									{spans.map((span) => span.text).join("")}
								</text>
							</box>
						))}
					</box>
				);
			})}
		</box>
	);
}

/**
 * Quoted unchanged code a chapter cites. It reads as scenery: the rule replaces the focus
 * marker because an excerpt row never focuses, the deletions gutter stays blank because there
 * is no old side, the sign slot stays empty because nothing changed, and the body sits on the
 * unstyled page. Folded — the default — the whole block collapses to one expander band.
 */
export function ExcerptBlock({
	plan,
	theme,
	focused = false,
	window: rowWindow,
	inlineAttachments = EMPTY_ATTACHMENTS,
	onToggle,
	onAttachmentNode,
	selectedRange,
	onRangeSelect,
	onRangeContextMenu,
}: RangeSelectionInput & {
	plan: ExcerptVisualPlan;
	theme: Theme;
	/** The block, not a row: excerpt rows have no focus marker to carry it. */
	focused?: boolean;
	window?: { start: number; end: number };
	/** Threads anchored to quoted lines, kept apart from the diff's own attachment list. */
	inlineAttachments?: readonly DiffInlineAttachment[];
	onToggle?: (key: string) => void;
	onAttachmentNode?: (id: string, node: { height: number } | null) => void;
}) {
	const { chrome, digits } = plan;
	const excerptStops = useMemo<DiffSelectionStop[]>(
		() =>
			plan.rows.flatMap((row) =>
				row.type === "excerpt-line"
					? [
							{
								filePath: row.filePath,
								oldStart: 0,
								side: "additions",
								lineNumber: row.lineNumber,
							},
						]
					: [],
			),
		[plan],
	);
	const { displayedSelection, gutterHandlers, contextHandler, cancelActiveRange } =
		useRangeSelection({
			selectedRange,
			onRangeSelect,
			onRangeContextMenu,
			selectionStops: excerptStops,
		});
	const start = Math.max(0, Math.min(plan.rows.length, rowWindow?.start ?? 0));
	const end = Math.max(start, Math.min(plan.rows.length, rowWindow?.end ?? plan.rows.length));
	const toggle = onToggle
		? (event: OpenTUIMouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				onToggle(plan.key);
			}
		: undefined;
	const labelFg = focused ? theme.accent : theme.muted;
	const emptyGutter = " ".repeat(chrome.focusMarker - 1 + digits + chrome.attachmentMarker);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the block clears gutter drags that end off a quoted line.
		<box
			width="100%"
			flexDirection="column"
			onMouseUp={cancelActiveRange}
			onMouseDragEnd={cancelActiveRange}
		>
			{plan.rows.slice(start, end).map((row) => {
				if (row.type === "excerpt-caption") {
					return (
						<box key={row.key} width="100%" flexDirection="column">
							{row.lines.map((line, index) => (
								<text
									// biome-ignore lint/suspicious/noArrayIndexKey: wrapped caption rows have no identity beyond position.
									key={`${index}:${line}`}
									fg={theme.muted}
									wrapMode="none"
									truncate
									selectable={false}
								>
									{line}
								</text>
							))}
						</box>
					);
				}
				if (row.type === "excerpt-band" || row.type === "excerpt-header") {
					return (
						<BlockBand
							key={row.key}
							band={row.type === "excerpt-band"}
							label={row.label}
							action={row.action}
							labelFg={labelFg}
							theme={theme}
							onToggle={toggle}
						/>
					);
				}
				const range = excerptLineRange(row);
				const selected = Boolean(
					displayedSelection && selectionContains(displayedSelection, stopForRange(range)),
				);
				const attachments = attachmentsForExcerptLine({
					filePath: row.filePath,
					lineNumber: row.lineNumber,
					attachments: inlineAttachments,
				});
				return (
					<box key={row.key} width="100%" flexDirection="column">
						{row.visualRows.map(({ continuationIndex, spans }) => (
							// biome-ignore lint/a11y/noStaticElementInteractions: a right click anywhere on the line acts on that line.
							<box
								key={continuationIndex}
								width="100%"
								height={1}
								overflow="hidden"
								backgroundColor={selected ? theme.selectedHunk : theme.contextBg}
								flexDirection="row"
								onMouseDown={contextHandler(range)}
							>
								<text flexShrink={0} fg={theme.lineNumberFg} wrapMode="none" selectable={false}>
									{`│${emptyGutter}`}
								</text>
								<text
									flexShrink={0}
									fg={theme.lineNumberFg}
									wrapMode="none"
									selectable={false}
									{...(continuationIndex === 0 ? gutterHandlers(range) : undefined)}
								>
									{" ".repeat(chrome.focusMarker)}
									{continuationIndex === 0
										? lineNumber(row.lineNumber, digits)
										: lineNumber(undefined, digits)}
									{attachmentMarker(continuationIndex === 0 ? attachments.length : 0)}
								</text>
								<text flexShrink={0} fg={theme.text} wrapMode="none" selectable={false}>
									{" ".repeat(chrome.sign)}
								</text>
								<text
									id={diffLineId(range)}
									fg={theme.text}
									selectionBg={theme.badgeModified}
									selectionFg={theme.panelAlt}
									wrapMode="none"
									flexShrink={0}
									selectable
								>
									<CellContent spans={spans} theme={theme} />
								</text>
							</box>
						))}
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
