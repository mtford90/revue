import { afterEach, expect, test } from "bun:test";
import { testRender as renderOpenTui } from "@opentui/react/test-utils";
import { parsePatch, planDiff, prepareSyntaxHighlighting } from "@revue/diff";
import { resolveTheme } from "@revue/theme";
import { act } from "react";
import { DiffBody, DiffFileHeader, diffLineId, OPENTUI_DIFF_CHROME } from "../src/index.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = resolveTheme("catppuccin-mocha");

const activeRenderers: Awaited<ReturnType<typeof renderOpenTui>>["renderer"][] = [];

const testRender = async (...args: Parameters<typeof renderOpenTui>) => {
	const result = await renderOpenTui(...args);
	activeRenderers.push(result.renderer);
	return result;
};

afterEach(async () => {
	for (const renderer of activeRenderers.splice(0)) {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		await act(async () => renderer.destroy());
	}
});

const patch = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
-old one
-old two
+new one
+new two
`;

test("focused ranges render visibly on only the exact requested line", async () => {
	const file = parsePatch(patch)[0];
	if (!file) throw new Error("missing fixture");
	const t = await testRender(
		<DiffBody
			file={file}
			theme={theme}
			layout="stack"
			width={60}
			decorations={[
				{
					id: "new-two",
					focusId: "focused-key-change",
					filePath: "a.ts",
					side: "additions",
					startLine: 2,
					endLine: 2,
				},
			]}
			focusedDecorationId="focused-key-change"
		/>,
		{ width: 60, height: 10 },
	);
	await t.renderOnce();
	const lines = t.captureCharFrame().split("\n");
	const newOne = lines.find((line) => line.includes("new one"));
	const newTwo = lines.find((line) => line.includes("new two"));
	expect(newOne).not.toContain("▌");
	expect(newTwo).toContain("▌");
});

test("review ranges use their tint without looking like a gutter selection", async () => {
	const file = parsePatch(patch)[0];
	if (!file) throw new Error("missing fixture");
	const tint = "#552244";
	const t = await testRender(
		<DiffBody
			file={file}
			theme={theme}
			layout="stack"
			width={60}
			decorations={[
				{
					id: "review-new-two",
					focusId: "review-hint",
					filePath: "a.ts",
					side: "additions",
					startLine: 2,
					endLine: 2,
					backgroundColor: tint,
					showGutterMarker: false,
				},
			]}
			focusedDecorationId="review-hint"
		/>,
		{ width: 60, height: 10 },
	);
	await t.renderOnce();
	const lines = t.captureCharFrame().split("\n");
	const targetY = lines.findIndex((line) => line.includes("new two"));
	const background = t
		.captureSpans()
		.lines[targetY]?.spans.find((span) => span.text.includes("two"))?.bg;

	expect(lines[targetY]).not.toContain("▌");
	expect(background?.toInts()).toEqual([85, 34, 68, 255]);
});

test("gutter selection preserves review tints and stays neutral across diff sides", async () => {
	const file = parsePatch(patch)[0];
	if (!file) throw new Error("missing fixture");
	const backgrounds: { selected?: number[]; review?: number[] }[] = [];
	for (const side of ["deletions", "additions"] as const) {
		const t = await testRender(
			<DiffBody
				file={file}
				theme={theme}
				layout="stack"
				width={60}
				decorations={[
					{
						id: "review-new-two",
						focusId: "review-hint",
						filePath: "a.ts",
						side: "additions",
						startLine: 2,
						endLine: 2,
						backgroundColor: "#552244",
						showGutterMarker: false,
					},
				]}
				focusedDecorationId="review-hint"
				selectedRange={{
					filePath: "a.ts",
					hunkOldStart: 1,
					side,
					startLine: 1,
					endLine: 1,
				}}
			/>,
			{ width: 60, height: 10 },
		);
		await t.renderOnce();
		const selectedText = side === "deletions" ? "old one" : "new one";
		const lines = t.captureCharFrame().split("\n");
		const selectedY = lines.findIndex((line) => line.includes(selectedText));
		const reviewY = lines.findIndex((line) => line.includes("new two"));
		// Intra-line emphasis splits each line, so the shared word carries the cell's own tint.
		backgrounds.push({
			selected: t
				.captureSpans()
				.lines[selectedY]?.spans.find((span) => span.text.includes("one"))
				?.bg.toInts(),
			review: t
				.captureSpans()
				.lines[reviewY]?.spans.find((span) => span.text.includes("two"))
				?.bg.toInts(),
		});
	}

	expect(backgrounds).toEqual([
		{ selected: [85, 79, 78, 255], review: [85, 34, 68, 255] },
		{ selected: [85, 79, 78, 255], review: [85, 34, 68, 255] },
	]);
});

test("an active range overrides a key-change tint from the other side of every context row", async () => {
	const [file] = parsePatch(`diff --git a/context.ts b/context.ts
