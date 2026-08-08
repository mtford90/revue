import { type MouseEvent as OpenTUIMouseEvent, TextAttributes } from "@opentui/core";
import {
	anchorRowIndex,
	createDiffFile,
	type DiagramVisualPlan,
	type DiffFile,
	type DiffFileInput,
	type DiffLayout,
	type DiffLineRange,
	type DiffSide,
	type DiffVisualPlan,
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
	type SpanEmphasis,
	sanitizeTerminalLine,
} from "@revue/diff";
import type { Theme } from "@revue/theme";
import { useMemo, useRef, useState } from "react";
import {
	attachmentsForExcerptLine,
	attachmentsForRow,
	type DiffInlineAttachment,
} from "./attachments.ts";
import { decorationAnchorId } from "./ids.ts";
import { diffLineId } from "./selectionIds.ts";
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

type GutterHandlers = {
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
	onRangeSelect?: (range: DiffLineRange) => void;
	onRangeContextMenu?: (range: DiffLineRange, position: { x: number; y: number }) => void;
};

/**
 * Gutter-drag range selection, shared by diff bodies and excerpt blocks so a quoted line
 * answers the pointer exactly as a reviewable one does.
 */
const useRangeSelection = ({
	selectedRange,
	onRangeSelect,
	onRangeContextMenu,
}: RangeSelectionInput) => {
	const activeStart = useRef<DiffLineRange | null>(null);
	const activeRange = useRef<DiffLineRange | null>(null);
	const [dragRange, setDragRange] = useState<DiffLineRange | null>(null);
	const displayedRange = dragRange ?? selectedRange;
	const updateRange = (target: DiffLineRange) => {
		const start = activeStart.current;
		if (
			!start ||
			start.filePath !== target.filePath ||
			start.hunkOldStart !== target.hunkOldStart ||
			start.side !== target.side
		)
			return;
		const next = {
			...start,
			startLine: Math.min(start.startLine, target.startLine),
			endLine: Math.max(start.endLine, target.endLine),
		};
		activeRange.current = next;
		setDragRange(next);
	};
	const finishRange = () => {
		if (!activeStart.current) return;
		const completed = activeRange.current;
		activeStart.current = null;
		activeRange.current = null;
		setDragRange(null);
		if (completed) onRangeSelect?.(completed);
	};
	const cancelActiveRange = () => {
		activeStart.current = null;
		activeRange.current = null;
		setDragRange(null);
	};
	/** A right click inside the live selection acts on all of it, not just the row beneath. */
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
	return { displayedRange, gutterHandlers, contextHandler, cancelActiveRange };
};

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
	inlineAttachments?: readonly DiffInlineAttachment[];
	emphasis?: SpanEmphasis;
	resolveRange?: (side: DiffSide, lineNumber: number) => DiffLineRange | null;
	expanders?: {
		actionsFor: (boundary: number) => readonly ExpandDirection[];
		onExpand: (boundary: number, action: ExpandDirection) => void;
	};
	window?: { start: number; end: number };
	onAttachmentNode?: (id: string, node: { height: number } | null) => void;
	onRangeSelect?: (range: DiffLineRange) => void;
	onRangeContextMenu?: (range: DiffLineRange, position: { x: number; y: number }) => void;
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
		inlineAttachments = EMPTY_ATTACHMENTS,
		emphasis,
		resolveRange,
		expanders,
		window: rowWindow,
		onAttachmentNode,
		onRangeSelect,
		onRangeContextMenu,
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
	const { displayedRange, gutterHandlers, contextHandler, cancelActiveRange } = useRangeSelection({
		selectedRange,
		onRangeSelect,
		onRangeContextMenu,
	});
	const selectionDecoration = useMemo<RangeDecoration | null>(
		() =>
			displayedRange
				? {
						...displayedRange,
						id: "diff-pointer-selection",
						active: true,
						backgroundColor: theme.selectedHunk,
					}
				: null,
		[displayedRange, theme.selectedHunk],
	);
	const renderedDecorations = useMemo(
		() => (selectionDecoration ? [selectionDecoration, ...decorations] : decorations),
		[selectionDecoration, decorations],
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
				emphasis,
				selectedHunkIndex,
			}),
		[
			geometry,
			styles,
			rowWindow,
			renderedDecorations,
			focusedDecorationId,
			emphasis,
			selectedHunkIndex,
		],
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
	const { displayedRange, gutterHandlers, contextHandler, cancelActiveRange } = useRangeSelection({
		selectedRange,
		onRangeSelect,
		onRangeContextMenu,
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
					displayedRange &&
						displayedRange.filePath === range.filePath &&
						displayedRange.side === range.side &&
						displayedRange.startLine <= range.startLine &&
						range.endLine <= displayedRange.endLine,
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
									{...gutterHandlers(range)}
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
