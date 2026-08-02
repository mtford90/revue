import type { MouseEvent as OpenTUIMouseEvent } from "@opentui/core";
import { createDiffFile } from "@revue/diff-model";
import { useMemo, useRef, useState } from "react";
import { decorationAnchorId, findFocusedDecorationAnchor } from "./decorations.ts";
import { buildDiffRows } from "./rows.ts";
import { sanitizeTerminalLine } from "./terminalText.ts";
import type {
	DecorationAnchor,
	DiffCell,
	DiffFile,
	DiffFileInput,
	DiffInlineAttachment,
	DiffLayout,
	DiffLineRange,
	DiffRow,
	DiffSide,
	RangeDecoration,
} from "./types.ts";

const palette = {
	text: "#cdd6f4",
	dim: "#6c7086",
	panel: "#181825",
	addition: "#1e3a2b",
	deletion: "#452733",
	focusAddition: "#315b42",
	focusDeletion: "#6a3547",
	selected: "#313244",
	green: "#a6e3a1",
	red: "#f38ba8",
	accent: "#89b4fa",
} as const;

const lineNumber = (value: number | undefined, digits: number) =>
	value === undefined ? " ".repeat(digits) : String(value).padStart(digits);

function CellContent({ cell }: { cell: DiffCell }) {
	return (
		<>
			{cell.spans.map((span, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: immutable syntax spans have no independent identity.
				<span key={`${index}:${span.text}`} fg={span.fg ?? palette.text}>
					{span.text}
				</span>
			))}
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
}: {
	focused: boolean;
	number: number | undefined;
	digits: number;
	showLineNumbers: boolean;
	attachmentCount: number;
	handlers?: GutterHandlers;
}) {
	return (
		<text
			fg={focused ? palette.accent : palette.dim}
			wrapMode="none"
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
}: {
	cell: DiffCell;
	side: DiffSide;
	digits: number;
	showLineNumbers: boolean;
	width: number;
	attachmentCount: number;
	handlers?: GutterHandlers;
}) {
	const focused = cell.focusedSides.includes(side);
	const number = side === "deletions" ? cell.oldLineNumber : cell.newLineNumber;
	const sign = cell.kind === "addition" ? "+" : cell.kind === "deletion" ? "-" : " ";
	const backgroundColor = focused
		? side === "additions"
			? palette.focusAddition
			: palette.focusDeletion
		: cell.kind === "addition"
			? palette.addition
			: cell.kind === "deletion"
				? palette.deletion
				: undefined;
	return (
		<box
			width={width}
			flexShrink={0}
			height={1}
			overflow="hidden"
			backgroundColor={backgroundColor}
			flexDirection="row"
		>
			<Gutter
				focused={focused}
				number={number}
				digits={digits}
				showLineNumbers={showLineNumbers}
				attachmentCount={attachmentCount}
				handlers={number === undefined ? undefined : handlers}
			/>
			<text fg={palette.text} wrapMode="none" selectable>
				{sign} <CellContent cell={cell} />
			</text>
		</box>
	);
}

function StackCell({
	cell,
	digits,
	showLineNumbers,
	attachmentCounts,
	interactions,
}: {
	cell: DiffCell;
	digits: number;
	showLineNumbers: boolean;
	attachmentCounts: AttachmentCounts;
	interactions: CellInteractions;
}) {
	const oldFocused = cell.focusedSides.includes("deletions");
	const newFocused = cell.focusedSides.includes("additions");
	const sign = cell.kind === "addition" ? "+" : cell.kind === "deletion" ? "-" : " ";
	const backgroundColor = oldFocused
		? palette.focusDeletion
		: newFocused
			? palette.focusAddition
			: cell.kind === "addition"
				? palette.addition
				: cell.kind === "deletion"
					? palette.deletion
					: undefined;
	return (
		<box
			width="100%"
			height={1}
			overflow="hidden"
			backgroundColor={backgroundColor}
			flexDirection="row"
		>
			<Gutter
				focused={oldFocused}
				number={cell.oldLineNumber}
				digits={digits}
				showLineNumbers={showLineNumbers}
				attachmentCount={attachmentCounts.deletions ?? 0}
				handlers={cell.oldLineNumber === undefined ? undefined : interactions.deletions}
			/>
			<Gutter
				focused={newFocused}
				number={cell.newLineNumber}
				digits={digits}
				showLineNumbers={showLineNumbers}
				attachmentCount={attachmentCounts.additions ?? 0}
				handlers={cell.newLineNumber === undefined ? undefined : interactions.additions}
			/>
			<text fg={palette.text} wrapMode="none" selectable>
				{sign} <CellContent cell={cell} />
			</text>
		</box>
	);
}

export interface DiffBodyProps {
	file?: DiffFileInput;
	layout?: DiffLayout;
	width: number;
	showLineNumbers?: boolean;
	showHunkHeaders?: boolean;
	selectedHunkIndex?: number;
	decorations?: readonly RangeDecoration[];
	/** A decoration id or shared focusId; all matching ranges receive focus styling. */
	focusedDecorationId?: string;
	selectedRange?: DiffLineRange;
	inlineAttachments?: readonly DiffInlineAttachment[];
	onRangeSelect?: (range: DiffLineRange) => void;
}