--- a/context.ts
+++ b/context.ts
@@ -1,3 +1,3 @@
 keep one
-old two
+new two
 keep three
`);
	if (!file) throw new Error("missing fixture");
	const t = await testRender(
		<DiffBody
			file={file}
			theme={theme}
			layout="stack"
			width={60}
			decorations={[
				{
					id: "key-change-old-side",
					filePath: "context.ts",
					side: "deletions",
					startLine: 1,
					endLine: 2,
					backgroundColor: "#552244",
					showGutterMarker: false,
				},
			]}
			focusedDecorationId="key-change-old-side"
			selectedRange={{
				filePath: "context.ts",
				hunkOldStart: 1,
				side: "additions",
				startLine: 1,
				endLine: 2,
			}}
		/>,
		{ width: 60, height: 8 },
	);
	await t.renderOnce();
	const lines = t.captureCharFrame().split("\n");
	const capture = t.captureSpans();
	const background = (text: string) => {
		const row = lines.findIndex((line) => line.includes(text));
		return capture.lines[row]?.spans.find((span) => span.text.includes(text))?.bg?.toInts();
	};

	expect(background("keep one")).toEqual(hexInts(theme.selectedHunk));
	expect(background("new two")).toEqual(hexInts(theme.selectedHunk));
});

test("stack context focus uses the requested side's visible highlight", async () => {
	const [file] = parsePatch(`diff --git a/context.ts b/context.ts
--- a/context.ts
+++ b/context.ts
@@ -1,3 +1,3 @@
 keep one
-old two
+new two
 keep three
`);
	if (!file) throw new Error("missing fixture");
	const t = await testRender(
		<DiffBody
			file={file}
			theme={theme}
			layout="stack"
			width={60}
			decorations={[
				{
					id: "context-new-side",
					filePath: "context.ts",
					side: "additions",
					startLine: 3,
					endLine: 3,
				},
			]}
			focusedDecorationId="context-new-side"
		/>,
		{ width: 60, height: 8 },
	);
	await t.renderOnce();
	const lines = t.captureCharFrame().split("\n");
	const contextIndex = lines.findIndex((line) => line.includes("keep three"));
	const contextBackground = t
		.captureSpans()
		.lines[contextIndex]?.spans.find((span) => span.text.includes("keep three"))?.bg;

	const unfocusedIndex = lines.findIndex((line) => line.includes("keep one"));
	const unfocusedBackground = t
		.captureSpans()
		.lines[unfocusedIndex]?.spans.find((span) => span.text.includes("keep one"))?.bg;

	expect(lines[contextIndex]).toContain("▌");
	expect(contextBackground).toBeDefined();
	expect(contextBackground).not.toEqual(unfocusedBackground);
});

test("host-supplied and standalone plans render equivalent component geometry", async () => {
	const file = parsePatch(patch)[0];
	if (!file) throw new Error("missing fixture");
	const width = 60;
	const plan = planDiff({
		file,
		layout: "split",
		width,
		visibility: { lineNumbers: false, changeMarkers: true, hunkHeaders: false },
		chrome: OPENTUI_DIFF_CHROME,
		syntaxTheme: theme.syntaxTheme,
	});
	const standalone = await testRender(
		<DiffBody
			file={file}
			theme={theme}
			layout="split"
			width={width}
			showLineNumbers={false}
			showHunkHeaders={false}
		/>,
		{ width, height: 8 },
	);
	const supplied = await testRender(<DiffBody plan={plan} theme={theme} />, {
		width,
		height: 8,
	});

	await standalone.renderOnce();
	await supplied.renderOnce();
	expect(supplied.captureCharFrame()).toBe(standalone.captureCharFrame());
	expect(supplied.captureSpans()).toEqual(standalone.captureSpans());
});

test("hidden line numbers remove the selectable gutter and return its columns to code", async () => {
	const file = parsePatch(patch)[0];
	if (!file) throw new Error("missing fixture");
	const selections: unknown[] = [];
	const t = await testRender(
		<DiffBody
			file={file}
			theme={theme}
			layout="stack"
			width={30}
			showLineNumbers={false}
			showChangeMarkers={false}
			onRangeSelect={(range) => selections.push(range)}
		/>,
		{ width: 30, height: 10 },
	);
	await t.renderOnce();
	const rows = t.captureCharFrame().split("\n");
	const y = rows.findIndex((row) => row.includes("old one"));
	expect(y).toBeGreaterThan(-1);
	expect(rows[y]?.startsWith("old one")).toBe(true);
	await act(async () => t.mockMouse.click(0, y));
	await t.renderOnce();
	expect(selections).toEqual([]);
});

test("split rows keep one divider column at odd widths regardless of content length", async () => {
	const unevenPatch = `diff --git a/uneven.ts b/uneven.ts
