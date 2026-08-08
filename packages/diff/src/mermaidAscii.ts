// Layered box-and-arrow drawing for a parsed flowchart. Nodes rank by longest path, layers stack
// top to bottom whatever direction the source declared — columns are the scarce axis in a
// terminal, rows are not — and every link routes through a channel row of its own so two links
// never share one. Anything that will not lay out returns null and the caller shows the source.

import type { MermaidEdge, MermaidFlowchart } from "./mermaid.ts";
import { parseMermaidFlowchart } from "./mermaid.ts";
import { plainTerminalLine } from "./terminalText.ts";
import { columnWidth } from "./wrap.ts";

/** Blank columns between two boxes in the same layer. */
const HORIZONTAL_GAP = 2;
/** Border, label, border. */
const BOX_HEIGHT = 3;

type Cell = { kind: "node" | "dummy"; label: string; width: number; x: number };
type Layer = Cell[];
type Segment = { from: Cell; to: Cell; label: string | null; arrow: boolean };
/** Layers top to bottom, and the links crossing the gap below each layer but the last. */
type Graph = { layers: Layer[]; bands: Segment[][] };

const connectorColumn = (cell: Cell): number => cell.x + Math.floor((cell.width - 1) / 2);

const outgoing = (chart: MermaidFlowchart): Map<string, MermaidEdge[]> => {
	const edges = new Map<string, MermaidEdge[]>();
	for (const edge of chart.edges) edges.set(edge.from, [...(edges.get(edge.from) ?? []), edge]);
	return edges;
};

/**
 * Longest-path ranks by Kahn's algorithm. A cycle leaves nodes unranked, and returning null for
 * one is deliberate: a back edge has nowhere to go in a layered drawing.
 */
const rankNodes = (chart: MermaidFlowchart): Map<string, number> | null => {
	const edges = outgoing(chart);
	const ranks = new Map(chart.nodes.map((node) => [node.id, 0]));
	const remaining = new Map(chart.nodes.map((node) => [node.id, 0]));
	for (const edge of chart.edges) remaining.set(edge.to, (remaining.get(edge.to) ?? 0) + 1);
	const settled = chart.nodes.filter((node) => remaining.get(node.id) === 0).map((node) => node.id);
	// The array iterator picks up the pushes below, so this walks the graph as ranks settle.
	for (const id of settled) {
		for (const edge of edges.get(id) ?? []) {
			ranks.set(edge.to, Math.max(ranks.get(edge.to) ?? 0, (ranks.get(id) ?? 0) + 1));
			const left = (remaining.get(edge.to) ?? 0) - 1;
			remaining.set(edge.to, left);
			if (left === 0) settled.push(edge.to);
		}
	}
	return settled.length === chart.nodes.length ? ranks : null;
};

const nodeCell = (label: string): Cell => {
	const text = plainTerminalLine(label);
	return { kind: "node", label: text, width: columnWidth(text) + 4, x: 0 };
};

const dummyCell = (): Cell => ({ kind: "dummy", label: "", width: 1, x: 0 });

/**
 * A link spanning more than one layer is cut into one segment per gap, passing through a
 * placeholder cell in each layer between, so nothing is ever drawn across a box.
 */
const routeEdge = (
	edge: MermaidEdge,
	from: Cell,
	to: Cell,
	ranks: { from: number; to: number },
	graph: Graph,
): void => {
	const label = edge.label === null ? null : plainTerminalLine(edge.label);
	const last = ranks.to - 1;
	const start = ranks.from;
	const through = Array.from({ length: last - start }, (_, step) => {
		const cell = dummyCell();
		graph.layers[start + step + 1]?.push(cell);
		return cell;
	});
	const cells = [from, ...through, to];
	for (const [step, source] of cells.slice(0, -1).entries()) {
		const target = cells[step + 1];
		if (!target) return;
		graph.bands[start + step]?.push({
			from: source,
			to: target,
			label: step === 0 ? label : null,
			arrow: edge.arrow && target === to,
		});
	}
};

