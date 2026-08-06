import { expect, test } from "bun:test";
import { parsePatch } from "./index.ts";
import { type DiffPlanStyles, type PaintedDiffRow, paintDiff, planDiff } from "./plan.ts";
import { intralineRangesFor } from "./rows.ts";
import type { DiffFile, DiffLayout, SpanEmphasis } from "./types.ts";

const patch = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,1 +1,1 @@
-const value = 1;
+const value = 42;
`;

const styles: DiffPlanStyles = {
	text: "#ffffff",
	contextBackground: "#000000",
	additionBackground: "#001100",
	deletionBackground: "#110000",
	additionFocusedBackground: "#002200",
	deletionFocusedBackground: "#220000",
	selectedHunkBackground: "#222222",
	intralineAdditionBackground: "#0a3d0a",
	intralineDeletionBackground: "#3d0a0a",
};
const chrome = {
	focusMarker: 0,
	attachmentMarker: 0,
	sign: 0,
	edge: 0,
	divider: 0,
	minimumCode: 1,
};

const paintedRows = (
	file: DiffFile,
	layout: DiffLayout,
	emphasis?: SpanEmphasis,
): PaintedDiffRow[] =>
	paintDiff({
		plan: planDiff({
			file,
			layout,
			width: 200,
			visibility: { lineNumbers: true, hunkHeaders: true },
			chrome,
		}),
		styles,
		emphasis,
	}).rows;

const cellsOfKind = (rows: readonly PaintedDiffRow[], kind: string) =>
	rows.flatMap((row) => {
		if (row.type === "stack-line") {
			const cell = row.visualRows[0]?.cell;
			return cell?.kind === kind ? [cell] : [];
		}
		if (row.type !== "split-line") return [];
		const visual = row.visualRows[0];
		return visual ? [visual.old, visual.new].filter((cell) => cell.kind === kind) : [];
	});

test("paint emphasis splits a stable planned line into dim base and glowing novel tokens", () => {
	const [file] = parsePatch(patch);
	if (!file) throw new Error("patch must parse");
	const rows = paintedRows(file, "stack", {
		rangesFor: (side, line) =>
			side === "additions" && line === 1 ? [{ start: 14, end: 16 }] : undefined,
		deletionsFg: "#ff0000",
		additionsFg: "#00ff00",
	});

	expect(cellsOfKind(rows, "addition")[0]?.spans).toEqual([
		{ text: "const value = ", dim: true, fg: "#ffffff" },
		{ text: "42", fg: "#00ff00", bold: true },
		{ text: ";", dim: true, fg: "#ffffff" },
	]);
	expect(cellsOfKind(rows, "deletion")[0]?.spans).toEqual([
		{ text: "const value = ", fg: "#ffffff" },
		{ text: "1", bg: "#3d0a0a", fg: "#ffffff" },
		{ text: ";", fg: "#ffffff" },
	]);
});

const pairingPatch = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,3 +1,2 @@
 const untouched = 0;
-const value = 1;
-orphan();
+const value = 42;
`;

const parseOne = (source: string) => {
	const [file] = parsePatch(source);
	if (!file) throw new Error("patch must parse");
	return file;
};

test.each([
	"split",
	"stack",
] as const)("paired change lines take intra-line backgrounds in %s layout", (layout) => {
	const rows = paintedRows(parseOne(pairingPatch), layout);

	expect(cellsOfKind(rows, "addition").map((cell) => cell.spans)).toEqual([
		[
			{ text: "const value = ", fg: "#ffffff" },
			{ text: "42", bg: "#0a3d0a", fg: "#ffffff" },
			{ text: ";", fg: "#ffffff" },
		],
	]);
	expect(cellsOfKind(rows, "deletion").map((cell) => cell.spans)).toEqual([
		[
			{ text: "const value = ", fg: "#ffffff" },
			{ text: "1", bg: "#3d0a0a", fg: "#ffffff" },
			{ text: ";", fg: "#ffffff" },
		],
		[{ text: "orphan();", fg: "#ffffff" }],
	]);
});

test("novel emphasis replaces the intra-line background on its line", () => {
	const rows = paintedRows(parseOne(pairingPatch), "stack", {
		rangesFor: (side, line) =>
			side === "additions" && line === 2 ? [{ start: 6, end: 11 }] : undefined,
		deletionsFg: "#ff0000",
		additionsFg: "#00ff00",
	});

	expect(cellsOfKind(rows, "addition")[0]?.spans).toEqual([
		{ text: "const ", dim: true, fg: "#ffffff" },
		{ text: "value", fg: "#00ff00", bold: true },
		{ text: " = 42;", dim: true, fg: "#ffffff" },
	]);
});

test("a parsed change block is paired once however often geometry is planned", () => {
	const block = parseOne(pairingPatch).metadata.hunks[0]?.hunkContent.find(
		(content) => content.type === "change",
	);
	if (block?.type !== "change") throw new Error("patch must contain a change block");
	const lines = { oldLines: ["const value = 1;", "orphan();"], newLines: ["const value = 42;"] };

	const first = intralineRangesFor({ block, ...lines });

	expect(intralineRangesFor({ block, ...lines })).toBe(first);
	expect(first.additions.get(0)).toEqual([{ start: 14, end: 16 }]);
});

test("intra-line backgrounds line up with tab-expanded columns", () => {
	const [file] = parsePatch(`diff --git a/tabs.ts b/tabs.ts
--- a/tabs.ts
+++ b/tabs.ts
@@ -1 +1 @@
-\tconst value = 1;
+\tconst value = 42;
`);
	if (!file) throw new Error("patch must parse");
	const addition = cellsOfKind(paintedRows(file, "stack"), "addition")[0];

	expect(addition?.spans).toEqual([
		{ text: "  const value = ", fg: "#ffffff" },
		{ text: "42", bg: "#0a3d0a", fg: "#ffffff" },
		{ text: ";", fg: "#ffffff" },
	]);
});
