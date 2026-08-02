import { afterEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { testRender as renderOpenTui } from "@opentui/react/test-utils";
import { parsePatch } from "@revue/diff-renderer";
import { RevueChaptersFileSchema, type ViewState } from "@revue/types";
import { act } from "react";
import sample from "../../../examples/sample-run/chapters.json" with { type: "json" };
import { App } from "./app.tsx";
import { preparePatch } from "./diff.ts";

const PATCH = `${import.meta.dir}/../../../examples/sample-run/diff.patch`;
const loadPatch = async (path: string) => preparePatch(await readFile(path, "utf8"));

// React's act() needs this flag to flush state updates from mocked key presses.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const file = RevueChaptersFileSchema.parse(sample);
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

async function press(t: Awaited<ReturnType<typeof testRender>>, key: string) {
	await act(async () => {
		t.mockInput.pressKey(key);
	});
	await act(async () => {
		await t.renderOnce();
	});
}

async function nextChapter(t: Awaited<ReturnType<typeof testRender>>) {
	await press(t, "]");
	await press(t, "c");
}

async function arrow(
	t: Awaited<ReturnType<typeof testRender>>,
	direction: "up" | "down" | "left" | "right",
) {
	await act(async () => {
		t.mockInput.pressArrow(direction);
	});
	await act(async () => {
		await t.renderOnce();
	});
}

async function click(t: Awaited<ReturnType<typeof testRender>>, x: number, y: number) {
	await act(async () => {
		await t.mockMouse.click(x, y);
	});
	await act(async () => {
		await t.renderOnce();
	});
}

test("opens on the prologue with the chapter list and review progress", async () => {
	const t = await testRender(<App file={file} />, { width: 110, height: 32 });
	await t.renderOnce();
	const frame = t.captureCharFrame();

	expect(frame).toContain("revue"); // sidebar title
	expect(frame).toContain("Prologue"); // sidebar entry
	expect(frame).toContain("backoff helper"); // sidebar chapter label (single-line truncated)
	expect(frame).toContain("Dashboards stay up during deploys now"); // prologue outcome
	expect(frame).toContain("0/3 reviewed"); // none reviewed yet
});

test("the keyboard menu reuses navigation and keeps Escape from quitting", async () => {
	let quits = 0;
	const t = await testRender(<App file={file} onQuit={() => (quits += 1)} />, {
		width: 110,
		height: 32,
		kittyKeyboard: true,
	});
	await t.renderOnce();
	await press(t, "F10");
	expect(t.captureCharFrame()).toContain("Quit");
	await press(t, "ESCAPE");
	expect(t.captureCharFrame()).not.toContain("  Quit");
	expect(quits).toBe(0);

	await nextChapter(t);
	await press(t, "F10");
	await arrow(t, "right");
	const menuFrame = t.captureCharFrame();
	expect(menuFrame).toContain("[x] Patch view");
	expect(menuFrame).toContain("Semantic diff (coming next)");
	await arrow(t, "down");
	await press(t, "RETURN");
	expect(t.captureCharFrame()).toContain("3/4");
});

test("opening a menu cancels an incomplete chapter chord", async () => {
	const t = await testRender(<App file={file} />, {
		width: 110,
		height: 32,
		kittyKeyboard: true,
	});
	await t.renderOnce();
	await press(t, "]");
	await press(t, "F10");
	await press(t, "ESCAPE");
	await press(t, "c");

	expect(t.captureCharFrame()).toContain("1/4");
});

test("next unreviewed is unavailable when every chapter is reviewed", async () => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(
		<App
			file={file}
			diffFiles={diffFiles}
			initialViewState={{
				chapters: file.chapters.map((chapter) => chapter.id),
				files: [],
				keyChanges: [],
			}}
		/>,
		{ width: 120, height: 44, kittyKeyboard: true },
	);
	await t.renderOnce();
	await nextChapter(t);
	await nextChapter(t);
	await nextChapter(t);
	await press(t, "F10");
	await arrow(t, "right");
	await arrow(t, "down");
	await arrow(t, "down");
	await press(t, "RETURN");

	expect(t.captureCharFrame()).toContain("▶ src/lib/apiClient.test.ts");
});

