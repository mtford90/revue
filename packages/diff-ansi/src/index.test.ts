import { expect, test } from "bun:test";
import { parsePatch } from "@revue/diff";
import { resolveTheme, withTransparentSurfaces } from "@revue/theme";
import { formatAnsiDiffFile } from "./index.ts";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI control parsing is intentional.
const strip = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
const patch = `diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-const old = "界";
+const next = "界";
`;

test("formats a complete split envelope with bounded visible rows and resets", () => {
	const file = parsePatch(patch)[0];
	if (!file) throw new Error("fixture did not parse");
	const output = formatAnsiDiffFile({
		file,
		layout: "split",
		width: 80,
		lineNumbers: true,
		changeMarkers: true,
		theme: withTransparentSurfaces(resolveTheme("ayu-dark")),
	});
	expect(output).toContain("a.ts  +1 -1");
	expect(output).toContain("@@ -1 +1 @@");
	expect(output).toContain("│");
	for (const line of output.split("\n").filter(Boolean)) {
		expect(line.endsWith("\x1b[0m")).toBe(true);
		expect(Bun.stringWidth(strip(line))).toBeLessThanOrEqual(80);
	}
});

test("truncates file and hunk headers by terminal columns", () => {
	const file = parsePatch(`diff --git a/界界界界界界 b/界界界界界界
index 1111111..2222222 100644
--- a/界界界界界界
+++ b/界界界界界界
@@ -1 +1 @@ a very long ���界界 context
-old
+new
`)[0];
	if (!file) throw new Error("fixture did not parse");
	for (const line of formatAnsiDiffFile({
		file,
		layout: "stack",
		width: 12,
		lineNumbers: true,
		changeMarkers: true,
		theme: resolveTheme("ayu-dark"),
	})
		.split("\n")
		.filter(Boolean))
		expect(Bun.stringWidth(strip(line))).toBeLessThanOrEqual(12);
});

test("separates old and new stacked gutter values", () => {
	const file = parsePatch(`diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -3,2 +9,2 @@
 context one
 context two
`)[0];
	if (!file) throw new Error("fixture did not parse");
	const output = strip(
		formatAnsiDiffFile({
			file,
			layout: "stack",
			width: 40,
			lineNumbers: true,
			changeMarkers: true,
			theme: resolveTheme("ayu-dark"),
		}),
	);
	expect(output).toContain(" 3  9    context one");
	expect(output).toContain(" 4 10    context two");
});

test("uses both planned stack gutters for changed lines", () => {
	const file = parsePatch(patch)[0];
	if (!file) throw new Error("fixture did not parse");
	const output = strip(
		formatAnsiDiffFile({
			file,
			layout: "stack",
			width: 40,
			lineNumbers: true,
			changeMarkers: true,
			theme: resolveTheme("ayu-dark"),
		}),
	);
	expect(output).toContain("1   -  const old");
	expect(output).toContain("  1 +  const next");
});

test("renders all chrome combinations at exact narrow and wide bounds", () => {
	const file = parsePatch(patch)[0];
	if (!file) throw new Error("fixture did not parse");
	for (const layout of ["stack", "split"] as const) {
		for (const width of [24, 80]) {
			for (const lineNumbers of [false, true]) {
				for (const changeMarkers of [false, true]) {
					const output = formatAnsiDiffFile({
						file,
						layout,
						width,
						lineNumbers,
						changeMarkers,
						theme: resolveTheme("ayu-dark"),
					});
					for (const line of strip(output).split("\n").filter(Boolean))
						expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width);
					const body = strip(output).split("\n").slice(2).join("\n");
					expect(body.includes("-")).toBe(changeMarkers);
				}
			}
		}
	}
});

test("colours changed numbers by side and context numbers neutrally in both layouts", () => {
	const file = parsePatch(
		`diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,2 +1,2 @@\n context\n-old\n+new\n`,
	)[0];
	if (!file) throw new Error("fixture did not parse");
	const theme = resolveTheme("ayu-dark");
	const rgb = (colour: string) => {
		const hex = colour.slice(1);
		return `${Number.parseInt(hex.slice(0, 2), 16)};${Number.parseInt(hex.slice(2, 4), 16)};${Number.parseInt(hex.slice(4, 6), 16)}`;
	};
	for (const layout of ["stack", "split"] as const) {
		const output = formatAnsiDiffFile({
			file,
			layout,
			width: 80,
			lineNumbers: true,
			changeMarkers: false,
			theme,
		});
		expect(output).toContain(`\x1b[38;2;${rgb(theme.lineNumberFg)};`);
		expect(output).toContain(`\x1b[38;2;${rgb(theme.removedSignColor)};`);
		expect(output).toContain(`\x1b[38;2;${rgb(theme.addedSignColor)};`);
	}
});

test.each([
	[
		"rename",
		`diff --git a/old b/new
similarity index 100%
rename from old
rename to new
`,
		"Renamed without changes.",
	],
	[
		"mode",
		`diff --git a/a b/a
old mode 100644
new mode 100755
`,
		"Mode 100644 -> 100755.",
	],
	[
		"new empty",
		`diff --git a/a b/a
new file mode 100644
--- /dev/null
+++ b/a
`,
		"New empty file.",
	],
	[
		"deleted",
		`diff --git a/a b/a
deleted file mode 100644
--- a/a
+++ /dev/null
`,
		"Deleted file.",
	],
])("formats %s metadata visibly", (_name, source, message) => {
	const file = parsePatch(source)[0];
	if (!file) throw new Error("fixture did not parse");
	expect(
		strip(
			formatAnsiDiffFile({
				file,
				layout: "stack",
				width: 40,
				lineNumbers: true,
				changeMarkers: true,
				theme: resolveTheme("ayu-dark"),
			}),
		),
	).toContain(message);
});

test("formats generic and too-large metadata outcomes visibly", () => {
	const source = parsePatch(patch)[0];
	if (!source) throw new Error("fixture did not parse");
	const generic = {
		...source,
		metadata: { ...source.metadata, hunks: [], prevMode: undefined, mode: undefined },
	};
	const tooLarge = { ...generic, isTooLarge: true };
	for (const [file, message] of [
		[generic, "No text changes."],
		[tooLarge, "Diff too large to display."],
	] as const)
		expect(
			strip(
				formatAnsiDiffFile({
					file,
					layout: "stack",
					width: 40,
					lineNumbers: true,
					changeMarkers: true,
					theme: resolveTheme("ayu-dark"),
				}),
			),
		).toContain(message);
});

test("formats metadata-only binary files visibly", () => {
	const file = parsePatch(`diff --git a/blob b/blob
index 1111111..2222222 100644
Binary files a/blob and b/blob differ
`)[0];
	if (!file) throw new Error("fixture did not parse");
	expect(
		strip(
			formatAnsiDiffFile({
				file,
				layout: "stack",
				width: 40,
				lineNumbers: true,
				changeMarkers: true,
				theme: resolveTheme("ayu-dark"),
			}),
		),
	).toContain("Binary file differs.");
});
