import { expect, test } from "bun:test";
import { createDiffFile, type DiffLineRange, parsePatch, planDiff } from "@revue/diff";
import { OPENTUI_DIFF_CHROME } from "@revue/diff-opentui";
import {
	initialReviewLine,
	moveReviewStop,
	moveSelectionReviewLine,
	type ReviewCard,
	type ReviewLineFile,
	type ReviewStop,
	reviewableLines,
	reviewLineFile,
	reviewLineFileContains,
	reviewLineSelection,
	reviewStops,
	selectionLineFile,
	switchReviewLineSide,
} from "./reviewLineCursor.ts";

const plan = (patch: string, layout: "split" | "stack" = "split") => {
	const parsed = parsePatch(patch)[0];
	if (!parsed) throw new Error("test patch did not parse");
	return planDiff({
		file: createDiffFile(parsed),
		layout,
		width: 100,
		visibility: { lineNumbers: true, changeMarkers: true, hunkHeaders: true },
		chrome: OPENTUI_DIFF_CHROME,
	});
};

/** Line-only motion, so the cursor tests below still read as the line walk they describe. */
const moveReviewLine = ({
	files,
	current,
	delta,
}: {
	files: readonly ReviewLineFile[];
	current: DiffLineRange | null;
	delta: -1 | 1;
}): DiffLineRange | null => {
	const next = moveReviewStop({
		files,
		current: current ? { kind: "line", line: current } : null,
		delta,
	});
	return next?.kind === "line" ? next.line : null;
};

const PATCH = `diff --git a/value.ts b/value.ts
--- a/value.ts
+++ b/value.ts
@@ -1,3 +1,3 @@
-old one
+new one
 context
-old only
+new only
@@ -10 +10 @@
-deleted tail
`;

test("ordinary review order follows the active layout", () => {
	const split = plan(PATCH, "split");
	const stack = plan(PATCH, "stack");
	expect(reviewableLines(split).map(({ side, startLine }) => [side, startLine])).toEqual([
		["additions", 1],
		["additions", 3],
		["deletions", 10],
	]);
	expect(reviewableLines(stack).map(({ side, startLine }) => [side, startLine])).toEqual([
		["deletions", 1],
		["additions", 1],
		["deletions", 3],
		["additions", 3],
		["deletions", 10],
	]);
	expect(initialReviewLine(reviewLineFile(stack))).toMatchObject({
		side: "additions",
		startLine: 1,
	});
});

