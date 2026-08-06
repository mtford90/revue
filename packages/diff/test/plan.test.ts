import { expect, test } from "bun:test";
import { type DiffChromeWidths, type DiffPlanStyles, parsePatch, planDiff } from "../src/index.ts";

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
const opentuiChrome: DiffChromeWidths = {
	focusMarker: 1,
	attachmentMarker: 3,
	sign: 3,
	edge: 1,
	divider: 1,
	minimumCode: 8,
};
const [file] = parsePatch(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-short
+this addition is deliberately much longer than its pair
`);
if (!file) throw new Error("missing planner fixture");

test("the visual planner resolves wrapping, source identities, and split padding", () => {
	const plan = planDiff({
		file,
		layout: "split",
		width: 36,
		visibility: { lineNumbers: true, hunkHeaders: true },
		styles,
		chrome: opentuiChrome,
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
	expect(plan.totalHeight).toBe(plan.rows.reduce((sum, row) => sum + row.height, 0));
});

test("adapter-declared chrome changes the shared code budget", () => {
	const withoutAdapterChrome = planDiff({
		file,
		layout: "split",
		width: 36,
		visibility: { lineNumbers: false, hunkHeaders: false },
		styles,
		chrome: { ...opentuiChrome, focusMarker: 0, attachmentMarker: 0 },
	});
	const withAdapterChrome = planDiff({
		file,
		layout: "split",
		width: 36,
		visibility: { lineNumbers: false, hunkHeaders: false },
		styles,
		chrome: opentuiChrome,
	});

	expect(withoutAdapterChrome.codeWidths.additions).toBeGreaterThan(
		withAdapterChrome.codeWidths.additions,
	);
	expect(withoutAdapterChrome.rows[0]?.height).toBe(0);
});