--- a/uneven.ts
+++ b/uneven.ts
@@ -1,2 +1,2 @@
-${"old content ".repeat(8)}
-x
+y
+${"new content ".repeat(8)}
`;
	const file = parsePatch(unevenPatch)[0];
	if (!file) throw new Error("missing fixture");
	const width = 41;
	const t = await testRender(<DiffBody file={file} theme={theme} layout="split" width={width} />, {
		width,
		height: 30,
	});
	await t.renderOnce();
	const changedRows = t
		.captureCharFrame()
		.split("\n")
		.filter((line) => line.includes("│"));
	// Both lines wrap, one side at a time, and every row keeps the same divider.
	expect(changedRows.length).toBeGreaterThan(2);
	expect(new Set(changedRows.map((line) => line.indexOf("│")))).toEqual(new Set([20]));
});

test("showLineNumbers false hides old and new number gutters in both layouts", async () => {
	const file = parsePatch(patch)[0];
	if (!file) throw new Error("missing fixture");
	for (const layout of ["split", "stack"] as const) {
		const t = await testRender(
			<DiffBody
				file={file}
				theme={theme}
				layout={layout}
				width={60}
				showLineNumbers={false}
				showHunkHeaders={false}
			/>,
			{ width: 60, height: 8 },
		);
		await t.renderOnce();
		const body = t
			.captureCharFrame()
			.split("\n")
			.filter((line) => line.includes("old") || line.includes("new"))
			.join("\n");
		expect(body).not.toMatch(/\b[12]\b/);
	}
});

test("line-number gutters select exact side-aware single and multi-line ranges", async () => {
	const [file] = parsePatch(`diff --git a/select.ts b/select.ts
--- a/select.ts
+++ b/select.ts
@@ -1,5 +1,5 @@
 keep one
-old two
+new two
 keep three
 keep four
 keep five
