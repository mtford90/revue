import { expect, test } from "bun:test";
import {
	buildDiffRows,
	findFocusedDecorationAnchor,
	inferLanguage,
	parsePatch,
	type RangeDecoration,
	rangeToHunkIndex,
} from "../src/index.ts";

const PATCH = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -10,4 +10,5 @@ export function example() {
 const keep = true;
-old eleven
-old twelve
+new eleven
+new twelve
+new thirteen
 return keep;
diff --git a/.env.local b/.env.local
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/.env.local
@@ -0,0 +1,2 @@
+API_URL=http://localhost
+DEBUG=true
`;

const files = parsePatch(PATCH, "fixture");
const source = files[0];
if (!source) throw new Error("missing source fixture");

test("patch parsing keeps stable paths, stats, hunk starts, and inferred languages", () => {
	expect(files.map((file) => file.path)).toEqual(["src/example.ts", ".env.local"]);
	expect(files.map((file) => file.stats)).toEqual([
		{ additions: 3, deletions: 2 },
		{ additions: 2, deletions: 0 },
	]);
	expect(files.map((file) => file.metadata.hunks[0]?.deletionStart)).toEqual([10, 0]);
	expect(files.map((file) => file.language)).toEqual(["typescript", "dotenv"]);
	expect(inferLanguage("unknown.extension-no-grammar")).toBe("text");
});

test("split and stack rows preserve old and new line identities", () => {
	const split = buildDiffRows(source, "split").filter((row) => row.type === "split-line");
	expect(split.map((row) => [row.old.oldLineNumber, row.new.newLineNumber])).toEqual([
		[10, 10],
		[11, 11],
		[12, 12],
		[undefined, 13],
		[13, 14],
	]);

	const stack = buildDiffRows(source, "stack").filter((row) => row.type === "stack-line");
	expect(
		stack.map((row) => [row.cell.kind, row.cell.oldLineNumber, row.cell.newLineNumber]),
	).toEqual([
		["context", 10, 10],
		["deletion", 11, undefined],
		["deletion", 12, undefined],
		["addition", undefined, 11],
		["addition", undefined, 12],
		["addition", undefined, 13],
		["context", 13, 14],
	]);
});

test("inclusive decorations affect only requested sides and lines and support multiple ranges", () => {
	const decorations: RangeDecoration[] = [
		{
			id: "old-11",
			focusId: "key-change",
			filePath: "src/example.ts",
			side: "deletions",
			startLine: 11,
			endLine: 11,
		},
		{
			id: "new-12-13",
			focusId: "key-change",
			filePath: "src/example.ts",
			side: "additions",
			startLine: 12,
			endLine: 13,
		},
	];
	const rows = buildDiffRows(source, "split", decorations, "key-change").filter(
		(row) => row.type === "split-line",
	);

	expect(
		rows.map((row) => ({
			old: row.old.decorations.deletions ?? [],
			new: row.new.decorations.additions ?? [],
			oldFocused: row.old.focusedSides,
			newFocused: row.new.focusedSides,
		})),
	).toEqual([
		{ old: [], new: [], oldFocused: [], newFocused: [] },
		{ old: ["old-11"], new: [], oldFocused: ["deletions"], newFocused: [] },
		{ old: [], new: ["new-12-13"], oldFocused: [], newFocused: ["additions"] },
		{ old: [], new: ["new-12-13"], oldFocused: [], newFocused: ["additions"] },
		{ old: [], new: [], oldFocused: [], newFocused: [] },
	]);

	expect(findFocusedDecorationAnchor(source, decorations, "key-change")).toEqual({
		decorationId: "old-11",
		focusId: "key-change",
		fileId: source.id,
		filePath: "src/example.ts",
		hunkIndex: 0,
		side: "deletions",
		lineNumber: 11,
	});
});

test("range-to-hunk treats zero-count sides as empty", () => {
	const env = files[1];
	if (!env) throw new Error("missing env fixture");
	expect(rangeToHunkIndex(env, { side: "deletions", startLine: 1, endLine: 1 })).toBe(-1);
	expect(rangeToHunkIndex(env, { side: "additions", startLine: 1, endLine: 1 })).toBe(0);
});
