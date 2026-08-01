import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { DiffBody, DiffFileHeader, parsePatch } from "../src/index.ts";

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