`);
	if (!file) throw new Error("missing fixture");
	const selections: unknown[] = [];
	const t = await testRender(
		<DiffBody
			file={file}
			theme={theme}
			layout="stack"
			width={60}
			onRangeSelect={(range) => selections.push(range)}
		/>,
		{ width: 60, height: 8 },
	);
	await t.renderOnce();
	const lines = t.captureCharFrame().split("\n");
	const oldTwoY = lines.findIndex((line) => line.includes("old two"));
	const newTwoY = lines.findIndex((line) => line.includes("new two"));
	const keepFiveY = lines.findIndex((line) => line.includes("keep five"));
	const oldTwoX = lines[oldTwoY]?.indexOf("2") ?? -1;
	const newTwoX = lines[newTwoY]?.indexOf("2", 4) ?? -1;
	const keepFiveX = lines[keepFiveY]?.lastIndexOf("5") ?? -1;

	await act(async () => t.mockMouse.click(oldTwoX, oldTwoY));
	await t.renderOnce();
	expect(selections.at(-1)).toMatchObject({ side: "deletions", startLine: 2, endLine: 2 });

	await act(async () => t.mockMouse.click(newTwoX, newTwoY));
	await t.renderOnce();
	expect(selections.at(-1)).toEqual({
		filePath: "select.ts",
		hunkOldStart: 1,
		side: "additions",
		startLine: 2,
		endLine: 2,
	});

	await act(async () => t.mockMouse.drag(newTwoX, newTwoY, keepFiveX, keepFiveY));
	await t.renderOnce();
	expect(selections.at(-1)).toEqual({
		filePath: "select.ts",
		hunkOldStart: 1,
		side: "additions",
		startLine: 2,
		endLine: 5,
	});
});

test("dragging source text remains terminal text selection instead of range selection", async () => {
	const file = parsePatch(patch)[0];
	if (!file) throw new Error("missing fixture");
	const selections: unknown[] = [];
	const t = await testRender(
		<DiffBody
			file={file}
			theme={theme}
			layout="stack"
			width={60}
			onRangeSelect={(range) => selections.push(range)}
		/>,
		{ width: 60, height: 8 },
	);
	await t.renderOnce();
	const lines = t.captureCharFrame().split("\n");
	const firstY = lines.findIndex((line) => line.includes("new one"));
	const secondY = lines.findIndex((line) => line.includes("new two"));
	const sourceX = (lines[firstY]?.indexOf("new one") ?? 0) + 1;
	await act(async () => t.mockMouse.drag(sourceX, firstY, sourceX + 2, secondY));
	await t.renderOnce();

	expect(selections).toEqual([]);
	expect(t.renderer.getSelection()?.getSelectedText()).toContain("new");
});

test("syntax-highlighted text uses one solid Visual-mode selection", async () => {
	const [file] = parsePatch(`diff --git a/visual.ts b/visual.ts
--- a/visual.ts
+++ b/visual.ts
@@ -1 +1 @@
-const oldValue = 1;
+const newValue = 2;
`);
	if (!file) throw new Error("missing fixture");
	await prepareSyntaxHighlighting([file], theme.syntaxTheme);
	const t = await testRender(<DiffBody file={file} theme={theme} layout="stack" width={60} />, {
		width: 60,
		height: 8,
	});
	await t.renderOnce();
	const lines = t.captureCharFrame().split("\n");
	const y = lines.findIndex((line) => line.includes("const newValue"));
	const x = lines[y]?.indexOf("const") ?? -1;
	await act(async () => t.mockMouse.drag(x, y, x + 15, y));
	await t.renderOnce();

	const selectedText = t.renderer.getSelection()?.getSelectedText() ?? "";
	const spans = t.captureSpans().lines[y]?.spans ?? [];
	const characters = spans.flatMap((span) =>
		[...span.text].map(() => ({ bg: span.bg.toString(), fg: span.fg.toString() })),
	);
	const selected = characters.slice(x, x + selectedText.length);

	expect(selectedText).toBe("const newValue ");
	expect(new Set(selected.map(({ bg }) => bg)).size).toBe(1);
	expect(new Set(selected.map(({ fg }) => fg)).size).toBe(1);
});

test("multiple inline attachments share an anchor and expose its gutter count", async () => {
	const file = parsePatch(patch)[0];
	if (!file) throw new Error("missing fixture");
	const anchor = {
		filePath: "a.ts",
		hunkOldStart: 1,
		side: "additions" as const,
		startLine: 2,
		endLine: 2,
	};
	const t = await testRender(
		<DiffBody
			file={file}
			theme={theme}
			layout="stack"
			width={60}
			inlineAttachments={[
				{ id: "first", anchor, content: <text>first inline note</text> },
				{ id: "second", anchor, content: <text>second inline note</text> },
			]}
		/>,
		{ width: 60, height: 10 },
	);
	await t.renderOnce();
	const frame = t.captureCharFrame();
	expect(frame).toContain("2●");
	expect(frame).toContain("first inline note");
	expect(frame).toContain("second inline note");
});

test("binary and pure rename files retain meaningful empty states and rename paths", async () => {
	const [binary] = parsePatch(`diff --git a/image.png b/image.png
index 1111111..2222222 100644
Binary files a/image.png and b/image.png differ
`);
	const [rename] = parsePatch(`diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts
