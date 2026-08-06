import { type MouseEvent as OpenTUIMouseEvent, TextAttributes } from "@opentui/core";
import {
	createDiffFile,
	type DiffFile,
	type DiffFileInput,
	type DiffLayout,
	type DiffLineRange,
	type DiffSide,
	findFocusedDecorationAnchor,
	type PlannedDiffRow,
	type PlannedSplitLineRow,
	type PlannedStackLineRow,
	type PlannedVisualCell,
	planDiff,
	type RangeDecoration,
	type RenderSpan,
	rowHasAnchor,
	type SpanEmphasis,
	sanitizeTerminalLine,
} from "@revue/diff";
import type { Theme } from "@revue/theme";
import { useMemo, useRef, useState } from "react";
import { attachmentsForRow, type DiffInlineAttachment } from "./attachments.ts";
import { decorationAnchorId } from "./ids.ts";
import { diffLineId } from "./selectionIds.ts";
import { diffPlanStyles, OPENTUI_DIFF_CHROME } from "./styles.ts";

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

function LineContent({
	cell,
	lineId,
	theme,
}: {
	cell: PlannedVisualCell;
	lineId?: string;
	theme: Theme;
}) {
	return (
		<>
			<text fg={theme.text} wrapMode="none" flexShrink={0} selectable={false}>
				{` ${cell.changeSign} `}
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
	cell: PlannedVisualCell;
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
			<Gutter
				focused={gutter?.focused ?? false}
				number={gutter?.lineNumber}
				digits={digits}
				showLineNumbers={showLineNumbers}
				attachmentCount={gutter ? attachmentCount : 0}
				handlers={gutter?.lineNumber === undefined ? undefined : handlers}
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
	cell: PlannedVisualCell;
	digits: number;
	showLineNumbers: boolean;
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
			<LineContent cell={cell} lineId={lineId} theme={theme} />
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
	attachmentCounts,
	anchorId,
	theme,
}: LineRowProps & {
	row: PlannedSplitLineRow;
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
	attachmentCounts,
	anchorId,
	theme,
}: LineRowProps & {
	row: PlannedStackLineRow;
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
	const styles = useMemo(() => diffPlanStyles(theme), [theme]);
	const plan = useMemo(
		() =>
			normalized
				? planDiff({
						file: normalized,
						layout,
						width,
						visibility: { lineNumbers: showLineNumbers, hunkHeaders: showHunkHeaders },
						styles,
						chrome: OPENTUI_DIFF_CHROME,
						decorations: renderedDecorations,
						focusedDecorationId,
						emphasis,
						syntaxTheme: theme.syntaxTheme,
						selectedHunkIndex,
					})
				: undefined,
		[
			normalized,
			layout,
			width,
			showLineNumbers,
			showHunkHeaders,
			styles,
			renderedDecorations,
			focusedDecorationId,
			emphasis,
			theme.syntaxTheme,
			selectedHunkIndex,
		],
	);
	const anchor = useMemo(
		() =>
			normalized && focusedDecorationId
				? findFocusedDecorationAnchor(normalized, decorations, focusedDecorationId)
				: null,
		[normalized, decorations, focusedDecorationId],
	);
	const anchorRowKey =
		anchor && plan
			? plan.rows.find((row) => row.type !== "hunk-header" && rowHasAnchor(row.logical, anchor))
					?.key
			: undefined;
	const anchorId = anchor ? decorationAnchorId(anchor) : undefined;

	const rangeForIdentity = (
		identity: PlannedVisualCell["identities"][DiffSide],
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
	const updateRange = (target: DiffLineRange): DiffLineRange | null => {
		const start = activeStart.current;
		if (
			!start ||
			start.filePath !== target.filePath ||
			start.hunkOldStart !== target.hunkOldStart ||
			start.side !== target.side
		)
			return activeRange.current;
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
	const interaction = (cell: PlannedVisualCell, side: DiffSide): SideInteraction => {
		const range = rangeForIdentity(cell.identities[side]);
		return {
			handlers: gutterHandlers(range),
			lineId: range ? diffLineId(range) : undefined,
			onContextMenu: contextHandler(range),
		};
	};
	const rowAttachments = (row: Exclude<PlannedDiffRow, { type: "hunk-header" }>) =>
		normalized
			? attachmentsForRow({
					file: normalized,
					row: row.logical,
					attachments: inlineAttachments,
					resolveRange,
				})
			: [];
	const cancelActiveRange = () => {
		activeStart.current = null;
		activeRange.current = null;
		setDragRange(null);
	};

	if (!normalized || !plan) return <text fg={theme.muted}>No file selected.</text>;
	if (normalized.isTooLarge || normalized.isBinary || !normalized.metadata.hunks.length)
		return <text fg={theme.muted}>{emptyBodyMessage(normalized)}</text>;

	const visibleRows = rowWindow ? plan.rows.slice(rowWindow.start, rowWindow.end) : plan.rows;
	const windowReachesEnd = !rowWindow || rowWindow.end > plan.rows.length;
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
							panes={plan.paneWidths}
							deletions={interaction(firstCell, "deletions")}
							additions={interaction(secondCell, "additions")}
							digits={plan.digits}
							showLineNumbers={plan.visibility.lineNumbers}
							attachmentCounts={counts}
							anchorId={id}
							theme={theme}
						/>
					) : row.type === "stack-line" && firstCell ? (
						<StackLine
							row={row}
							sides={plan.stackGutterSides}
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
							digits={plan.digits}
							showLineNumbers={plan.visibility.lineNumbers}
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
