import { afterEach, expect, test } from "bun:test";
import { testRender as renderOpenTui } from "@opentui/react/test-utils";
import { act } from "react";
import { DiffBody, DiffFileHeader, parsePatch } from "../src/index.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

	expect(lines[contextIndex]).toContain("▌");
	expect(contextBackground?.r).toBeCloseTo(49 / 255);
	expect(contextBackground?.g).toBeCloseTo(91 / 255);
	expect(contextBackground?.b).toBeCloseTo(66 / 255);
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
	const t = await testRender(<DiffBody file={file} layout="split" width={width} />, {
		width,
		height: 8,
	});
	await t.renderOnce();
	const changedRows = t
		.captureCharFrame()
		.split("\n")
		.filter((line) => line.includes("│"));
	expect(changedRows).toHaveLength(2);
	expect(changedRows.map((line) => line.indexOf("│"))).toEqual([20, 20]);
});

test("showLineNumbers false hides old and new number gutters in both layouts", async () => {
	const file = parsePatch(patch)[0];
	if (!file) throw new Error("missing fixture");
	for (const layout of ["split", "stack"] as const) {
		const t = await testRender(
			<DiffBody
				file={file}
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
@@ -1,3 +1,3 @@
 keep one
-old two
+new two
 keep three
`);
	if (!file) throw new Error("missing fixture");
	const selections: unknown[] = [];
	const t = await testRender(
		<DiffBody
			file={file}
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
	const keepThreeY = lines.findIndex((line) => line.includes("keep three"));
	const oldTwoX = lines[oldTwoY]?.indexOf("2") ?? -1;
	const newTwoX = lines[newTwoY]?.indexOf("2", 4) ?? -1;
	const keepThreeX = lines[keepThreeY]?.lastIndexOf("3") ?? -1;

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

	await act(async () => t.mockMouse.drag(newTwoX, newTwoY, keepThreeX, keepThreeY));
	await t.renderOnce();
	expect(selections.at(-1)).toEqual({
		filePath: "select.ts",
		hunkOldStart: 1,
		side: "additions",
		startLine: 2,
		endLine: 3,
	});
});

test("dragging source text remains terminal text selection instead of range selection", async () => {
	const file = parsePatch(patch)[0];
	if (!file) throw new Error("missing fixture");
	const selections: unknown[] = [];
	const t = await testRender(
		<DiffBody
			file={file}
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

	const body = await testRender(<DiffBody file={binary} width={50} />, { width: 50, height: 2 });
	await body.renderOnce();
	expect(body.captureCharFrame()).toContain("Binary file differs.");
	expect(body.captureCharFrame()).not.toContain("No changes.");

	const header = await testRender(<DiffFileHeader file={rename} width={50} />, {
		width: 50,
		height: 2,
	});
	await header.renderOnce();
	expect(header.captureCharFrame()).toContain("old.ts -> new.ts");

	const renameBody = await testRender(<DiffBody file={rename} width={50} />, {
		width: 50,
		height: 2,
	});
	await renameBody.renderOnce();
	expect(renameBody.captureCharFrame()).toContain("Renamed without changes.");
});
