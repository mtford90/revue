import { expect, test } from "bun:test";
import {
	CONTEXT_HUNK_OLD_START,
	type DiffLineRange,
	type DiffSelectionRange,
	parsePatch,
} from "@revue/diff";
import { type Chapter, THREAD_ANCHOR_KIND } from "@revue/types";
import {
	chapterOwnsContextAnchor,
	contextSelectionKind,
	displayRangesForContext,
	gitRangeResolver,
	newLineForOld,
	newRangeForOldContext,
	selectionAnchorFor,
} from "./contextAnchor.ts";

// Two hunks: line 21 replaced, old line 56 deleted, so old and new numbering diverge below it.
const PATCH = [
	"--- a/sample.txt",
	"+++ b/sample.txt",
	"@@ -18,7 +18,7 @@",
	" line 18",
	" line 19",
	" line 20",
	"-line 21",
	"+line 21 changed",
	" line 22",
	" line 23",
	" line 24",
	"@@ -53,7 +53,6 @@",
	" line 53",
	" line 54",
	" line 55",
	"-line 56",
	" line 57",
	" line 58",
	" line 59",
	"",
].join("\n");

const diffFiles = parsePatch(PATCH);
const hunks = diffFiles[0]?.metadata.hunks ?? [];
const resolve = gitRangeResolver(diffFiles, "sample.txt");

const context = (line: number): DiffLineRange => ({
	filePath: "sample.txt",
	hunkOldStart: CONTEXT_HUNK_OLD_START,
	side: "additions",
	startLine: line,
	endLine: line,
});

test("lines inside a git hunk resolve to that review unit, revealed lines to context", () => {
	expect(resolve("additions", 21)).toEqual({
		filePath: "sample.txt",
		hunkOldStart: 18,
		side: "additions",
		startLine: 21,
		endLine: 21,
	});
	expect(resolve("deletions", 56)).toMatchObject({ hunkOldStart: 53, side: "deletions" });
	expect(resolve("additions", 10)).toEqual(context(10));
	expect(resolve("additions", 40)).toEqual(context(40));
});

test("revealed old-side context preserves its original side and coordinate", () => {
	expect(newLineForOld(hunks, 10)).toBe(10);
	expect(newLineForOld(hunks, 40)).toBe(40);
	expect(newLineForOld(hunks, 70)).toBe(69);
	expect(resolve("deletions", 70)).toEqual({
		filePath: "sample.txt",
		hunkOldStart: CONTEXT_HUNK_OLD_START,
		side: "deletions",
		startLine: 70,
		endLine: 70,
	});
	expect(newRangeForOldContext(hunks, 70, 71)).toEqual({ startLine: 69, endLine: 70 });
	// A durable context selection must never map changed old-side code into expansion geometry.
	expect(newRangeForOldContext(hunks, 56, 56)).toBeNull();
});

test("carried context display geometry splits revealed and original-hunk rows", () => {
	expect(displayRangesForContext(hunks, "additions", 16, 19)).toEqual([
		{ oldStart: CONTEXT_HUNK_OLD_START, side: "additions", startLine: 16, endLine: 17 },
		{ oldStart: 18, side: "additions", startLine: 18, endLine: 19 },
	]);
	expect(displayRangesForContext(hunks, "deletions", 54, 55)).toEqual([
		{ oldStart: 53, side: "deletions", startLine: 54, endLine: 55 },
	]);
	expect(displayRangesForContext(hunks, "deletions", 60, 61)).toEqual([
		{ oldStart: CONTEXT_HUNK_OLD_START, side: "deletions", startLine: 60, endLine: 61 },
	]);
});

test("a selection is context only when every range is revealed context", () => {
	const revealed: DiffSelectionRange = {
		oldStart: CONTEXT_HUNK_OLD_START,
		side: "additions",
		startLine: 30,
		endLine: 31,
	};
	const changed: DiffSelectionRange = {
		oldStart: 18,
		side: "additions",
		startLine: 21,
		endLine: 21,
	};
	const filePath = "sample.txt";
	expect(contextSelectionKind({ filePath, ranges: [changed] })).toBe("patch");
	expect(contextSelectionKind({ filePath, ranges: [revealed] })).toBe("context");
	expect(contextSelectionKind({ filePath, ranges: [changed, revealed] })).toBe("mixed");
	expect(
		selectionAnchorFor({ filePath, ranges: [changed, { ...revealed, side: "deletions" }] }),
	).toEqual({
		kind: "selection",
		filePath,
		segments: [
			{ kind: "patch", oldStart: 18, side: "additions", startLine: 21, endLine: 21 },
			{ kind: "context", side: "deletions", startLine: 30, endLine: 31 },
		],
	});
});

test("revealed context belongs to the chapter narrating the nearest hunk of its file", () => {
	const chapter = (id: string, oldStart: number): Chapter => ({
		id,
		order: 1,
		title: id,
		summary: "",
		hunkRefs: [{ filePath: "sample.txt", oldStart }],
		keyChanges: [],
		excerpts: [],
	});
	const [upper, lower] = [chapter("upper", 18), chapter("lower", 53)];
	const anchor = (startLine: number, endLine: number) => ({
		kind: THREAD_ANCHOR_KIND.CONTEXT,
		filePath: "sample.txt",
		startLine,
		endLine,
	});
	expect(chapterOwnsContextAnchor(upper, diffFiles, anchor(30, 31))).toBe(true);
	expect(chapterOwnsContextAnchor(lower, diffFiles, anchor(30, 31))).toBe(false);
	expect(chapterOwnsContextAnchor(upper, diffFiles, anchor(45, 46))).toBe(false);
	expect(chapterOwnsContextAnchor(lower, diffFiles, anchor(45, 46))).toBe(true);
	// Without hunks to measure against, any chapter naming the file reads it.
	expect(chapterOwnsContextAnchor(lower, null, anchor(30, 31))).toBe(true);
	expect(
		chapterOwnsContextAnchor(chapter("other", 1), null, { ...anchor(1, 1), filePath: "x" }),
	).toBe(false);
});
