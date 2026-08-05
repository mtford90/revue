import type { CapturedFrame, CapturedSpan } from "@opentui/core";

/** Base text attributes OpenTUI packs into a cell's attribute bits. */
const ATTRIBUTE_NAMES: readonly [number, string][] = [
	[1, "bold"],
	[2, "dim"],
	[4, "italic"],
	[8, "underline"],
	[16, "blink"],
	[32, "inverse"],
	[64, "hidden"],
	[128, "strikethrough"],
];

const hex = (channel: number) => channel.toString(16).padStart(2, "0");

const colourHex = (colour: { toInts: () => [number, number, number, number] }): string => {
	const [r, g, b, a] = colour.toInts();
	return a === 255 ? `#${hex(r)}${hex(g)}${hex(b)}` : `#${hex(r)}${hex(g)}${hex(b)}${hex(a)}`;
};

const attributeNames = (attributes: number): string =>
	ATTRIBUTE_NAMES.filter(([bit]) => (attributes & bit) !== 0)
		.map(([, name]) => name)
		.join("+");

type StyleRun = { start: number; width: number; fg: string; bg: string; attributes: string };

const styleKey = (run: StyleRun) => `${run.fg}|${run.bg}|${run.attributes}`;

const runFromSpan = (span: CapturedSpan, start: number): StyleRun => ({
	start,
	width: span.width,
	fg: colourHex(span.fg),
	bg: colourHex(span.bg),
	attributes: attributeNames(span.attributes),
});

const joins = (previous: StyleRun, run: StyleRun): boolean =>
	styleKey(previous) === styleKey(run) && previous.start + previous.width === run.start;

/** Adjacent spans sharing a style become one run, so the map reads as painted regions. */
const lineRuns = (spans: readonly CapturedSpan[]): StyleRun[] => {
	const runs: StyleRun[] = [];
	let column = 0;
	for (const span of spans) {
		const run = runFromSpan(span, column);
		const previous = runs.at(-1);
		if (previous && joins(previous, run)) previous.width += run.width;
		else runs.push(run);
		column += span.width;
	}
	return runs;
};

const runLabel = (run: StyleRun): string => {
	const columns = run.width === 1 ? `${run.start}` : `${run.start}-${run.start + run.width - 1}`;
	const attributes = run.attributes ? ` ${run.attributes}` : "";
	return `${columns} fg=${run.fg} bg=${run.bg}${attributes}`;
};

const rowLabel = (index: number, rows: number) =>
	String(index).padStart(String(rows - 1).length, "0");

/**
 * A rendered frame as reviewable text: the character grid, then a per-row map of
 * the styles painted across it. Trailing spaces are trimmed from the grid because
 * the style map already records how far each background reaches.
 */
export const serialiseFrame = (frame: CapturedFrame, title: string): string => {
	const rows = frame.lines.length;
	const grid = frame.lines.map((line, index) => {
		const text = line.spans
			.map((span) => span.text)
			.join("")
			.replace(/\s+$/, "");
		return `${rowLabel(index, rows)} |${text}`;
	});
	const styles = frame.lines.flatMap((line, index) => {
		const runs = lineRuns(line.spans);
		if (runs.length === 0) return [];
		return [`${rowLabel(index, rows)}: ${runs.map(runLabel).join("  ")}`];
	});
	return [
		`# ${title}`,
		`# grid ${frame.cols}x${rows} (trailing spaces trimmed; styles below carry the full row)`,
		"# style columns are terminal columns, so a wide glyph spans two of them",
		"",
		...grid,
		"",
		"# styles: row: cols fg bg [attributes]",
		"",
		...styles,
		"",
	].join("\n");
};