test("split motion stays in-pane, switches only on the same row, and retains side across files", () => {
	const first = reviewLineFile(
		plan(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
-old paired
+new paired
 context
+new only
`),
	);
	const second = reviewLineFile(
		plan(`diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-old next
+new next
`),
	);
	const initial = initialReviewLine(first);
	const old = switchReviewLineSide({ file: first, current: initial, side: "deletions" });
	expect(old).toMatchObject({ side: "deletions", startLine: 1 });
	expect(switchReviewLineSide({ file: first, current: old, side: "additions" })).toEqual(initial);
	expect(moveReviewLine({ files: [first, second], current: old, delta: 1 })).toMatchObject({
		filePath: "b.ts",
		side: "deletions",
		startLine: 1,
	});
});

test("ordinary motion leaves a clicked context row for the adjacent changed row in its lane", () => {
	const file = reviewLineFile(
		plan(`diff --git a/lane.ts b/lane.ts
--- a/lane.ts
+++ b/lane.ts
@@ -1,3 +1,4 @@
-old paired
+new paired
 context
+new only
 tail
`),
	);
	const contextRow = file.rows.find((row) => row.kind === "context");
	const oldContext = contextRow?.stops.find((stop) => stop.side === "deletions");
	if (!oldContext) throw new Error("missing old context authority");
	const context = {
		filePath: oldContext.filePath,
		hunkOldStart: oldContext.oldStart,
		side: oldContext.side,
		startLine: oldContext.lineNumber,
		endLine: oldContext.lineNumber,
	} as const;

	expect(file.changedRows).toHaveLength(2);
	expect(reviewLineFileContains(file, context)).toBe(true);
	expect(switchReviewLineSide({ file, current: context, side: "additions" })).toMatchObject({
		side: "additions",
		startLine: 2,
	});
	expect(moveReviewLine({ files: [file], current: context, delta: -1 })).toMatchObject({
		side: "deletions",
		startLine: 1,
	});
	const newContext = switchReviewLineSide({ file, current: context, side: "additions" });
	expect(moveReviewLine({ files: [file], current: newContext, delta: 1 })).toMatchObject({
		side: "additions",
		startLine: 3,
	});
});

test("selection can stop on context before ordinary motion resumes on changed rows", () => {
	const file = reviewLineFile(plan(PATCH, "split"));
	const initial = initialReviewLine(file);
	const context = moveSelectionReviewLine({ file, current: initial, delta: 1 });
	expect(context).toMatchObject({ side: "additions", startLine: 2 });
	expect(reviewLineFileContains(file, context)).toBe(true);
	expect(moveReviewLine({ files: [file], current: context, delta: 1 })).toMatchObject({
		side: "additions",
		startLine: 3,
	});
	expect(moveReviewLine({ files: [file], current: context, delta: -1 })).toMatchObject({
		side: "additions",
		startLine: 1,
	});
});

test("a deletion-only file starts and moves on its old side", () => {
	const file = reviewLineFile(
		plan(`diff --git a/gone.ts b/gone.ts
--- a/gone.ts
+++ /dev/null
@@ -4,2 +0,0 @@
-first
-second
`),
	);
	const first = initialReviewLine(file);
	expect(first).toMatchObject({ side: "deletions", startLine: 4 });
	expect(moveReviewLine({ files: [file], current: first, delta: 1 })).toMatchObject({
		side: "deletions",
		startLine: 5,
	});
});

test("selection extends through original rows and becomes a split rectangle after crossing panes", () => {
	const file = selectionLineFile(plan(PATCH, "split"));
	const anchor = initialReviewLine(reviewLineFile(plan(PATCH, "split")));
	if (!anchor) throw new Error("missing test anchor");
	const extended = moveSelectionReviewLine({ file, current: anchor, delta: 1 });
	expect(extended).toMatchObject({ side: "additions", startLine: 2 });
	const crossed = switchReviewLineSide({ file, current: extended, side: "deletions" });
	if (!crossed) throw new Error("missing crossed cursor");
	expect(reviewLineSelection({ file, anchor, cursor: crossed })?.ranges).toEqual([
		{ oldStart: 1, side: "deletions", startLine: 1, endLine: 1 },
		{ oldStart: 1, side: "additions", startLine: 1, endLine: 1 },
		{ oldStart: 1, side: "deletions", startLine: 2, endLine: 2 },
		{ oldStart: 1, side: "additions", startLine: 2, endLine: 2 },
	]);
});

test("selection crosses to the nearest changed row when its split row is unpaired", () => {
	const file = selectionLineFile(
		plan(`diff --git a/unpaired.ts b/unpaired.ts
--- a/unpaired.ts
+++ b/unpaired.ts
@@ -1 +1,0 @@
-old above
@@ -10,0 +9 @@
+new middle
@@ -20 +20,0 @@
-old below
`),
	);
	const anchor = initialReviewLine(file);
	if (!anchor) throw new Error("missing selection anchor");
	const crossed = switchReviewLineSide({ file, current: anchor, side: "deletions" });
	if (!crossed) throw new Error("missing crossed cursor");

	expect(crossed).toMatchObject({ hunkOldStart: 20, side: "deletions", startLine: 20 });
	expect(reviewLineSelection({ file, anchor, cursor: crossed })?.ranges).toEqual([
		{ oldStart: 10, side: "additions", startLine: 9, endLine: 9 },
		{ oldStart: 20, side: "deletions", startLine: 20, endLine: 20 },
	]);
});

test("stacked selection counts a dual-authority context row once", () => {
	const allRows = selectionLineFile(plan(PATCH, "stack"));
	const oldOne = reviewableLines(plan(PATCH, "stack"))[0];
	if (!oldOne) throw new Error("missing old line");
	const newOne = moveSelectionReviewLine({ file: allRows, current: oldOne, delta: 1 });
	expect(newOne).toMatchObject({ side: "additions", startLine: 1 });
	const context = moveSelectionReviewLine({ file: allRows, current: newOne, delta: 1 });
	expect(context).toMatchObject({ side: "additions", startLine: 2 });
	const next = moveSelectionReviewLine({ file: allRows, current: context, delta: 1 });
	expect(next).toMatchObject({ side: "deletions", startLine: 3 });
});

// ── Thread cards as stops ─────────────────────────────────────────────────────

const anchoredAt = (side: "additions" | "deletions", line: number, hunkOldStart = 1) => ({
	filePath: "value.ts",
	hunkOldStart,
	side,
	startLine: line,
	endLine: line,
});

const card = (id: string, anchor: DiffLineRange): ReviewCard => ({ id, anchor });

const named = (stop: ReviewStop) =>
	stop.kind === "line" ? `${stop.line.side} ${stop.line.startLine}` : `card ${stop.threadId}`;

test("cards stop after the row they hang from, in the order they were given", () => {
	const file = reviewLineFile(plan(PATCH, "split"));
	const first = anchoredAt("additions", 1);
	const stops = reviewStops({
		file,
		cards: [card("upper", first), card("lower", first)],
		side: "additions",
	});

	expect(stops.map(named)).toEqual(["additions 1", "card upper", "card lower", "additions 3"]);
});

test("a card on a deletion row is a stop in either pane", () => {
	const file = reviewLineFile(plan(PATCH, "split"));
	const cards = [card("tail", anchoredAt("deletions", 10, 10))];

	expect(reviewStops({ file, cards, side: "additions" }).map(named)).toEqual([
		"additions 1",
		"additions 3",
		"card tail",
	]);
	expect(reviewStops({ file, cards, side: "deletions" }).map(named)).toEqual([
		"deletions 1",
		"deletions 3",
		"deletions 10",
		"card tail",
	]);
});

test("ordinary motion lands on a card between the lines around it", () => {
	const files = [reviewLineFile(plan(PATCH, "split"))];
	const cards = [card("upper", anchoredAt("additions", 1))];
	const start: ReviewStop = { kind: "line", line: anchoredAt("additions", 1) };

	const onCard = moveReviewStop({ files, cards, current: start, delta: 1 });
	expect(onCard).toEqual({ kind: "thread", threadId: "upper", anchor: anchoredAt("additions", 1) });
	expect(moveReviewStop({ files, cards, current: onCard, delta: 1 })).toMatchObject({
		kind: "line",
		line: { side: "additions", startLine: 3 },
	});
	expect(moveReviewStop({ files, cards, current: onCard, delta: -1 })).toEqual(start);
});

test("a card at the end of a file is the stop the walk back from the next file lands on", () => {
	const first = reviewLineFile(plan(PATCH, "split"));
	const second = reviewLineFile(
		plan(`diff --git a/next.ts b/next.ts
--- a/next.ts
+++ b/next.ts
@@ -1 +1 @@
-old next
+new next
`),
	);
	const cards = [card("last", anchoredAt("additions", 3))];
	const entry = moveReviewStop({
		files: [first, second],
		cards,
		current: { kind: "line", line: anchoredAt("additions", 1) },
		delta: 1,
	});

	expect(entry).toMatchObject({ kind: "line", line: { side: "additions", startLine: 3 } });
	const next = moveReviewStop({ files: [first, second], cards, current: entry, delta: 1 });
	expect(next).toMatchObject({ kind: "thread", threadId: "last" });
	const crossed = moveReviewStop({ files: [first, second], cards, current: next, delta: 1 });
	expect(crossed).toMatchObject({ kind: "line", line: { filePath: "next.ts", startLine: 1 } });
	expect(moveReviewStop({ files: [first, second], cards, current: crossed, delta: -1 })).toEqual(
		next,
	);
});
