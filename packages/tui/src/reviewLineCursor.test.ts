import { expect, test } from "bun:test";
import { createDiffFile, parsePatch, planDiff } from "@revue/diff";
import { OPENTUI_DIFF_CHROME } from "@revue/diff-opentui";
import {
	initialReviewLine,
	moveReviewLine,
	reviewableLines,
	reviewLineSelection,
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

test("review line order is identical across layouts, preferring replacements' current side", () => {
	const expected: Array<["additions" | "deletions", number, number]> = [
		["additions", 1, 1],
		["additions", 3, 1],
		["deletions", 10, 10],
	];
	const splitLines = reviewableLines(plan(PATCH, "split"));
	const stackLines = reviewableLines(plan(PATCH, "stack"));
	const identities = (lines: typeof splitLines) =>
		lines.map(({ side, startLine, hunkOldStart }) => [side, startLine, hunkOldStart]);

	expect(identities(splitLines)).toEqual(expected);
	expect(identities(stackLines)).toEqual(expected);
	expect(initialReviewLine(stackLines)).toEqual(stackLines[0] ?? null);
	expect(moveReviewLine({ lines: stackLines, current: stackLines[0] ?? null, delta: 1 })).toEqual(
		stackLines[1] ?? null,
	);
});

test("a deletion-only file starts and moves on its old side", () => {
	const lines = reviewableLines(
		plan(`diff --git a/gone.ts b/gone.ts
--- a/gone.ts
+++ /dev/null
@@ -4,2 +0,0 @@
-first
-second
`),
	);
	expect(initialReviewLine(lines)).toMatchObject({ side: "deletions", startLine: 4 });
	expect(moveReviewLine({ lines, current: lines[0] ?? null, delta: 1 })).toMatchObject({
		side: "deletions",
		startLine: 5,
	});
});

test("selection extends inclusively but stops at a hunk or side boundary", () => {
	const lines = reviewableLines(plan(PATCH, "stack"));
	const anchor = lines.find((line) => line.side === "additions" && line.startLine === 1);
	if (!anchor) throw new Error("missing test anchor");
	const extended = moveReviewLine({ lines, current: anchor, delta: 1, selectionAnchor: anchor });
	expect(extended).toMatchObject({ side: "additions", startLine: 3 });
	expect(reviewLineSelection(anchor, extended ?? anchor)).toMatchObject({
		startLine: 1,
		endLine: 3,
	});
	const stopped = moveReviewLine({
		lines,
		current: extended,
		delta: 1,
		selectionAnchor: anchor,
	});
	expect(stopped).toEqual(extended);
});
