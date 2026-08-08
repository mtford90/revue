import { expect, test } from "bun:test";
import { drawMermaid, parseMermaidFlowchart } from "../src/index.ts";

const draw = (source: string, maxWidth = 80): readonly string[] | null =>
	drawMermaid({ source: source.split("\n"), maxWidth });

const boxLabels = (figure: readonly string[]): string[] =>
	figure.flatMap((line) => [...line.matchAll(/│ (\S[^│]*?) │/g)].map((match) => match[1] ?? ""));

test("labels, shapes, directions and comments parse into nodes and edges", () => {
	const chart = parseMermaidFlowchart([
		"%% how a run reaches the reviewer",
		"flowchart LR",
		'  A["revue prep"] -- freezes --> B(chapters.json);',
		"  B -.-> C{show}",
		"  C --- D",
	]);

	expect(chart?.direction).toBe("LR");
	expect(chart?.nodes).toEqual([
		{ id: "A", label: "revue prep" },
		{ id: "B", label: "chapters.json" },
		{ id: "C", label: "show" },
		{ id: "D", label: "D" },
	]);
	expect(chart?.edges).toEqual([
		{ from: "A", to: "B", label: "freezes", arrow: true },
		{ from: "B", to: "C", label: null, arrow: true },
		{ from: "C", to: "D", label: null, arrow: false },
	]);
});

test("a chain draws as boxes joined by arrows", () => {
	expect(draw("graph TD\n  A[prep] --> B[show]")).toEqual([
		"┌──────┐",
		"│ prep │",
		"└──┬───┘",
		"   ▼",
		"┌──────┐",
		"│ show │",
		"└──────┘",
	]);
});

test("a declared direction does not turn the figure sideways", () => {
	// Columns are the scarce axis in a terminal, so every flowchart is laid out top to bottom.
	expect(draw("graph LR\n  A[prep] --> B[show]")).toEqual(draw("graph TD\n  A[prep] --> B[show]"));
});

test("every node of a fan-out is drawn once, each with its own arrow", () => {
	const figure = draw("flowchart TD\n  A[prep] --> B[hunks]\n  A --> C[blobs]\n  A --> D[patch]");

	expect(figure && boxLabels(figure)).toEqual(["prep", "hunks", "blobs", "patch"]);
	expect(figure?.join("\n").match(/▼/g)).toHaveLength(3);
});

test("an edge label reads beside the line it belongs to", () => {
	const figure = draw(
		"graph LR\n  A[Dashboard] --> B[ApiClient]\n  B -->|retry on 503| C[Backend]",
	);

	expect(figure && boxLabels(figure)).toEqual(["Dashboard", "ApiClient", "Backend"]);
	expect(figure?.join("\n")).toContain("│ retry on 503");
});

test("a link spanning layers passes beside the boxes between, not through them", () => {
	const figure = draw("graph TD\n  A[prep] --> B[freeze]\n  B --> C[show]\n  A --> C");

	expect(figure && boxLabels(figure)).toEqual(["prep", "freeze", "show"]);
	// The skipping link keeps a column of its own beside the middle box's own borders.
	expect(figure?.some((line) => /│ freeze │ {2}│/.test(line))).toBe(true);
});

test("an undirected link runs into the box rather than pointing at it", () => {
	const figure = draw("graph TD\n  A[prep] --- B[show]");

	expect(figure?.join("\n")).not.toContain("▼");
	expect(figure?.at(-3)).toContain("┴");
});

test("a diagram type outside the subset is shown as source rather than drawn", () => {
	expect(draw("sequenceDiagram\n  Alice->>Bob: does this render?")).toBeNull();
	expect(draw("classDiagram\n  Animal <|-- Duck")).toBeNull();
	expect(draw("gantt\n  title A schedule")).toBeNull();
});

test("flowchart syntax the subset does not model is shown as source rather than drawn", () => {
	expect(draw("flowchart TD\n  subgraph one\n  A --> B\n  end")).toBeNull();
	expect(draw("flowchart TD\n  A --> B\n  style A fill:#f9f")).toBeNull();
	expect(draw("flowchart TD\n  A & B --> C")).toBeNull();
});

test("malformed syntax is shown as source rather than half-drawn", () => {
	expect(draw("graph TD\n  A[unclosed --> B")).toBeNull();
	expect(draw("graph TD\n  A --?-> B")).toBeNull();
	expect(draw("graph TD")).toBeNull();
});

test("a cycle has no layering, so it is shown as source", () => {
	expect(draw("graph TD\n  A --> B\n  B --> C\n  C --> A")).toBeNull();
	expect(draw("graph TD\n  A[retries] --> A")).toBeNull();
});

test("a figure that will not fit the block's width is shown as source", () => {
	const wide = "graph TD\n  A[a deliberately long node label] --> B[and another long one]";

	expect(draw(wide, 80)).not.toBeNull();
	expect(draw(wide, 20)).toBeNull();
});

test("a label carrying terminal control sequences is drawn as inert text", () => {
	const figure = draw("graph TD\n  A[\x1b[31mred\x1b[0m\tlabel] --> B[plain]");

	expect(figure && boxLabels(figure)).toEqual(["red  label", "plain"]);
});