test("the mouse menu acts once and blocks the chapter beneath it", async () => {
	const seen: ViewState[] = [];
	const t = await testRender(<App file={file} onViewStateChange={(next) => seen.push(next)} />, {
		width: 58,
		height: 32,
	});
	await t.renderOnce();
	await nextChapter(t);
	const chapterFrame = t.captureCharFrame().split("\n");
	const chapterY = chapterFrame.findIndex((line) => line.includes("Chapter 1/3"));
	const checkboxX = chapterFrame[chapterY]?.indexOf("[ ]") ?? -1;

	const bar = chapterFrame[0] ?? "";
	await click(t, bar.indexOf("View") + 1, 0);
	const menuLines = t.captureCharFrame().split("\n");
	const nextLine = menuLines.find((line) => line.includes("Next chapter")) ?? "";
	expect(nextLine).not.toContain("]c");

	await click(t, checkboxX + 1, chapterY);
	expect(t.captureCharFrame()).not.toContain("Semantic diff (coming next)");
	expect(seen).toHaveLength(0);

	const reopenedBar = t.captureCharFrame().split("\n")[0] ?? "";
	await click(t, reopenedBar.indexOf("View") + 1, 0);
	const helpLines = t.captureCharFrame().split("\n");
	const helpY = helpLines.findIndex((line) => line.includes("Keyboard shortcuts"));
	const helpX = helpLines[helpY]?.indexOf("Keyboard shortcuts") ?? -1;
	await click(t, helpX + 1, helpY);
	expect(t.captureCharFrame()).toContain("Scrolling");
});

test("a chapter shows its file list", async () => {
	const t = await testRender(<App file={file} />, { width: 110, height: 32 });
	await t.renderOnce();
	await nextChapter(t); // into chapter 1
	const frame = t.captureCharFrame();

	expect(frame).toContain("Files (1)");
	expect(frame).toContain("src/lib/backoff.ts");
});

test("with a patch, a chapter renders its real diff body and per-file stats", async () => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(<App file={file} diffFiles={diffFiles} />, { width: 120, height: 44 });
	await t.renderOnce();
	await nextChapter(t); // into chapter 1 (backoff.ts, a new file)
	const frame = t.captureCharFrame();

	expect(frame).toContain("backoff"); // real added line from the diff
	expect(frame).toContain("MAX_RETRIES");
	expect(frame).toContain("+9 -0"); // file-list stats from the parsed patch
});

test("x marks a chapter reviewed, persists, and auto-advances", async () => {
	const seen: ViewState[] = [];
	const t = await testRender(<App file={file} onViewStateChange={(n) => seen.push(n)} />, {
		width: 110,
		height: 32,
	});
	await t.renderOnce();
	await nextChapter(t); // chapter 1
	await press(t, "x"); // mark reviewed
	const frame = t.captureCharFrame();

	expect(seen.at(-1)?.chapters).toContain("chapter-1");
	expect(frame).toContain("1/3 reviewed");
	expect(frame).toContain("3/4"); // auto-advanced from page 2 to page 3 (next unreviewed)
});

test("f marks the selected file reviewed (which completes a single-file chapter)", async () => {
	const seen: ViewState[] = [];
	const t = await testRender(<App file={file} onViewStateChange={(n) => seen.push(n)} />, {
		width: 110,
		height: 32,
	});
	await t.renderOnce();
	await nextChapter(t); // chapter 1 (one file)
	await press(t, "f"); // mark that file reviewed

	expect(seen.at(-1)?.files).toContain("chapter-1::src/lib/backoff.ts");
	expect(seen.at(-1)?.chapters).toContain("chapter-1"); // all files reviewed -> chapter reviewed
});