const buildGraph = (chart: MermaidFlowchart, ranks: Map<string, number>): Graph => {
	const depth = Math.max(...ranks.values()) + 1;
	const graph: Graph = {
		layers: Array.from({ length: depth }, (): Layer => []),
		bands: Array.from({ length: Math.max(0, depth - 1) }, (): Segment[] => []),
	};
	const cells = new Map<string, Cell>();
	for (const node of chart.nodes) {
		const cell = nodeCell(node.label);
		cells.set(node.id, cell);
		graph.layers[ranks.get(node.id) ?? 0]?.push(cell);
	}
	for (const edge of chart.edges) {
		const from = cells.get(edge.from);
		const to = cells.get(edge.to);
		const fromRank = ranks.get(edge.from);
		const toRank = ranks.get(edge.to);
		if (from && to && fromRank !== undefined && toRank !== undefined) {
			routeEdge(edge, from, to, { from: fromRank, to: toRank }, graph);
		}
	}
	return graph;
};

/** Order each layer by the average position of what points into it, to keep links from crossing. */
const orderLayers = (graph: Graph): void => {
	graph.layers.forEach((layer, index) => {
		const above = graph.layers[index - 1];
		const band = graph.bands[index - 1];
		if (!above || !band) return;
		const key = (cell: Cell, position: number): number => {
			const parents = band.filter((segment) => segment.to === cell);
			return parents.length
				? parents.reduce((total, segment) => total + above.indexOf(segment.from), 0) /
						parents.length
				: position;
		};
		const ordered = layer
			.map((cell, position) => ({ cell, key: key(cell, position) }))
			.sort((left, right) => left.key - right.key)
			.map((entry) => entry.cell);
		layer.splice(0, layer.length, ...ordered);
	});
};

/**
 * Place a layer left to right, each cell as close as it can get to what it connects to. A cell
 * with nothing to line up against keeps where it already is, so one pass never undoes the other.
 */
const placeLayer = (layer: Layer, anchors: (cell: Cell) => number[]): void => {
	let cursor = 0;
	for (const cell of layer) {
		const centres = anchors(cell);
		const wanted = centres.length
			? Math.round(centres.reduce((total, column) => total + column, 0) / centres.length) -
				Math.floor((cell.width - 1) / 2)
			: cell.x;
		cell.x = Math.max(cursor, wanted);
		cursor = cell.x + cell.width + HORIZONTAL_GAP;
	}
};

/**
 * Two passes: children settle under their parents, then parents centre over their children. The
 * second pass is what stops a fan-out hanging off its parent's left edge.
 */
const positionLayers = (graph: Graph): void => {
	graph.layers.forEach((layer, index) => {
		const band = graph.bands[index - 1];
		placeLayer(layer, (cell) =>
			(band ?? [])
				.filter((segment) => segment.to === cell)
				.map((segment) => connectorColumn(segment.from)),
		);
	});
	[...graph.layers.entries()].reverse().forEach(([index, layer]) => {
		const band = graph.bands[index];
		placeLayer(layer, (cell) =>
			(band ?? [])
				.filter((segment) => segment.from === cell)
				.map((segment) => connectorColumn(segment.to)),
		);
	});
	// Centring parents pushes rightwards, so the whole figure is pulled back to the left margin.
	const cells = graph.layers.flat();
	const margin = Math.min(...cells.map((cell) => cell.x));
	for (const cell of cells) cell.x -= margin;
};

/**
 * A link needs a channel row when it has to travel sideways or carry a label; a plain vertical
 * drop needs none, which keeps a simple chain compact.
 */
const needsChannel = (segment: Segment): boolean =>
	connectorColumn(segment.from) !== connectorColumn(segment.to) || segment.label !== null;

const horizontalSpan = (segment: Segment): number =>
	Math.abs(connectorColumn(segment.to) - connectorColumn(segment.from));

type Band = { top: number; arrowRow: number; channels: Map<Segment, number> };

const measureBand = (segments: Segment[], top: number): Band => {
	const channels = new Map<Segment, number>(
		segments
			.filter(needsChannel)
			.sort((left, right) => horizontalSpan(left) - horizontalSpan(right))
			.map((segment, index) => [segment, index]),
	);
	return { top, arrowRow: top + channels.size, channels };
};

type Geometry = { tops: number[]; bands: Band[]; height: number };