`);
	if (!binary || !rename) throw new Error("missing fixture");

	const body = await testRender(<DiffBody file={binary} theme={theme} width={50} />, {
		width: 50,
		height: 2,
	});
	await body.renderOnce();
	expect(body.captureCharFrame()).toContain("Binary file differs.");
	expect(body.captureCharFrame()).not.toContain("No changes.");

	const header = await testRender(<DiffFileHeader file={rename} theme={theme} width={50} />, {
		width: 50,
		height: 2,
	});
	await header.renderOnce();
	expect(header.captureCharFrame()).toContain("old.ts -> new.ts");

	const renameBody = await testRender(<DiffBody file={rename} theme={theme} width={50} />, {
		width: 50,
		height: 2,
	});
	await renameBody.renderOnce();
	expect(renameBody.captureCharFrame()).toContain("Renamed without changes.");
});

test("line numbers stay in one column whether or not the content overflows", async () => {
	const [file] = parsePatch(`diff --git a/mixed.ts b/mixed.ts
--- a/mixed.ts
+++ b/mixed.ts
@@ -1,3 +1,3 @@
-short
+${"x".repeat(200)}
+short again
`);
	if (!file) throw new Error("missing fixture");
	const t = await testRender(<DiffBody file={file} theme={theme} layout="stack" width={40} />, {
		width: 40,
		height: 20,
	});
	await t.renderOnce();
	const lines = t.captureCharFrame().split("\n");
	const overflowing = lines.find((line) => line.includes("xxxx")) ?? "";
	const fitting = lines.find((line) => line.includes("short again")) ?? "";
	expect(overflowing.indexOf("+")).toBe(fitting.indexOf("+"));
});

const WRAPPED_TAIL = "END";
const wrappedLine = `${"wrapped-".repeat(12)}${WRAPPED_TAIL}`;

const wrapPatch = (line: string) => `diff --git a/wrap.ts b/wrap.ts
--- a/wrap.ts
+++ b/wrap.ts
@@ -1,1 +1,1 @@
-short old line
+${line}
`;

/** Where a rendered row's code begins: two columns past its change sign. */
const codeColumn = (row: string) => row.indexOf("+") + 2;

test("a line longer than its pane wraps rather than losing its tail", async () => {
	const [file] = parsePatch(wrapPatch(wrappedLine));
	if (!file) throw new Error("missing fixture");
	for (const layout of ["stack", "split"] as const) {
		const t = await testRender(<DiffBody file={file} theme={theme} layout={layout} width={60} />, {
			width: 60,
			height: 20,
		});
		await t.renderOnce();
		const rows = t.captureCharFrame().split("\n");
		const first = rows.findIndex((row) => row.includes("wrapped-"));
		const start = codeColumn(rows[first] ?? "");
		const last = rows.findIndex((row) => row.includes(WRAPPED_TAIL));
		const code = rows
			.slice(first, last + 1)
			.map((row) => row.slice(start).trimEnd())
			.join("");

		expect(last).toBeGreaterThan(first);
		expect(code).toBe(wrappedLine);
	}
});

test("continuation rows leave the gutter and the change sign blank", async () => {
	const [file] = parsePatch(wrapPatch(wrappedLine));
	if (!file) throw new Error("missing fixture");
	const t = await testRender(<DiffBody file={file} theme={theme} layout="stack" width={60} />, {
		width: 60,
		height: 20,
	});
	await t.renderOnce();
	const rows = t.captureCharFrame().split("\n");
	const first = rows.findIndex((row) => row.includes("wrapped-"));
	const start = codeColumn(rows[first] ?? "");

	expect(rows[first]?.slice(0, start)).toContain("1");
	expect(rows[first]?.slice(0, start)).toContain("+");
	expect(rows[first + 1]?.slice(0, start).trim()).toBe("");
	expect(rows[first + 1]?.slice(start).trim()).not.toBe("");
});

test("a continuation row's blank gutter does not select the line", async () => {
	const [file] = parsePatch(wrapPatch(wrappedLine));
	if (!file) throw new Error("missing fixture");
	for (const layout of ["stack", "split"] as const) {
		const selections: unknown[] = [];
		const t = await testRender(
			<DiffBody
				file={file}
				theme={theme}
				layout={layout}
				width={60}
				onRangeSelect={(range) => selections.push(range)}
			/>,
			{ width: 60, height: 20 },
		);
		await t.renderOnce();
		const rows = t.captureCharFrame().split("\n");
		const first = rows.findIndex((row) => row.includes("wrapped-"));
		const gutterX = (rows[first]?.indexOf("1") ?? -1) as number;

		await act(async () => t.mockMouse.click(gutterX, first));
		await t.renderOnce();
		expect(selections).toHaveLength(1);

		await act(async () => t.mockMouse.click(gutterX, first + 1));
		await t.renderOnce();
		expect(selections).toHaveLength(1);
	}
});

test("text dragged across a wrap still names the one logical line it came from", async () => {
	const [file] = parsePatch(wrapPatch(wrappedLine));
	if (!file) throw new Error("missing fixture");
	const t = await testRender(<DiffBody file={file} theme={theme} layout="stack" width={60} />, {
		width: 60,
		height: 20,
	});
	await t.renderOnce();
	const rows = t.captureCharFrame().split("\n");
	const first = rows.findIndex((row) => row.includes("wrapped-"));
	const start = codeColumn(rows[first] ?? "");
	await act(async () => t.mockMouse.drag(start + 2, first, start + 4, first + 1));
	await t.renderOnce();
	const selected = t.renderer.getSelection()?.selectedRenderables ?? [];

	expect(selected.length).toBeGreaterThan(1);
	expect(new Set(selected.map((renderable) => renderable.id))).toEqual(
		new Set([
			diffLineId({
				filePath: "wrap.ts",
				hunkOldStart: 1,
				side: "additions",
				startLine: 1,
				endLine: 1,
			}),
		]),
	);
});

test("a split pane pads with blank rows so a wrapped line keeps both sides in step", async () => {
	const [file] = parsePatch(wrapPatch(wrappedLine));
	if (!file) throw new Error("missing fixture");
	const t = await testRender(<DiffBody file={file} theme={theme} layout="split" width={60} />, {
		width: 60,
		height: 20,
	});
	await t.renderOnce();
	const rows = t.captureCharFrame().split("\n");
	const dividerRows = rows.filter((row) => row.includes("│"));
	const divider = dividerRows[0]?.indexOf("│") ?? -1;
	const paneRows = dividerRows.filter((row) => row.slice(divider).includes("wrapped-"));

	expect(paneRows.length).toBeGreaterThan(1);
	expect(new Set(dividerRows.map((row) => row.indexOf("│")))).toEqual(new Set([divider]));
	// The short deletion sits on the first row alone; the rest of its pane is empty.
	expect(paneRows[0]?.slice(0, divider)).toContain("short old line");
	expect(paneRows.slice(1).map((row) => row.slice(0, divider).trim())).toEqual(
		paneRows.slice(1).map(() => ""),
	);
});

test("a new file drops the gutter that can never hold an old line number", async () => {
	const [added] = parsePatch(`diff --git a/added.ts b/added.ts