function rowHasAnchor(row: DiffRow, anchor: DecorationAnchor): boolean {
	if (row.type === "hunk-header" || row.hunkIndex !== anchor.hunkIndex) return false;
	if (row.type === "split-line") {
		return anchor.side === "deletions"
			? row.old.oldLineNumber === anchor.lineNumber
			: row.new.newLineNumber === anchor.lineNumber;
	}
	return anchor.side === "deletions"
		? row.cell.oldLineNumber === anchor.lineNumber
		: row.cell.newLineNumber === anchor.lineNumber;
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
	showLineNumbers = true,
	showHunkHeaders = true,
	selectedHunkIndex = 0,
	decorations = [],
	focusedDecorationId,
	selectedRange,
	inlineAttachments = [],
	onRangeSelect,
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
			normalized ? buildDiffRows(normalized, layout, renderedDecorations, renderedFocusId) : [],
		[normalized, layout, renderedDecorations, renderedFocusId],
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
	const splitContentWidth = Math.max(0, width - 1);
	const oldPaneWidth = Math.floor(splitContentWidth / 2);
	const newPaneWidth = splitContentWidth - oldPaneWidth;

	const lineRange = (row: DiffRow, side: DiffSide): DiffLineRange | null => {
		if (!normalized || row.type === "hunk-header") return null;
		const cell = row.type === "split-line" ? (side === "deletions" ? row.old : row.new) : row.cell;
		const number = side === "deletions" ? cell.oldLineNumber : cell.newLineNumber;
		const hunk = normalized.metadata.hunks[row.hunkIndex];
		if (number === undefined || !hunk) return null;
		return {
			filePath: normalized.path,
			hunkOldStart: hunk.deletionStart,
			side,
			startLine: number,
			endLine: number,
		};
	};
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
	const gutterHandlers = (target: DiffLineRange | null): GutterHandlers | undefined =>
		target && onRangeSelect
			? {
					onMouseDown: (event) => {
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
	const rowAttachments = (row: DiffRow): DiffInlineAttachment[] => {
		if (!normalized || row.type === "hunk-header") return [];
		const hunk = normalized.metadata.hunks[row.hunkIndex];
		if (!hunk) return [];
		return inlineAttachments.filter((attachment) => {
			if (
				attachment.anchor.filePath !== normalized.path ||
				attachment.anchor.hunkOldStart !== hunk.deletionStart
			) {
				return false;
			}
			const range = lineRange(row, attachment.anchor.side);
			return range?.endLine === attachment.anchor.endLine;
		});
	};
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

	if (!normalized) return <text fg={palette.dim}>No file selected.</text>;
	if (normalized.isTooLarge || normalized.isBinary || !normalized.metadata.hunks.length) {
		return <text fg={palette.dim}>{emptyBodyMessage(normalized)}</text>;
	}

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the body clears incomplete gutter drags outside a selectable line.
		<box
			width={width}
			flexDirection="column"
			onMouseUp={cancelActiveRange}
			onMouseDragEnd={cancelActiveRange}
		>
			{rows.map((row) => {
				if (row.type === "hunk-header") {
					return showHunkHeaders ? (
						<box key={row.key} width="100%" height={1} backgroundColor={palette.panel}>
							<text fg={palette.accent} wrapMode="none" truncate>
								{row.hunkIndex === selectedHunkIndex ? "▎" : " "}{" "}
								{sanitizeTerminalLine(row.text).replaceAll("\t", "  ")}
							</text>
						</box>
					) : null;
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
								backgroundColor={selected ? palette.selected : undefined}
							>
								<SplitCell
									cell={row.old}
									side="deletions"
									digits={digits}
									showLineNumbers={showLineNumbers}
									width={oldPaneWidth}
									attachmentCount={counts.deletions ?? 0}
									handlers={gutterHandlers(lineRange(row, "deletions"))}
								/>
								<text fg={palette.dim}>│</text>
								<SplitCell
									cell={row.new}
									side="additions"
									digits={digits}
									showLineNumbers={showLineNumbers}
									width={newPaneWidth}
									attachmentCount={counts.additions ?? 0}
									handlers={gutterHandlers(lineRange(row, "additions"))}
								/>
							</box>
							{attachments.map((attachment) => (
								<box key={attachment.id} width="100%" flexDirection="column">
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
							backgroundColor={selected ? palette.selected : undefined}
						>
							<StackCell
								cell={row.cell}
								digits={digits}
								showLineNumbers={showLineNumbers}
								attachmentCounts={counts}
								interactions={{
									deletions: gutterHandlers(lineRange(row, "deletions")),
									additions: gutterHandlers(lineRange(row, "additions")),
								}}
							/>
						</box>
						{attachments.map((attachment) => (
							<box key={attachment.id} width="100%" flexDirection="column">
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
	onSelect?: () => void;
}

/** Compact path and stats row used inside Revue's existing collapse shell. */
export function DiffFileHeader({ file, width, onSelect }: DiffFileHeaderProps) {
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
			backgroundColor={palette.panel}
			onMouseUp={onSelect}
		>
			<text fg={palette.text} wrapMode="none" truncate>
				{sanitizeTerminalLine(path).replaceAll("\t", "  ")}
				<span fg={palette.dim}>{state}</span>
			</text>
			<text wrapMode="none">
				<span fg={palette.green}>+{normalized.stats.additions}</span>
				<span fg={palette.dim}> </span>
				<span fg={palette.red}>-{normalized.stats.deletions}</span>
				<span> </span>
			</text>
		</box>
	);
}