/** Ranks are dense, so every layer holds cells and every gap between two of them holds a band. */
const measureGraph = (graph: Graph): Geometry => {
	const tops: number[] = [];
	const bands: Band[] = [];
	let top = 0;
	for (const segments of graph.bands) {
		tops.push(top);
		const band = measureBand(segments, top + BOX_HEIGHT);
		bands.push(band);
		top = band.arrowRow + 1;
	}
	tops.push(top);
	return { tops, bands, height: top + BOX_HEIGHT };
};

const UP = 1;
const RIGHT = 2;
const DOWN = 4;
const LEFT = 8;
const HORIZONTAL = LEFT | RIGHT;

/** Box-drawing character for every combination of the four connections a cell can make. */
const LINES = [
	" ",
	"│",
	"─",
	"└",
	"│",
	"│",
	"┌",
	"├",
	"─",
	"┘",
	"─",
	"┴",
	"┐",
	"┤",
	"┬",
	"┼",
] as const;

/** A cell either joins lines or holds text; text wins, because a label interrupts a line. */
type Glyph = { mask: number; text: string | null };
type Canvas = Glyph[][];

const cellAt = (canvas: Canvas, x: number, y: number): Glyph | null => {
	const row = canvas[y];
	if (!row || x < 0) return null;
	for (let column = row.length; column <= x; column += 1) row[column] = { mask: 0, text: null };
	return row[x] ?? null;
};

const join = (canvas: Canvas, x: number, y: number, mask: number): void => {
	const glyph = cellAt(canvas, x, y);
	if (glyph) glyph.mask |= mask;
};

/** Text occupies one cell and reserves the columns a wide glyph spills into. */
const writeText = (canvas: Canvas, x: number, y: number, text: string): void => {
	const head = cellAt(canvas, x, y);
	if (!head) return;
	head.text = text;
	head.mask = 0;
	for (let column = 1; column < columnWidth(text); column += 1) {
		const tail = cellAt(canvas, x + column, y);
		if (tail) {
			tail.text = "";
			tail.mask = 0;
		}
	}
};

const spanCells = (canvas: Canvas, x: number, y: number, width: number): Glyph[] =>
	Array.from({ length: width }, (_, offset) => cellAt(canvas, x + offset, y)).flatMap((glyph) =>
		glyph ? [glyph] : [],
	);

const isFree = (canvas: Canvas, x: number, y: number, width: number): boolean =>
	x >= 0 &&
	spanCells(canvas, x, y, width).every((glyph) => glyph.mask === 0 && glyph.text === null);

/** A stretch of plain horizontal line can carry a label; a crossing must not be overwritten. */
const isPlainRun = (canvas: Canvas, x: number, y: number, width: number): boolean =>
	x >= 0 && spanCells(canvas, x, y, width).every((glyph) => glyph.mask === HORIZONTAL);

const drawBox = (canvas: Canvas, cell: Cell, top: number): void => {
	const right = cell.x + cell.width - 1;
	for (let x = cell.x + 1; x < right; x += 1) {
		join(canvas, x, top, HORIZONTAL);
		join(canvas, x, top + 2, HORIZONTAL);
	}
	join(canvas, cell.x, top, RIGHT | DOWN);
	join(canvas, right, top, LEFT | DOWN);
	join(canvas, cell.x, top + 1, UP | DOWN);
	join(canvas, right, top + 1, UP | DOWN);
	join(canvas, cell.x, top + 2, RIGHT | UP);
	join(canvas, right, top + 2, LEFT | UP);
	writeText(canvas, cell.x + 2, top + 1, cell.label);
};

const drawCell = (canvas: Canvas, cell: Cell, top: number): void => {
	if (cell.kind === "node") drawBox(canvas, cell, top);
	// A placeholder is only a link passing through the layer, so it draws as the line it carries.
	else for (let y = top; y < top + BOX_HEIGHT; y += 1) join(canvas, cell.x, y, UP | DOWN);
};

const drawVertical = (canvas: Canvas, x: number, from: number, to: number): void => {
	for (let y = from; y < to; y += 1) join(canvas, x, y, UP | DOWN);
};

const drawTurn = (canvas: Canvas, y: number, exit: number, entry: number): void => {
	const towards = entry > exit ? RIGHT : LEFT;
	join(canvas, exit, y, UP | towards);
	for (let x = Math.min(exit, entry) + 1; x < Math.max(exit, entry); x += 1) {
		join(canvas, x, y, HORIZONTAL);
	}
	join(canvas, entry, y, DOWN | (towards === RIGHT ? LEFT : RIGHT));
};

