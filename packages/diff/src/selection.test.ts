import { expect, test } from "bun:test";
import { parsePatch } from "./model.ts";
import {
	canonicalizeDiffSelection,
	diffPresentationRows,
	diffSelectionStops,
	firstSelectionRange,
	moveSplitSelectionStop,
	moveStackedSelectionStop,
	normalizeDiffSelection,
	rectangularSelectionBetween,
	selectionBetween,
	selectionContains,
	stackedVisibleSelectionStops,
	switchSplitSelectionStop,
	terminalSelectionRange,
} from "./selection.ts";

const [file] = parsePatch(`diff --git a/multi.ts b/multi.ts
--- a/multi.ts
+++ b/multi.ts
@@ -1,2 +1,2 @@
-old first
+new first
 keep first
@@ -10,2 +10,2 @@
-old second
+new second
 keep second
`);
if (!file) throw new Error("missing selection fixture");

const stops = diffSelectionStops(file, "split");

test("display stops retain both sides and only rows backed by original hunks", () => {
	expect(stops.map(({ oldStart, side, lineNumber }) => [oldStart, side, lineNumber])).toEqual([
		[1, "deletions", 1],
		[1, "additions", 1],
		[1, "deletions", 2],
		[1, "additions", 2],
		[10, "deletions", 10],
		[10, "additions", 10],
		[10, "deletions", 11],
		[10, "additions", 11],
	]);
});

test("interaction stops follow each presentation layout for a two-line replacement", () => {
	const [replacement] = parsePatch(`diff --git a/replacement.ts b/replacement.ts
--- a/replacement.ts
+++ b/replacement.ts
@@ -1,2 +1,2 @@
-old one
-old two
+new one
+new two
`);
	if (!replacement) throw new Error("missing replacement fixture");
	const identities = (layout: "split" | "stack") =>
		diffSelectionStops(replacement, layout).map(({ side, lineNumber }) => [side, lineNumber]);

	expect(identities("split")).toEqual([
		["deletions", 1],
		["additions", 1],
		["deletions", 2],
		["additions", 2],
	]);
	expect(identities("stack")).toEqual([
		["deletions", 1],
		["deletions", 2],
		["additions", 1],
		["additions", 2],
	]);
});

test("selectionBetween is direction-independent, file-local, ordered, and merges adjacent ranges", () => {
	const forward = selectionBetween(stops, stops[0], stops[5]);
	const reverse = selectionBetween(stops, stops[5], stops[0]);
	expect(reverse).toEqual(forward);
	expect(forward).toEqual({
		filePath: "multi.ts",
		ranges: [
			{ oldStart: 1, side: "deletions", startLine: 1, endLine: 1 },
			{ oldStart: 1, side: "additions", startLine: 1, endLine: 1 },
			{ oldStart: 1, side: "deletions", startLine: 2, endLine: 2 },
			{ oldStart: 1, side: "additions", startLine: 2, endLine: 2 },
			{ oldStart: 10, side: "deletions", startLine: 10, endLine: 10 },
			{ oldStart: 10, side: "additions", startLine: 10, endLine: 10 },
		],
	});
	if (!forward) throw new Error("expected selection");
	const contained = stops[4];
	if (!contained) throw new Error("missing contained stop");
	expect(selectionContains(forward, contained)).toBe(true);
	expect(firstSelectionRange(forward)).toEqual(forward.ranges[0]);
	expect(terminalSelectionRange(forward)).toEqual({
		oldStart: 10,
		side: "additions",
		startLine: 10,
		endLine: 10,
	});
});

test("normalisation sorts by authoritative display order and merges only contiguous same-side ranges", () => {
	const normalized = normalizeDiffSelection(
		{
			filePath: "multi.ts",
			ranges: [
				{ oldStart: 10, side: "additions", startLine: 10, endLine: 11 },
				{ oldStart: 1, side: "deletions", startLine: 2, endLine: 2 },
				{ oldStart: 1, side: "deletions", startLine: 1, endLine: 1 },
			],
		},
		stops,
	);
	expect(normalized).toEqual({
		filePath: "multi.ts",
		ranges: [
			{ oldStart: 1, side: "deletions", startLine: 1, endLine: 2 },
			{ oldStart: 10, side: "additions", startLine: 10, endLine: 11 },
		],
	});
});

