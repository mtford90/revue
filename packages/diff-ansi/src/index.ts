import {
	type DiffChromeWidths,
	type DiffFile,
	type DiffLayout,
	type DiffPlanStyles,
	type PaintedVisualCell,
	paintDiff,
	planDiff,
	sanitizeTerminalLine,
} from "@revue/diff";
import type { Theme } from "@revue/theme";

/** Chrome emitted by this linear adapter. Gutters reserve a trailing separator space. */
export const ANSI_DIFF_CHROME: DiffChromeWidths = {
	focusMarker: 0,
	attachmentMarker: 1,
	sign: 2,
	edge: 1,
	divider: 1,
	minimumCode: 8,
};

export const ansiDiffPlanStyles = (theme: Theme): DiffPlanStyles => ({
	text: theme.text,
	contextBackground: theme.contextBg,
	additionBackground: theme.addedBg,
	deletionBackground: theme.removedBg,
	additionFocusedBackground: theme.addedContentBg,
	deletionFocusedBackground: theme.removedContentBg,
	selectedHunkBackground: theme.selectedHunk,
	intralineAdditionBackground: theme.addedEmphasisBg,
	intralineDeletionBackground: theme.removedEmphasisBg,
});

const reset = "\x1b[0m";
const sgr = ({
	fg,
	bg,
	bold,
	dim,
}: {
	fg?: string;
	bg?: string;
	bold?: boolean;
	dim?: boolean;
}) => {
	const codes: string[] = [];
	const rgb = (colour: string, prefix: number) => {
		const normalized = colour.replace("#", "");
		if (!/^[\da-f]{6}$/i.test(normalized)) return;
		codes.push(
			`${prefix};2;${Number.parseInt(normalized.slice(0, 2), 16)};${Number.parseInt(normalized.slice(2, 4), 16)};${Number.parseInt(normalized.slice(4, 6), 16)}`,
		);
	};
	if (bold) codes.push("1");
	if (dim) codes.push("2");
	if (fg) rgb(fg, 38);
	if (bg && bg !== "transparent") rgb(bg, 48);
	return codes.length ? `\x1b[${codes.join(";")}m` : "";
};

const widthOf = (text: string) => Bun.stringWidth(text);
const truncate = (text: string, columns: number) => {
	let result = "";
	let used = 0;
	for (const character of text) {
		const characterWidth = widthOf(character);
		if (used + characterWidth > columns) break;
		result += character;
		used += characterWidth;
	}
	return result;
};
const pad = (text: string, columns: number) => {
	const clipped = truncate(text, columns);
	return `${clipped}${" ".repeat(Math.max(0, columns - widthOf(clipped)))}`;
};
const fitStyled = (text: string, columns: number) => {
	let result = "";
	let used = 0;
	for (let index = 0; index < text.length; ) {
		// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI SGR parsing is intentional.
		const control = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(text.slice(index));
		if (control) {
			result += control[0];
			index += control[0].length;
			continue;
		}
		const character = String.fromCodePoint(text.codePointAt(index) ?? 0);
		const characterWidth = widthOf(character);
		if (used + characterWidth > columns) break;
		result += character;
		used += characterWidth;
		index += character.length;
	}
	return `${result}${reset}`;
};
const number = (value: number | undefined, digits: number) =>
	value === undefined ? " ".repeat(digits) : String(value).padStart(digits);

const cellText = (
	cell: PaintedVisualCell,
	width: number,
	digits: number,
	gutterSides: readonly ("deletions" | "additions")[],
) => {
	const prefix = `${gutterSides
		.map((side) => number(cell.gutters?.[side]?.lineNumber, digits))
		.join(" ")}  ${cell.changeSign} `;
	const spans = cell.spans
		.map(
			(span) =>
				`${sgr({ ...span, bg: span.bg ?? cell.backgroundColor })}${sanitizeTerminalLine(span.text)}`,
		)
		.join("");
	// Fill with the cell background so semantic tints cover the entire planned pane.
	const used = widthOf(prefix) + cell.spans.reduce((total, span) => total + widthOf(span.text), 0);
	return fitStyled(
		`${sgr({ bg: cell.backgroundColor })}${prefix}${spans}${" ".repeat(Math.max(0, width - used))}`,
		width,
	);
};

const header = (file: DiffFile, theme: Theme, width: number) => {
	const path =
		file.previousPath && file.previousPath !== file.path
			? `${file.previousPath} -> ${file.path}`
			: file.path;
	const stats = `+${file.stats.additions} -${file.stats.deletions}`;
	const line = `${path}  ${stats}`;
	return `${sgr({ fg: theme.heading, bold: true })}${pad(line, width)}${reset}\n`;
};

const metadataMessage = (file: DiffFile) => {
	if (file.isTooLarge) return "Diff too large to display.";
	if (file.isBinary) return "Binary file differs.";
	if (file.metadata.type === "rename-pure") return "Renamed without changes.";
	if (file.metadata.type === "new") return "New empty file.";
	if (file.metadata.type === "deleted") return "Deleted file.";
	if (file.metadata.prevMode || file.metadata.mode) {
		return `Mode ${file.metadata.prevMode ?? "(none)"} -> ${file.metadata.mode ?? "(none)"}.`;
	}
	return "No text changes.";
};

/** Format one complete parsed file envelope. Every line resets before its newline. */
export function formatAnsiDiffFile({
	file,
	layout,
	width,
	theme,
}: {
	file: DiffFile;
	layout: DiffLayout;
	width: number;
	theme: Theme;
}): string {
	const safeWidth = Math.max(1, width);
	let output = header(file, theme, safeWidth);
	if (file.isTooLarge || file.isBinary || !file.metadata.hunks.length) {
		output += `${sgr({ fg: theme.muted })}${pad(metadataMessage(file), safeWidth)}${reset}\n`;
		return output;
	}
	const plan = planDiff({
		file,
		layout,
		width: safeWidth,
		visibility: { lineNumbers: true, hunkHeaders: true },
		chrome: ANSI_DIFF_CHROME,
		syntaxTheme: theme.syntaxTheme,
	});
	const painted = paintDiff({ plan, styles: ansiDiffPlanStyles(theme) });
	for (const row of painted.rows) {
		if (row.type === "hunk-header") {
			if (row.height)
				output += `${sgr({ fg: theme.accent, bold: true })}${pad(row.text, safeWidth)}${reset}\n`;
			continue;
		}
		if (row.type === "stack-line") {
			for (const visual of row.visualRows)
				output += `${cellText(visual.cell, safeWidth, plan.digits, plan.stackGutterSides)}\n`;
			continue;
		}
		for (const visual of row.visualRows) {
			const oldText = cellText(visual.old, plan.paneWidths.old, plan.digits, ["deletions"]);
			const newText = cellText(visual.new, plan.paneWidths.new, plan.digits, ["additions"]);
			output += `${oldText}${sgr({ fg: theme.border })}│${newText}${reset}\n`;
		}
	}
	return output;
}