new file mode 100644
--- /dev/null
+++ b/added.ts
@@ -0,0 +1,2 @@
+first
+second
`);
	if (!added) throw new Error("missing fixture");
	const t = await testRender(<DiffBody file={added} theme={theme} layout="stack" width={40} />, {
		width: 40,
		height: 6,
	});
	await t.renderOnce();
	const first =
		t
			.captureCharFrame()
			.split("\n")
			.find((line) => line.includes("first")) ?? "";
	expect(first.indexOf("1")).toBeLessThan(4);
});

const hexInts = (hex: string): [number, number, number, number] => [
	Number.parseInt(hex.slice(1, 3), 16),
	Number.parseInt(hex.slice(3, 5), 16),
	Number.parseInt(hex.slice(5, 7), 16),
	255,
];

const intralinePatch = `diff --git a/intraline.ts b/intraline.ts
--- a/intraline.ts
+++ b/intraline.ts
@@ -1,2 +1,1 @@
-const value = 7;
-orphan();
+const value = 42;
`;

type CapturedSpan = {
	text: string;
	bg: { toInts: () => number[] };
	fg: { toInts: () => number[] };
};

const spansAt = (
	capture: { lines: { spans: CapturedSpan[] }[] },
	charFrame: string,
	needle: string,
): CapturedSpan[] =>
	capture.lines[charFrame.split("\n").findIndex((line) => line.includes(needle))]?.spans ?? [];

test("changed characters of paired lines take the emphasis background", async () => {
	const [file] = parsePatch(intralinePatch);
	if (!file) throw new Error("missing fixture");
	const t = await testRender(<DiffBody file={file} theme={theme} layout="stack" width={60} />, {
		width: 60,
		height: 10,
	});
	await t.renderOnce();
	const frame = t.captureCharFrame();
	const capture = t.captureSpans();
	const backgrounds = (needle: string, text: string) =>
		spansAt(capture, frame, needle)
			.filter((span) => span.text.includes(text))
			.map((span) => span.bg.toInts());

	expect(backgrounds("const value = 42;", "42")).toEqual([hexInts(theme.addedEmphasisBg)]);
	expect(backgrounds("const value = 42;", "const value =")).toEqual([hexInts(theme.addedBg)]);
	expect(backgrounds("const value = 7;", "7")).toEqual([hexInts(theme.removedEmphasisBg)]);
	expect(backgrounds("orphan();", "orphan();")).toEqual([hexInts(theme.removedBg)]);
});

test("emphasis backgrounds sit inside a focused line's own background", async () => {
	const [file] = parsePatch(intralinePatch);
	if (!file) throw new Error("missing fixture");
	const t = await testRender(
		<DiffBody
			file={file}
			theme={theme}
			layout="stack"
			width={80}
			decorations={[
				{
					id: "focused-addition",
					filePath: "intraline.ts",
					side: "additions",
					startLine: 1,
					endLine: 1,
				},
			]}
			focusedDecorationId="focused-addition"
		/>,
		{ width: 80, height: 10 },
	);
	await t.renderOnce();
	const spans = spansAt(t.captureSpans(), t.captureCharFrame(), "const value = 42;");
	const background = (text: string) => spans.find((span) => span.text.includes(text))?.bg.toInts();

	expect(background("42")).toEqual(hexInts(theme.addedEmphasisBg));
	expect(background("const value =")).toEqual(hexInts(theme.addedContentBg));
});

test("an emphasised run keeps its background on both sides of a wrap", async () => {
	const [file] = parsePatch(`diff --git a/emphasis-wrap.ts b/emphasis-wrap.ts