test("key change content navigates while only its checkbox toggles review", async () => {
	const seen: ViewState[] = [];
	const targetedFile = RevueChaptersFileSchema.parse({
		...file,
		chapters: file.chapters.map((chapter) =>
			chapter.id === "chapter-1"
				? {
						...chapter,
						hunkRefs: [...chapter.hunkRefs, { filePath: "src/lib/apiClient.ts", oldStart: 41 }],
						keyChanges: chapter.keyChanges.map((keyChange) => ({
							...keyChange,
							lineRefs: [
								{
									filePath: "src/lib/apiClient.ts",
									side: "additions",
									startLine: 44,
									endLine: 52,
								},
								{
									filePath: "src/lib/apiClient.ts",
									side: "deletions",
									startLine: 44,
									endLine: 44,
								},
							],
						})),
					}
				: chapter,
		),
	});
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(
		<App file={targetedFile} diffFiles={diffFiles} onViewStateChange={(next) => seen.push(next)} />,
		{ width: 120, height: 44 },
	);
	await t.renderOnce();
	await nextChapter(t);

	const lines = t.captureCharFrame().split("\n");
	const keyChangeY = lines.findIndex((line) => line.includes("Is a 100ms base"));
	const keyChangeLine = lines[keyChangeY] ?? "";
	await click(t, keyChangeLine.indexOf("Is a 100ms base"), keyChangeY);
	expect(seen).toHaveLength(0);
	const focusedFrame = t.captureCharFrame();
	expect(focusedFrame).toContain("▸[ ]▼ src/lib/apiClient.ts");
	expect(focusedFrame.split("\n").find((line) => line.includes("return fetch"))).toContain("▌");
	expect(focusedFrame.split("\n").find((line) => line.includes("attempt += 1"))).toContain("▌");

	await click(t, keyChangeLine.indexOf("[ ]") + 1, keyChangeY);
	expect(seen.at(-1)?.keyChanges).toContain("chapter-1#0");
});

test("key-change focus scrolls the exact anchored diff row into view", async () => {
	const anchoredFile = RevueChaptersFileSchema.parse({
		chapters: [
			{
				id: "anchor-chapter",
				order: 1,
				title: "Anchor exact rows",
				summary: "The focused range is deep enough to require scrolling.",
				hunkRefs: [{ filePath: "deep.ts", oldStart: 1 }],
				keyChanges: [
					{
						content: "Review the exact deep line",
						lineRefs: [
							{
								filePath: "deep.ts",
								side: "additions",
								startLine: 25,
								endLine: 25,
							},
						],
					},
				],
			},
		],
	});
	const additions = Array.from({ length: 30 }, (_, index) => `+exact row ${index + 1}`).join("\n");
	const [diffFile] = parsePatch(`diff --git a/deep.ts b/deep.ts
--- a/deep.ts
+++ b/deep.ts
@@ -1 +1,30 @@
-old row
${additions}
`);
	if (!diffFile) throw new Error("missing diff fixture");
	const t = await testRender(<App file={anchoredFile} diffFiles={[diffFile]} />, {
		width: 100,
		height: 14,
	});
	await t.renderOnce();
	expect(t.captureCharFrame()).not.toContain("exact row 25");

	await press(t, "}");
	const visibleLines = t.captureCharFrame().split("\n");
	expect(visibleLines.find((line) => line.includes("exact row 25"))).toContain("▌");
	expect(visibleLines.some((line) => line.includes("exact row 1 "))).toBe(false);
});

test("number keys check a chapter's key changes", async () => {
	const seen: ViewState[] = [];
	const t = await testRender(<App file={file} onViewStateChange={(n) => seen.push(n)} />, {
		width: 110,
		height: 32,
	});
	await t.renderOnce();
	await nextChapter(t); // chapter 1
	await press(t, "1"); // toggle its first key change

	expect(seen.at(-1)?.keyChanges).toContain("chapter-1#0");
});

test("initialViewState is reflected on first render", async () => {
	const t = await testRender(
		<App file={file} initialViewState={{ chapters: ["chapter-1"], files: [], keyChanges: [] }} />,
		{ width: 110, height: 32 },
	);
	await t.renderOnce();
	expect(t.captureCharFrame()).toContain("1/3 reviewed");
});
