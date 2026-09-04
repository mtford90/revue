import { afterEach, expect, test } from "bun:test";
import {
	highlightedLines,
	prepareQuotedSyntaxHighlighting,
	prepareSyntaxHighlighting,
	quotedLineSpans,
	setNativeHighlighterForTesting,
} from "../src/highlight.ts";
import { parsePatch } from "../src/model.ts";

const originalEngine = process.env.REVUE_SYNTAX_ENGINE;
afterEach(() => {
	if (originalEngine === undefined) delete process.env.REVUE_SYNTAX_ENGINE;
	else process.env.REVUE_SYNTAX_ENGINE = originalEngine;
	setNativeHighlighterForTesting(undefined);
});

test("keeps exact ordered multiline text when Shiki is forced", async () => {
	process.env.REVUE_SYNTAX_ENGINE = "shiki";
	const [file] = parsePatch(`diff --git a/example.py b/example.py
--- a/example.py
+++ b/example.py
@@ -1,4 +1,5 @@
-def greeting():
-	return "hello"
+def greeting(name):
+	return f"hello, {name} 👋"
+
+# end
 `);
	if (!file) throw new Error("missing source fixture");

	const preparation = await prepareSyntaxHighlighting([file], "catppuccin-mocha");
	const additions = highlightedLines(file, "catppuccin-mocha")?.additions ?? [];

	expect(preparation).toEqual({ backend: "shiki" });
	expect(additions.map((line) => line.map((span) => span.text).join(""))).toEqual(
		file.metadata.additionLines,
	);
});

test("uses Shiki spans after an already-loaded native highlighter throws", async () => {
	delete process.env.REVUE_SYNTAX_ENGINE;
	setNativeHighlighterForTesting({
		highlight() {
			throw new Error("native runtime failure");
		},
	});
	const [file] = parsePatch(`diff --git a/example.ts b/example.ts
--- a/example.ts
+++ b/example.ts
@@ -1 +1 @@
-const answer = 41;
+const answer: number = 42;
`);
	if (!file) throw new Error("missing source fixture");

	const preparation = await prepareSyntaxHighlighting([file], "catppuccin-mocha");
	const spans = highlightedLines(file, "catppuccin-mocha")?.additions[0] ?? [];

	expect(preparation).toMatchObject({ backend: "shiki", warning: { code: "native-unavailable" } });
	expect(new Set(spans.map((span) => span.fg).filter(Boolean)).size).toBeGreaterThan(1);
});

test("colours quoted code from its path alone, one entry per cited line", async () => {
	process.env.REVUE_SYNTAX_ENGINE = "shiki";
	// Frozen citations carry no line endings, so tokenising must not run the range together.
	const quotation = {
		path: "src/api/client.ts",
		lines: ["export class ApiClient {", "  send(request: Request) {}", "}"],
	};

	const preparation = await prepareQuotedSyntaxHighlighting([quotation], "catppuccin-mocha");
	const spans = quotedLineSpans(quotation, "catppuccin-mocha") ?? [];

	expect(preparation).toEqual({ backend: "shiki" });
	expect(spans).toHaveLength(quotation.lines.length);
	expect(
		spans.map((line) =>
			line
				.map((span) => span.text)
				.join("")
				.trimEnd(),
		),
	).toEqual(quotation.lines);
	expect(new Set(spans[0]?.map((span) => span.fg).filter(Boolean)).size).toBeGreaterThan(1);
});

test("quoted code has no colours until something has been prepared for it", () => {
	process.env.REVUE_SYNTAX_ENGINE = "shiki";
	const quotation = { path: "src/api/other.ts", lines: ["const answer = 42;"] };

	expect(quotedLineSpans(quotation, "catppuccin-mocha")).toBeUndefined();
	expect(quotedLineSpans(quotation, undefined)).toBeUndefined();
});

// A patch's hunks are discontiguous, so grammar state at the end of one must not leak into the
// next: a hunk that ends inside a comment or string would otherwise colour everything after it.
const hunkLeakPatch = `diff --git a/example.ts b/example.ts
--- a/example.ts
+++ b/example.ts
@@ -1,3 +1,3 @@
 export const first = 1;
-/* an old note
+/* a new note
    that continues
@@ -40,3 +40,3 @@
 export const second = 2;
-const answer = 41;
+const answer: number = 42;
 export const third = 3;
`;

const coloursOf = (spans: readonly { fg?: string }[] | undefined) =>
	new Set((spans ?? []).map((span) => span.fg).filter(Boolean)).size;

for (const engine of ["syntect", "shiki"] as const) {
	test(`${engine}: a hunk ending inside a comment leaves the next hunk coloured`, async () => {
		process.env.REVUE_SYNTAX_ENGINE = engine;
		const [file] = parsePatch(hunkLeakPatch);
		if (!file) throw new Error("missing source fixture");
		const secondHunk = file.metadata.hunks[1];
		if (!secondHunk) throw new Error("fixture needs two hunks");

		await prepareSyntaxHighlighting([file], "catppuccin-mocha");
		const highlighted = highlightedLines(file, "catppuccin-mocha");
		const additions = highlighted?.additions ?? [];
		const deletions = highlighted?.deletions ?? [];

		expect(additions).toHaveLength(file.metadata.additionLines.length);
		expect(coloursOf(additions[secondHunk.additionLineIndex])).toBeGreaterThan(1);
		expect(coloursOf(additions[secondHunk.additionLineIndex + 1])).toBeGreaterThan(1);
		expect(coloursOf(deletions[secondHunk.deletionLineIndex])).toBeGreaterThan(1);
	});
}
