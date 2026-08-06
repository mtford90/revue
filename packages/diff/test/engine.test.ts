import { expect, test } from "bun:test";
import { applicableDecorations } from "../src/decorations.ts";
import {
	findFocusedDecorationAnchor,
	inferLanguage,
	parsePatch,
	prepareSyntaxHighlighting,
	type RangeDecoration,
	rangeToHunkIndex,
} from "../src/index.ts";
import { buildDiffRows } from "../src/rows.ts";
import { sanitizeTerminalSpans } from "../src/terminalText.ts";

const SYNTAX_THEME = "catppuccin-mocha";

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
	expect(applicableDecorations(source, decorations)).toEqual(decorations);

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

test("Pierre-normalized names preserve a real leading a directory for range matching", () => {
	const [file] = parsePatch(`diff --git a/a/file.ts b/a/file.ts
--- a/a/file.ts
+++ b/a/file.ts
@@ -1 +1 @@
-old
+new
`);
	if (!file) throw new Error("missing fixture");
	const decoration: RangeDecoration = {
		id: "real-a-path",
		filePath: "a/file.ts",
		side: "additions",
		startLine: 1,
		endLine: 1,
	};

	expect(file.path).toBe("a/file.ts");
	expect(applicableDecorations(file, [decoration])).toEqual([decoration]);
});

test("binary detection is scoped to each file patch chunk", () => {
	const parsed = parsePatch(`diff --git a/image.png b/image.png
index 1111111..2222222 100644
Binary files a/image.png and b/image.png differ
diff --git a/safe.ts b/safe.ts
--- a/safe.ts
+++ b/safe.ts
@@ -1 +1 @@
-old
+new
`);

	expect(parsed.map((file) => [file.path, file.isBinary])).toEqual([
		["image.png", true],
		["safe.ts", false],
	]);
	expect(parsed[0]?.patch).toContain("Binary files");
	expect(parsed[0]?.patch).not.toContain("safe.ts");
	expect(parsed[1]?.patch).not.toContain("Binary files");
});

test("plain unified patches keep file paths and binary state isolated", () => {
	const parsed = parsePatch(`--- a/safe.ts
+++ b/safe.ts
@@ -1 +1 @@
-old
+new
--- a/image.png
+++ b/image.png
Binary files a/image.png and b/image.png differ
`);

	expect(parsed.map((file) => [file.path, file.isBinary])).toEqual([
		["safe.ts", false],
		["image.png", true],
	]);
	expect(parsed[0]?.patch).not.toContain("image.png");
	expect(parsed[1]?.patch).not.toContain("safe.ts");
});

test("diff content resembling file headers stays inside its hunk", () => {
	for (const prefix of ["diff --git a/flags.txt b/flags.txt\n", ""]) {
		const [file] = parsePatch(`${prefix}--- a/flags.txt
+++ b/flags.txt
@@ -1 +1 @@
--- old
+++ new
`);

		expect(file?.path).toBe("flags.txt");
		expect(file?.stats).toEqual({ additions: 1, deletions: 1 });
		expect(file?.metadata.hunks).toHaveLength(1);
	}
});

test("mixed patch headers retain every file boundary", () => {
	const parsed = parsePatch(`--- a/plain.ts
+++ b/plain.ts
@@ -1 +1 @@
-old
+new
diff --git a/git.ts b/git.ts
--- a/git.ts
+++ b/git.ts
@@ -1 +1 @@
-before
+after
`);

	expect(parsed.map((file) => file.path)).toEqual(["plain.ts", "git.ts"]);
	expect(parsed[0]?.patch).not.toContain("diff --git");
	expect(parsed[1]?.patch).toStartWith("diff --git");
});

test("plain add and delete patches retain their change types", () => {
	const parsed = parsePatch(`--- /dev/null
+++ b/new.ts
@@ -0,0 +1 @@
+new
--- a/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-old
`);

	expect(parsed.map((file) => [file.path, file.metadata.type])).toEqual([
		["new.ts", "new"],
		["old.ts", "deleted"],
	]);
});

test.each([
	{
		side: "addition",
		marker: "+",
		oldPath: "/dev/null",
		newPath: "b/space.txt",
		hunk: "@@ -0,0 +1 @@",
	},
	{
		side: "deletion",
		marker: "-",
		oldPath: "a/space.txt",
		newPath: "/dev/null",
		hunk: "@@ -1 +0,0 @@",
	},
] as const)("preserves trailing whitespace on final and intermediate $side lines", ({
	marker,
	oldPath,
	newPath,
	hunk,
}) => {
	const changedLine = `${marker}value \t`;
	const header = `--- ${oldPath}\n+++ ${newPath}\n${hunk}\n`;
	for (const suffix of ["", "\n--- a/next.txt\n+++ b/next.txt\n@@ -1 +1 @@\n-before\n+after\n"]) {
		const [file] = parsePatch(`${header}${changedLine}${suffix}`);
		if (!file) throw new Error("missing whitespace fixture");
		const lines = marker === "+" ? file.metadata.additionLines : file.metadata.deletionLines;

		expect(lines).toEqual(["value \t\n"]);
		expect(file.patch).toBe(`${header}${changedLine}\n`);
	}
});

test("TypeScript patches produce syntax-coloured terminal spans", async () => {
	const [file] = parsePatch(`diff --git a/example.ts b/example.ts
--- a/example.ts
+++ b/example.ts
@@ -1 +1 @@
-const answer = 41;
+const answer: number = 42;
`);
	if (!file) throw new Error("missing fixture");
	await prepareSyntaxHighlighting([file], SYNTAX_THEME);
	const row = buildDiffRows(file, "stack", { syntaxTheme: SYNTAX_THEME }).find(
		(candidate) => candidate.type === "stack-line" && candidate.cell.kind === "addition",
	);
	if (row?.type !== "stack-line") throw new Error("missing highlighted row");

	const colours = new Set(row.cell.spans.map((span) => span.fg).filter(Boolean));
	expect(colours.size).toBeGreaterThan(1);
});

test("terminal-bound raw lines and highlighted spans contain no unsafe controls", () => {
	const osc = "\x1b]52;c;SGVsbG8=\x07";
	const [file] = parsePatch(`diff --git a/safe.txt b/safe.txt
--- a/safe.txt
+++ b/safe.txt
@@ -1 +1 @@
-old
+before\x1b[2Jmiddle\x07${osc}after\tunicode ✓
`);
	if (!file) throw new Error("missing fixture");
	const row = buildDiffRows(file, "stack").find(
		(candidate) => candidate.type === "stack-line" && candidate.cell.kind === "addition",
	);
	if (row?.type !== "stack-line") throw new Error("missing addition row");
	const spans = sanitizeTerminalSpans([
		{ text: `before\x1b[2J${osc}`, fg: "#fff" },
		{ text: "after\x07\t✓" },
	]);
	const rendered = `${row.cell.text}${row.cell.spans.map((span) => span.text).join("")}${spans
		.map((span) => span.text)
		.join("")}`;

	expect(rendered).toContain("beforemiddleafter  unicode ✓");
	expect(rendered).toContain("after  ✓");
	expect(
		[...rendered].some((character) => {
			const code = character.charCodeAt(0);
			return code <= 8 || (code >= 10 && code <= 31) || (code >= 127 && code <= 159);
		}),
	).toBe(false);
});
