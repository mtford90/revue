import { expect, test } from "bun:test";
import {
	anchorRowIndex,
	type DiffChromeWidths,
	type DiffPlanStyles,
	findFocusedDecorationAnchor,
	paintDiff,
	parsePatch,
	planDiff,
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
		visibility: { lineNumbers: true, hunkHeaders: true },
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
		visibility: { lineNumbers: false, hunkHeaders: false },
		chrome: zeroChrome,
	});
	const reserved = planDiff({
		file,
		layout: "stack",
		width: 36,
		visibility: { lineNumbers: false, hunkHeaders: false },
		chrome: reservedChrome,
	});
	const isAddition = (row: (typeof zero.rows)[number]) =>
		row.type === "stack-line" && row.visualRows[0]?.cell.kind === "addition";
	const zeroLine = zero.rows.find(isAddition);
	const reservedLine = reserved.rows.find(isAddition);

	expect(zero.chrome).toEqual(zeroChrome);
	expect(zero.rows[0]?.height).toBe(0);
	expect(zeroLine?.height).toBeLessThan(reservedLine?.height ?? 0);
});

test("paint-only focus and hunk selection decorate only the requested window", () => {
	const plan = planDiff({
		file,
		layout: "stack",
		width: 24,
		visibility: { lineNumbers: true, hunkHeaders: true },
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
