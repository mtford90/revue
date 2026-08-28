import { expect, test } from "bun:test";
import { parsePatch } from "./model.ts";
import {
	diffSelectionStops,
	firstSelectionRange,
	normalizeDiffSelection,
	selectionBetween,
	selectionContains,
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
