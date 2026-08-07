import { expect, test } from "bun:test";
import {
	anchorRowIndex,
	type DiffChromeWidths,
	type DiffPlanStyles,
	type ExcerptQuotation,
	findFocusedDecorationAnchor,
	paintDiff,
	parsePatch,
	planDiagram,
	planDiff,
	planExcerpt,
} from "../src/index.ts";

const styles: DiffPlanStyles = {
	text: "#fff",
	contextBackground: "#000",
	additionBackground: "#010",
	deletionBackground: "#100",
	additionFocusedBackground: "#020",
	deletionFocusedBackground: "#200",
	selectedHunkBackground: "#222",
	intralineAdditionBackground: "#030",
	intralineDeletionBackground: "#300",
};
const reservedChrome: DiffChromeWidths = {
	focusMarker: 2,
	attachmentMarker: 1,
	sign: 2,
	edge: 1,
	divider: 2,
	minimumCode: 4,
};
const [file] = parsePatch(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-short
+this addition is deliberately much longer than its pair
`);
if (!file) throw new Error("missing planner fixture");

test("the visual planner resolves stable wrapping, source identities, and split padding", () => {
	const plan = planDiff({
		file,
		layout: "split",
		width: 36,
		visibility: { lineNumbers: true, changeMarkers: true, hunkHeaders: true },
		chrome: reservedChrome,
	});
	const line = plan.rows.find((row) => row.type === "split-line");
	if (line?.type !== "split-line") throw new Error("missing planned split row");

	expect(line.height).toBeGreaterThan(1);
	expect(line.visualRows).toHaveLength(line.height);
	expect(line.visualRows.slice(1).every((row) => row.old.padding)).toBe(true);
	expect(line.visualRows[0]?.old.identities.deletions?.lineNumber).toBe(1);
	expect(line.visualRows[0]?.new.identities.additions?.lineNumber).toBe(1);
	expect(line.visualRows[0]?.new.gutters?.additions?.lineNumber).toBe(1);
	expect(line.visualRows[1]?.new.gutters).toBeUndefined();
	expect(line.visualRows[1]?.new.sourceOffset).toBeGreaterThan(0);
	expect(plan.totalHeight).toBe(plan.rows.reduce((sum, row) => sum + row.height, 0));
});

test("a non-OpenTUI zero-chrome request receives the full adapter-neutral code budget", () => {
	const zeroChrome: DiffChromeWidths = {
		focusMarker: 0,
		attachmentMarker: 0,
		sign: 0,
		edge: 0,
		divider: 0,
		minimumCode: 0,
	};
	const zero = planDiff({
		file,
		layout: "stack",
		width: 36,
		visibility: { lineNumbers: false, changeMarkers: false, hunkHeaders: false },
		chrome: zeroChrome,
	});
	const reserved = planDiff({
		file,
		layout: "stack",
		width: 36,
		visibility: { lineNumbers: false, changeMarkers: false, hunkHeaders: false },
		chrome: reservedChrome,
	});
	const isAddition = (row: (typeof zero.rows)[number]) =>
		row.type === "stack-line" && row.visualRows[0]?.cell.kind === "addition";
	const zeroLine = zero.rows.find(isAddition);
	const reservedLine = reserved.rows.find(isAddition);

	expect(zero.chrome).toEqual(zeroChrome);
	expect(zero.rows[0]?.height).toBe(0);
	if (zeroLine?.type !== "stack-line" || reservedLine?.type !== "stack-line")
		throw new Error("missing addition rows");
	const fragmentWidth = (row: typeof zeroLine) =>
		row.visualRows[0]?.cell.spans.reduce((sum, span) => sum + Bun.stringWidth(span.text), 0) ?? 0;
	// Hidden gutters and markers reserve no columns; only the adapter's always-on edge remains.
	expect(fragmentWidth(zeroLine)).toBe(36);
	expect(fragmentWidth(reservedLine)).toBe(35);
	expect(zeroLine.visualRows[0]?.cell.gutters).toBeUndefined();
	expect(zeroLine.visualRows[0]?.cell.changeSign).toBe(" ");
});

test("paint-only focus and hunk selection decorate only the requested window", () => {
	const plan = planDiff({
		file,
		layout: "stack",
		width: 24,
		visibility: { lineNumbers: true, changeMarkers: true, hunkHeaders: true },
		chrome: reservedChrome,
	});
	const geometryRows = plan.rows;
	const geometryHeights = plan.rows.map((row) => row.height);
	const decorations = [
		{
			id: "focus-addition",
			filePath: "a.ts",
			side: "additions" as const,
			startLine: 1,
			endLine: 1,
		},
	];
	const anchor = findFocusedDecorationAnchor(file, decorations, "focus-addition");
	if (!anchor) throw new Error("missing decoration anchor");
	const row = anchorRowIndex(plan, anchor);

	const plain = paintDiff({ plan, styles, window: { start: row, end: row + 1 } });
	const focused = paintDiff({
		plan,
		styles,
		window: { start: row, end: row + 1 },
		decorations,
		focusedDecorationId: "focus-addition",
		selectedHunkIndex: 0,
	});
	const focusedRow = focused.rows[0];
	if (focusedRow?.type !== "stack-line") throw new Error("missing painted stack row");

	expect(plain.rows).toHaveLength(1);
	expect(focused.rows).toHaveLength(1);
	expect(focusedRow.selectedBackground).toBe(styles.selectedHunkBackground);
	expect(focusedRow.visualRows[0]?.cell.backgroundColor).toBe(styles.additionFocusedBackground);
	expect(focusedRow.visualRows[0]?.cell.gutters?.additions?.focused).toBe(true);
	// Paint consumes the stable plan without replacing, rewrapping, or changing any measured row.
	expect(plan.rows).toBe(geometryRows);
	expect(plan.rows.map((planned) => planned.height)).toEqual(geometryHeights);
	expect(focused.plan).toBe(plan);
});

test("split paint keeps multi-line decoration focus isolated to its requested side", () => {
	const [decoratedFile] = parsePatch(`diff --git a/decorated.ts b/decorated.ts
--- a/decorated.ts
+++ b/decorated.ts
@@ -1,3 +1,3 @@
-old one
-old two
-old three
+new one
+new two
+new three
`);
	if (!decoratedFile) throw new Error("missing decoration fixture");
	const plan = planDiff({
		file: decoratedFile,
		layout: "split",
		width: 80,
		visibility: { lineNumbers: true, changeMarkers: true, hunkHeaders: true },
		chrome: reservedChrome,
	});
	const painted = paintDiff({
		plan,
		styles,
		decorations: [
			{
				id: "deleted-lines",
				focusId: "review-focus",
				filePath: "decorated.ts",
				side: "deletions",
				startLine: 1,
				endLine: 2,
			},
			{
				id: "active-additions",
				filePath: "decorated.ts",
				side: "additions",
				startLine: 2,
				endLine: 3,
				active: true,
				backgroundColor: "#abc",
				showGutterMarker: false,
			},
		],
		focusedDecorationId: "review-focus",
	});
	const lines = painted.rows.flatMap((row) =>
		row.type === "split-line" ? [row.visualRows[0]] : [],
	);

	expect(
		lines.map((line) => ({
			oldBackground: line?.old.backgroundColor,
			newBackground: line?.new.backgroundColor,
			oldMarker: line?.old.gutters?.deletions?.focused,
			newMarker: line?.new.gutters?.additions?.focused,
		})),
	).toEqual([
		{
			oldBackground: styles.deletionFocusedBackground,
			newBackground: styles.additionBackground,
			oldMarker: true,
			newMarker: false,
		},
		{
			oldBackground: styles.deletionFocusedBackground,
			newBackground: "#abc",
			oldMarker: true,
			newMarker: false,
		},
		{
			oldBackground: styles.deletionBackground,
			newBackground: "#abc",
			oldMarker: false,
			newMarker: false,
		},
	]);
});

const quotation: ExcerptQuotation = {
	filePath: "src/api/client.ts",
	startLine: 118,
	endLine: 120,
	caption: "the caller this change has to satisfy",
	lines: ["export class ApiClient {", "  send(request) {}", "}"],
};

const openTuiChrome: DiffChromeWidths = {
	focusMarker: 1,
	attachmentMarker: 3,
	sign: 3,
	edge: 1,
	divider: 1,
	minimumCode: 8,
};

test("an excerpt's fold state is an input to planning, not something measured after mount", () => {
	const shared = { key: "e", quotation, width: 110, chrome: openTuiChrome };
	const folded = planExcerpt({ ...shared, folded: true });
	const open = planExcerpt({ ...shared, folded: false });

	expect(folded.rows.map((row) => row.type)).toEqual(["excerpt-band"]);
	expect(folded.totalHeight).toBe(1);
	expect(open.rows.map((row) => row.type)).toEqual([
		"excerpt-caption",
		"excerpt-header",
		"excerpt-line",
		"excerpt-line",
		"excerpt-line",
	]);
	expect(open.totalHeight).toBe(2 + quotation.lines.length);
	expect(open.rows.flatMap((row) => (row.type === "excerpt-line" ? [row.lineNumber] : []))).toEqual(
		[118, 119, 120],
	);
});

test("quoted lines land on the same column as reviewable code, with one gutter at any width", () => {
	const plan = planExcerpt({
		key: "e",
		quotation,
		folded: false,
		width: 110,
		chrome: openTuiChrome,
	});
	const split = planDiff({
		file,
		layout: "split",
		width: 110,
		visibility: { lineNumbers: true, changeMarkers: true, hunkHeaders: true },
		chrome: openTuiChrome,
	});

	// Deletions gutter (rule plus blanks), additions gutter, then the always-empty sign slot.
	expect(plan.gutterColumns).toBe(17);
	expect(plan.digits).toBe(3);
	// A split diff halves its code budget between two panes; an excerpt never divides.
	expect(plan.codeWidth).toBe(110 - plan.gutterColumns - openTuiChrome.edge);
	expect(plan.codeWidth).toBeGreaterThan(split.paneWidths.new);
});

test("an open excerpt sheds its state word rather than truncating the range it names", () => {
	const wide = planExcerpt({
		key: "e",
		quotation,
		folded: false,
		width: 110,
		chrome: openTuiChrome,
	});
	const narrow = planExcerpt({
		key: "e",
		quotation,
		folded: false,
		width: 80,
		chrome: openTuiChrome,
	});
	const header = (plan: typeof wide) =>
		plan.rows.find((row) => row.type === "excerpt-header")?.label;

	expect(header(wide)).toBe("context · src/api/client.ts 118–120 · unchanged");
	expect(header(narrow)).toBe("context · src/api/client.ts 118–120");
});

const figure = {
	kind: "ascii",
	lines: ["prep ──▶ chapters.json ──▶ show", "        └─ blobs"],
} as const;

test("a diagram plans to a known height folded and open, on the excerpt's own column", () => {
	const shared = { key: "d", diagram: figure, width: 110, chrome: openTuiChrome };
	const folded = planDiagram({ ...shared, folded: true });
	const open = planDiagram({ ...shared, folded: false });
	const quoted = planExcerpt({
		key: "e",
		quotation,
		folded: false,
		width: 110,
		chrome: openTuiChrome,
	});

	expect(folded.rows.map((row) => row.type)).toEqual(["diagram-band"]);
	expect(folded.totalHeight).toBe(1);
	expect(open.rows.map((row) => row.type)).toEqual([
		"diagram-header",
		"diagram-line",
		"diagram-line",
	]);
	expect(open.totalHeight).toBe(1 + figure.lines.length);
	// A figure numbers nothing, yet lands where a quotation's code does.
	expect(open.gutterColumns).toBe(quoted.gutterColumns);
	expect(open.codeWidth).toBe(quoted.codeWidth);
});

test("a diagram's header names its kind, and mermaid is labelled as the source it is", () => {
	const label = (kind: "ascii" | "mermaid", folded: boolean) =>
		planDiagram({
			key: "d",
			diagram: { kind, lines: ["a --> b"] },
			folded,
			width: 110,
			chrome: openTuiChrome,
		}).rows[0];

	expect(label("ascii", false)).toMatchObject({ label: "diagram · ascii", action: "▲ hide" });
	expect(label("mermaid", false)).toMatchObject({ label: "diagram · mermaid source" });
	expect(label("mermaid", true)).toMatchObject({
		label: "diagram · mermaid source",
		action: "▼ show 1 line",
	});
});
