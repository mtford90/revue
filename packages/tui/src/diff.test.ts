import { expect, test } from "bun:test";
import { parsePatch } from "@revue/diff-renderer";
import type { Chapter, LineRef } from "@revue/types";
import { hunkIndexForLineRef, selectChapterFiles } from "./diff.ts";

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -2,1 +2,1 @@
-old two
+new two
@@ -20,3 +30,4 @@
-old twenty
-old twenty-one
-old twenty-two
+new thirty
+new thirty-one
+new thirty-two
+new thirty-three
diff --git a/src/b.ts b/src/b.ts
index 3333333..4444444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -5,1 +5,1 @@
-old five
+new five
diff --git a/src/deleted.ts b/src/deleted.ts
deleted file mode 100644
index 5555555..0000000
--- a/src/deleted.ts
+++ /dev/null
@@ -10,2 +10,0 @@
-old ten
-old eleven
`;

const files = parsePatch(PATCH);

const chapter = (hunkRefs: Chapter["hunkRefs"]): Chapter => ({
	id: "chapter",
	order: 1,
	title: "Chapter",
	summary: "Summary",
	hunkRefs,
	keyChanges: [],
});

const lineRef = (ref: Partial<LineRef>): LineRef => ({
	filePath: "src/a.ts",
	side: "additions",
	startLine: 1,
	endLine: 1,
	...ref,
});

test("selectChapterFiles keeps only referenced hunks and skips missing references", () => {
	const selected = selectChapterFiles(
		chapter([
			{ filePath: "src/a.ts", oldStart: 20 },
			{ filePath: "src/missing.ts", oldStart: 1 },
			{ filePath: "src/b.ts", oldStart: 5 },
		]),
		files,
	);

	expect(selected.map((file) => file.chapterPath)).toEqual(["src/a.ts", "src/b.ts"]);
	expect(selected[0]?.metadata.hunks.map((hunk) => hunk.deletionStart)).toEqual([20]);
	expect(selected[1]?.metadata.hunks.map((hunk) => hunk.deletionStart)).toEqual([5]);
});

test("hunkIndexForLineRef matches inclusive old and new hunk boundaries", () => {
	const file = files.find((candidate) => candidate.path === "src/a.ts");
	expect(file).toBeDefined();
	if (!file) return;

	expect(hunkIndexForLineRef(file, lineRef({ startLine: 30, endLine: 30 }))).toBe(1);
	expect(hunkIndexForLineRef(file, lineRef({ startLine: 33, endLine: 33 }))).toBe(1);
	expect(
		hunkIndexForLineRef(file, lineRef({ side: "deletions", startLine: 20, endLine: 20 })),
	).toBe(1);
	expect(
		hunkIndexForLineRef(file, lineRef({ side: "deletions", startLine: 22, endLine: 22 })),
	).toBe(1);
	expect(hunkIndexForLineRef(file, lineRef({ startLine: 34, endLine: 34 }))).toBe(-1);
});

test("chapter selection retains referenced files without textual hunks", () => {
	const binaryFiles = parsePatch(`diff --git a/image.png b/image.png
index 1111111..2222222 100644
Binary files a/image.png and b/image.png differ
`);
	const selected = selectChapterFiles(
		chapter([{ filePath: "image.png", oldStart: 0 }]),
		binaryFiles,
	);

	expect(selected.map((file) => [file.chapterPath, file.isBinary])).toEqual([["image.png", true]]);
});

test("chapter selection preserves a tracked leading a directory", () => {
	const leadingDirectoryFiles = parsePatch(`diff --git a/a/file.ts b/a/file.ts
--- a/a/file.ts
+++ b/a/file.ts
@@ -1 +1 @@
-old
+new
`);
	const selected = selectChapterFiles(
		chapter([{ filePath: "a/file.ts", oldStart: 1 }]),
		leadingDirectoryFiles,
	);

	expect(selected.map((file) => file.chapterPath)).toEqual(["a/file.ts"]);
	expect(selected[0]?.path).toBe("a/file.ts");
});

test("hunkIndexForLineRef ignores a diff side with no lines", () => {
	const file = files.find((candidate) => candidate.path === "src/deleted.ts");
	expect(file).toBeDefined();
	if (!file) return;

	expect(
		hunkIndexForLineRef(
			file,
			lineRef({
				filePath: "src/deleted.ts",
				side: "additions",
				startLine: 10,
				endLine: 10,
			}),
		),
	).toBe(-1);
});