test("normalisation preserves ranges with distinct hunk or side authority", () => {
	const normalized = normalizeDiffSelection(
		{
			filePath: "multi.ts",
			ranges: [
				{ oldStart: 1, side: "deletions", startLine: 1, endLine: 2 },
				{ oldStart: 1, side: "additions", startLine: 1, endLine: 2 },
				{ oldStart: 10, side: "deletions", startLine: 10, endLine: 11 },
			],
		},
		stops,
	);
	expect(normalized.ranges).toHaveLength(3);
});

const [paneFile] = parsePatch(`diff --git a/panes.ts b/panes.ts
--- a/panes.ts
+++ b/panes.ts
@@ -1,3 +1,3 @@
-old one
-old two
+new one
+new two
 context
`);
if (!paneFile) throw new Error("missing pane fixture");

const stopIdentity = (stop: { side: string; lineNumber: number }) => [stop.side, stop.lineNumber];

test("presentation rows retain split row identity for vertical and same-row side motion", () => {
	const rows = diffPresentationRows(paneFile, "split");
	expect(rows.map((row) => [row.kind, row.stops.map(stopIdentity)])).toEqual([
		[
			"change",
			[
				["deletions", 1],
				["additions", 1],
			],
		],
		[
			"change",
			[
				["deletions", 2],
				["additions", 2],
			],
		],
		[
			"context",
			[
				["deletions", 3],
				["additions", 3],
			],
		],
	]);
	const newOne = rows[0]?.stops.find((stop) => stop.side === "additions");
	if (!newOne) throw new Error("missing new-side stop");
	expect(stopIdentity(moveSplitSelectionStop({ rows, current: newOne, delta: 1 }))).toEqual([
		"additions",
		2,
	]);
	expect(
		stopIdentity(switchSplitSelectionStop({ rows, current: newOne, side: "deletions" })),
	).toEqual(["deletions", 1]);
});

test("split side motion falls forward to the nearest changed row in the target pane", () => {
	const [unpaired] = parsePatch(`diff --git a/unpaired.ts b/unpaired.ts
--- a/unpaired.ts
+++ b/unpaired.ts
@@ -1 +1,0 @@
-old above
@@ -10,0 +9 @@
+new middle
@@ -20 +20,0 @@
-old below
`);
	if (!unpaired) throw new Error("missing unpaired fixture");
	const rows = diffPresentationRows(unpaired, "split");
	const middle = rows[1]?.stops.find((stop) => stop.side === "additions");
	if (!middle) throw new Error("missing middle addition");

	expect(
		stopIdentity(switchSplitSelectionStop({ rows, current: middle, side: "deletions" })),
	).toEqual(["deletions", 20]);
});

test("split mixed selection is rectangular and canonical persistence coalesces each side", () => {
	const rows = diffPresentationRows(paneFile, "split");
	const anchor = rows[0]?.stops.find((stop) => stop.side === "additions");
	const focus = rows[1]?.stops.find((stop) => stop.side === "deletions");
	const live = rectangularSelectionBetween(rows, anchor, focus);
	if (!live) throw new Error("missing rectangular selection");
	expect(live.ranges).toHaveLength(4);
	expect(canonicalizeDiffSelection(live, paneFile)).toEqual({
		filePath: "panes.ts",
		ranges: [
			{ oldStart: 1, side: "deletions", startLine: 1, endLine: 2 },
			{ oldStart: 1, side: "additions", startLine: 1, endLine: 2 },
		],
	});
});

test("stacked visible motion follows old then new rows and counts context once", () => {
	const rows = diffPresentationRows(paneFile, "stack");
	expect(stackedVisibleSelectionStops(rows).map(stopIdentity)).toEqual([
		["deletions", 1],
		["deletions", 2],
		["additions", 1],
		["additions", 2],
		["additions", 3],
	]);
	let current = rows[0]?.stops[0];
	if (!current) throw new Error("missing stacked stop");
	const visited = [stopIdentity(current)];
	for (let index = 0; index < rows.length - 1; index += 1) {
		current = moveStackedSelectionStop({ rows, current, delta: 1 });
		visited.push(stopIdentity(current));
	}
	expect(visited).toEqual([
		["deletions", 1],
		["deletions", 2],
		["additions", 1],
		["additions", 2],
		["additions", 3],
	]);
});