--- a/emphasis-wrap.ts
+++ b/emphasis-wrap.ts
@@ -1,1 +1,1 @@
-keep short;
+keep ${"z".repeat(60)};
`);
	if (!file) throw new Error("missing fixture");
	const t = await testRender(<DiffBody file={file} theme={theme} layout="stack" width={60} />, {
		width: 60,
		height: 10,
	});
	await t.renderOnce();
	const capture = t.captureSpans();
	const rows = t.captureCharFrame().split("\n");
	const first = rows.findIndex((row) => row.includes("zzz"));
	const backgrounds = (row: number, text: string) =>
		(capture.lines[row]?.spans ?? [])
			.filter((span) => span.text.includes(text))
			.map((span) => span.bg.toInts());

	expect(rows[first + 1]).toContain("z;");
	expect(backgrounds(first, "keep")).toEqual([hexInts(theme.addedBg)]);
	expect(backgrounds(first, "zz")).toEqual([hexInts(theme.addedEmphasisBg)]);
	expect(backgrounds(first + 1, "zz")).toEqual([hexInts(theme.addedEmphasisBg)]);
});

test("syntax colours survive the emphasis background they sit under", async () => {
	const [file] = parsePatch(intralinePatch);
	if (!file) throw new Error("missing fixture");
	await prepareSyntaxHighlighting([file], theme.syntaxTheme);
	const t = await testRender(<DiffBody file={file} theme={theme} layout="stack" width={60} />, {
		width: 60,
		height: 10,
	});
	await t.renderOnce();
	const spans = spansAt(t.captureSpans(), t.captureCharFrame(), "const value = 42;");
	const foreground = (text: string) => spans.find((span) => span.text.includes(text))?.fg.toInts();

	expect(foreground("42")).not.toEqual(foreground("const"));
	expect(foreground("42")).not.toEqual(hexInts(theme.text));
});