const drawSegment = (canvas: Canvas, segment: Segment, band: Band): void => {
	const exit = connectorColumn(segment.from);
	const entry = connectorColumn(segment.to);
	const channel = band.channels.get(segment);
	// Meeting the source's bottom border here is what turns it into a `┬`.
	join(canvas, exit, band.top - 1, DOWN);
	if (channel === undefined) drawVertical(canvas, exit, band.top, band.arrowRow);
	else {
		const row = band.top + channel;
		drawVertical(canvas, exit, band.top, row);
		if (exit === entry) join(canvas, exit, row, UP | DOWN);
		else drawTurn(canvas, row, exit, entry);
		drawVertical(canvas, entry, row + 1, band.arrowRow);
	}
	if (segment.arrow && segment.to.kind === "node") {
		writeText(canvas, entry, band.arrowRow, "▼");
		return;
	}
	// An undirected link runs into the box instead, which reads as a `┴` on its top border.
	join(canvas, entry, band.arrowRow, UP | DOWN);
	if (segment.to.kind === "node") join(canvas, entry, band.arrowRow + 1, UP);
};

const rowEnd = (canvas: Canvas, y: number): number => canvas[y]?.length ?? 0;

/** Inside the link's own horizontal run if it fits, else beside it, else past everything. */
const drawLabel = (canvas: Canvas, segment: Segment, band: Band): void => {
	const channel = band.channels.get(segment);
	if (segment.label === null || channel === undefined) return;
	const row = band.top + channel;
	const width = columnWidth(segment.label);
	const [left, right] = [
		Math.min(connectorColumn(segment.from), connectorColumn(segment.to)),
		Math.max(connectorColumn(segment.from), connectorColumn(segment.to)),
	];
	const inRun = left + 1 + Math.floor((right - left - 1 - width) / 2);
	const beside = right + 2;
	if (right - left - 1 >= width + 2 && isPlainRun(canvas, inRun, row, width)) {
		writeText(canvas, inRun, row, segment.label);
	} else if (isFree(canvas, beside, row, width)) {
		writeText(canvas, beside, row, segment.label);
	} else writeText(canvas, rowEnd(canvas, row) + 2, row, segment.label);
};

/** Rows out, with the blank ones the geometry can leave at either end dropped. */
const serialise = (canvas: Canvas): string[] => {
	const lines = canvas.map((row) =>
		row
			.map((glyph) => glyph.text ?? LINES[glyph.mask] ?? " ")
			.join("")
			.trimEnd(),
	);
	const first = lines.findIndex((line) => line.length > 0);
	const last = lines.findLastIndex((line) => line.length > 0);
	return first < 0 ? [] : lines.slice(first, last + 1);
};

const draw = (graph: Graph, geometry: Geometry): Canvas => {
	const canvas: Canvas = Array.from({ length: geometry.height }, (): Glyph[] => []);
	graph.layers.forEach((layer, index) => {
		const top = geometry.tops[index] ?? 0;
		for (const cell of layer) drawCell(canvas, cell, top);
	});
	geometry.bands.forEach((band, index) => {
		for (const segment of graph.bands[index] ?? []) drawSegment(canvas, segment, band);
	});
	geometry.bands.forEach((band, index) => {
		for (const segment of graph.bands[index] ?? []) drawLabel(canvas, segment, band);
	});
	return canvas;
};

/**
 * Draw Mermaid source as ASCII art, or return null when it is not a flowchart this subset
 * models, cannot be layered, or will not fit the width the block has to draw in.
 */
export const drawMermaid = ({
	source,
	maxWidth,
}: {
	source: readonly string[];
	maxWidth: number;
}): readonly string[] | null => {
	const chart = parseMermaidFlowchart(source);
	if (!chart) return null;
	const ranks = rankNodes(chart);
	if (!ranks) return null;
	const graph = buildGraph(chart, ranks);
	orderLayers(graph);
	positionLayers(graph);
	const lines = serialise(draw(graph, measureGraph(graph)));
	if (!lines.length) return null;
	return lines.every((line) => columnWidth(line) <= maxWidth) ? lines : null;
};
