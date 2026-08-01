import { useMemo } from "react";
import { decorationAnchorId, findFocusedDecorationAnchor } from "./decorations.ts";
import { createDiffFile } from "./model.ts";
import { buildDiffRows } from "./rows.ts";
import { sanitizeTerminalLine } from "./terminalText.ts";
import type {
	DecorationAnchor,
	DiffCell,
	DiffFile,
	DiffFileInput,
	DiffLayout,
	DiffRow,
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

function SplitCell({
	cell,
	side,
	digits,
	showLineNumbers,
	width,
}: {
	cell: DiffCell;
	side: "additions" | "deletions";
	digits: number;
	showLineNumbers: boolean;
	width: number;
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
		>
			<text fg={focused ? palette.accent : palette.dim} wrapMode="none">
				{focused ? "▌" : " "}
				{showLineNumbers ? `${lineNumber(number, digits)} ` : ""}
				{sign} <CellContent cell={cell} />
			</text>
		</box>
	);
}

function StackCell({
	cell,
	digits,
	showLineNumbers,
}: {
	cell: DiffCell;
	digits: number;
	showLineNumbers: boolean;
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
		<box width="100%" height={1} overflow="hidden" backgroundColor={backgroundColor}>
			<text fg={palette.dim} wrapMode="none">
				<span fg={oldFocused ? palette.accent : palette.dim}>{oldFocused ? "▌" : " "}</span>
				{showLineNumbers ? lineNumber(cell.oldLineNumber, digits) : ""}
				<span fg={newFocused ? palette.accent : palette.dim}>{newFocused ? "▌" : " "}</span>
				{showLineNumbers ? `${lineNumber(cell.newLineNumber, digits)} ` : ""}
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
}: DiffBodyProps) {
	const normalized = useMemo(() => (file ? createDiffFile(file) : undefined), [file]);
	const rows = useMemo(
		() => (normalized ? buildDiffRows(normalized, layout, decorations, focusedDecorationId) : []),
		[normalized, layout, decorations, focusedDecorationId],
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

	if (!normalized) return <text fg={palette.dim}>No file selected.</text>;
	if (normalized.isTooLarge || normalized.isBinary || !normalized.metadata.hunks.length) {
		return <text fg={palette.dim}>{emptyBodyMessage(normalized)}</text>;
	}

	return (
		<box width={width} flexDirection="column">
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
				if (row.type === "split-line") {
					return (
						<box
							id={id}
							key={row.key}
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
							/>
							<text fg={palette.dim}>│</text>
							<SplitCell
								cell={row.new}
								side="additions"
								digits={digits}
								showLineNumbers={showLineNumbers}
								width={newPaneWidth}
							/>
						</box>
					);
				}
				return (
					<box
						id={id}
						key={row.key}
						width="100%"
						height={1}
						backgroundColor={selected ? palette.selected : undefined}
					>
						<StackCell cell={row.cell} digits={digits} showLineNumbers={showLineNumbers} />
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
