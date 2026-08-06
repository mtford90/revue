import type { DiffLayout } from "../../src/index.ts";

export type GoldenScenario = {
	/** File-name stem for this scenario's goldens. */
	name: string;
	/** What the rendering contract here is meant to protect. */
	covers: string;
	patch: string;
	widths: readonly number[];
	height: number;
};

const LAYOUTS: readonly DiffLayout[] = ["split", "stack"];

export const GOLDEN_LAYOUTS = LAYOUTS;

/** Wide enough for comfortable split panes, narrow enough to exercise cramped ones. */
const DEFAULT_WIDTHS = [48, 80] as const;
/** Forces wrapping in both layouts. */
const WRAP_WIDTHS = [36, 60] as const;

export const GOLDEN_SCENARIOS: readonly GoldenScenario[] = [
	{
		name: "single-char-edit",
		covers: "one changed character inside an equal-count pair",
		height: 8,
		widths: DEFAULT_WIDTHS,
		patch: `diff --git a/single.ts b/single.ts
--- a/single.ts
+++ b/single.ts
@@ -1,2 +1,2 @@
 const keep = true;
-const total = 1;
+const total = 2;
`,
	},
	{
		name: "word-edit",
		covers: "a whole word replaced inside an equal-count pair",
		height: 8,
		widths: DEFAULT_WIDTHS,
		patch: `diff --git a/word.ts b/word.ts
--- a/word.ts
+++ b/word.ts
@@ -1,2 +1,2 @@
 const keep = true;
-const label = "before";
+const label = "after";
`,
	},
	{
		name: "multi-edit-line",
		covers: "several separated edits on one line",
		height: 8,
		widths: DEFAULT_WIDTHS,
		patch: `diff --git a/multi.ts b/multi.ts
--- a/multi.ts
+++ b/multi.ts
@@ -1,1 +1,1 @@
-const rect = { x: 1, y: 2, w: 3 };
+const rect = { x: 9, y: 2, w: 7 };
`,
	},
	{
		name: "unequal-count-block",
		covers: "one deletion answered by two additions, with a dissimilar pair alongside",
		height: 10,
		widths: DEFAULT_WIDTHS,
		patch: `diff --git a/unequal.ts b/unequal.ts
--- a/unequal.ts
+++ b/unequal.ts
@@ -1,2 +1,3 @@
-const total = sum(a, b);
+const first = sum(a, b);
+const total = first * 2;
-throw new Error("gone");
+return { total };
`,
	},
	{
		name: "equal-count-block-gate",
		covers: "an equal-count block where only the alike pair earns emphasis",
		height: 10,
		widths: DEFAULT_WIDTHS,
		patch: `diff --git a/gate.ts b/gate.ts
--- a/gate.ts
+++ b/gate.ts
@@ -1,3 +1,3 @@
 const keep = true;
-const total = sum(a, b);
-throw new Error("gone");
+const total = sum(a, c);
+return { total };
`,
	},
	{
		name: "whitespace-only",
		covers: "trailing whitespace and re-indentation, where nothing visible changes",
		height: 9,
		widths: DEFAULT_WIDTHS,
		patch: `diff --git a/whitespace.ts b/whitespace.ts
--- a/whitespace.ts
+++ b/whitespace.ts
@@ -1,3 +1,3 @@
-const value = 1;   
+const value = 1;
-  const nested = 2;
+    const nested = 2;
 const after = 3;
`,
	},
	{
		name: "unicode",
		covers: "emoji, CJK, and combining marks against column widths",
		height: 9,
		widths: DEFAULT_WIDTHS,
		patch: `diff --git a/unicode.ts b/unicode.ts
--- a/unicode.ts
+++ b/unicode.ts
@@ -1,3 +1,3 @@
-const status = "ok 🚀";
+const status = "no 🐛";
-const label = "日本語のラベル";
+const label = "日本語の見出し";
-const name = "café";
+const name = "café";
`,
	},
	{
		name: "long-line-wrap",
		covers: "a wrapped line whose emphasis run crosses the wrap point",
		height: 14,
		widths: WRAP_WIDTHS,
		patch: `diff --git a/wrap.ts b/wrap.ts
--- a/wrap.ts
+++ b/wrap.ts
@@ -1,1 +1,1 @@
-const message = renderBanner("short tail", options);
+const message = renderBanner("a considerably longer tail that must wrap", options);
`,
	},
	{
		name: "wrapped-unicode",
		covers: "wide characters straddling a wrap boundary",
		height: 12,
		widths: WRAP_WIDTHS,
		patch: `diff --git a/wrap-unicode.ts b/wrap-unicode.ts
--- a/wrap-unicode.ts
+++ b/wrap-unicode.ts
@@ -1,1 +1,1 @@
-const notice = "短い";
+const notice = "日本語の長い注意書きです、折り返しを必ず跨ぎます";
`,
	},
	{
		name: "moved-block",
		covers: "a block deleted in one place and re-added in another",
		height: 18,
		widths: DEFAULT_WIDTHS,
		patch: `diff --git a/moved.ts b/moved.ts
--- a/moved.ts
+++ b/moved.ts
@@ -1,6 +1,6 @@
-const helper = () => 1;
-const other = () => 2;
 const first = () => 3;
 const second = () => 4;
 const third = () => 5;
+const helper = () => 1;
+const other = () => 2;
`,
	},
	{
		name: "empty-lines",
		covers: "blank lines added and removed around content",
		height: 11,
		widths: DEFAULT_WIDTHS,
		patch: `diff --git a/blank.ts b/blank.ts
--- a/blank.ts
+++ b/blank.ts
@@ -1,4 +1,4 @@
 const before = 1;
-
-const after = 2;
+const after = 2;
+
 const last = 3;
`,
	},
];
