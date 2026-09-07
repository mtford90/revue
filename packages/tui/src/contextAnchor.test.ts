import { expect, test } from "bun:test";
import { CONTEXT_HUNK_OLD_START, parsePatch } from "@revue/diff";
import { type Chapter, THREAD_ANCHOR_KIND } from "@revue/types";
import {
	chapterOwnsContextAnchor,
	contextAnchorFor,
	contextSelectionKind,
	gitRangeResolver,
	newLineForOld,
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

const context = (line: number) => ({
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

test("a revealed old-side line names the same new-side line, shifted by the hunks above it", () => {
	expect(newLineForOld(hunks, 10)).toBe(10);
	expect(newLineForOld(hunks, 40)).toBe(40);
	// The deletion at old line 56 pulls every later line up by one.
	expect(newLineForOld(hunks, 70)).toBe(69);
	expect(resolve("deletions", 70)).toEqual(context(69));
});

test("a selection is context only when every range is revealed context", () => {
	const revealed = {
		oldStart: CONTEXT_HUNK_OLD_START,
		side: "additions",
		startLine: 30,
		endLine: 31,
	};
	const changed = { oldStart: 18, side: "additions", startLine: 21, endLine: 21 };
	const filePath = "sample.txt";
	expect(contextSelectionKind({ filePath, ranges: [changed] })).toBe("patch");
	expect(contextSelectionKind({ filePath, ranges: [revealed] })).toBe("context");
	expect(contextSelectionKind({ filePath, ranges: [changed, revealed] })).toBe("mixed");
	expect(
		contextAnchorFor({ filePath, ranges: [revealed, { ...revealed, startLine: 33, endLine: 34 }] }),
	).toEqual({ kind: THREAD_ANCHOR_KIND.CONTEXT, filePath, startLine: 30, endLine: 34 });
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
