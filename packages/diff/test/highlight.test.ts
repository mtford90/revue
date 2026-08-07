import { afterEach, expect, test } from "bun:test";
import {
	highlightedLines,
	prepareSyntaxHighlighting,
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
