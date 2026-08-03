import { afterEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { testRender as renderOpenTui } from "@opentui/react/test-utils";
import { parsePatch } from "@revue/diff-renderer";
import {
	type ReviewThread,
	RevueChaptersFileSchema,
	THREAD_AUTHOR_KIND,
	THREAD_STATUS,
	type ThreadAnchor,
	type ThreadAuthor,
	type ViewState,
} from "@revue/types";
import { act } from "react";
import sample from "../../../examples/sample-run/chapters.json" with { type: "json" };
import { App } from "./app.tsx";
import { preparePatch } from "./diff.ts";

const PATCH = `${import.meta.dir}/../../../examples/sample-run/diff.patch`;
const loadPatch = async (path: string) => preparePatch(await readFile(path, "utf8"));
const semanticLine = (text: string, fg?: string) => ({
	text,
	spans: [{ text, fg, bold: false, dim: false, italic: false, underline: false }],
});

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
	expect(frame).toContain("Chapters (3)"); // sidebar index disclosure
	expect(frame).toContain("Prologue"); // sidebar entry
	expect(frame).toContain("1. Add a re"); // sidebar chapter label (single-line truncated)
	expect(frame).toContain("Dashboards stay up during deploys now"); // prologue outcome
	expect(frame).toContain("0/3 reviewed"); // none reviewed yet
});

test("the sidebar index walks back to the prologue from any chapter", async () => {
	const t = await testRender(<App file={file} />, { width: 110, height: 32 });
	await t.renderOnce();
	await nextChapter(t);
	await nextChapter(t);
	expect(t.captureCharFrame()).toContain("3/4");

	const lines = t.captureCharFrame().split("\n");
	const prologueY = lines.findIndex((line) => line.includes("Prologue"));
	await click(t, (lines[prologueY]?.indexOf("Prologue") ?? -1) + 1, prologueY);

	const frame = t.captureCharFrame();
	expect(frame).toContain("1/4");
	expect(frame).toContain("Dashboards stay up during deploys now");
});

test("the prologue's chapter list opens the chapter it names", async () => {
	const t = await testRender(<App file={file} />, { width: 110, height: 60 });
	await t.renderOnce();
	const lines = t.captureCharFrame().split("\n");
	const entryY = lines.findLastIndex((line) => line.includes("Retry transient failures"));
	await click(t, (lines[entryY]?.indexOf("Retry transient") ?? -1) + 1, entryY);

	expect(t.captureCharFrame()).toContain("3/4");
});

test("a new file is rendered unified so no pane sits empty", async () => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(<App file={file} diffFiles={diffFiles} />, { width: 160, height: 40 });
	await t.renderOnce();
	await nextChapter(t); // chapter 1 covers backoff.ts, a new file

	const codeLine =
		t
			.captureCharFrame()
			.split("\n")
			.find((line) => line.includes("MAX_RETRIES")) ?? "";
	// Past the sidebar border, a split body would show a second rule between its panes.
	expect(codeLine.slice(codeLine.indexOf("│") + 1)).not.toContain("│");
});

test("[c walks back into the prologue instead of stopping at chapter one", async () => {
	const t = await testRender(<App file={file} />, { width: 110, height: 32 });
	await t.renderOnce();
	await nextChapter(t);
	expect(t.captureCharFrame()).toContain("2/4");

	await press(t, "[");
	await press(t, "c");
	expect(t.captureCharFrame()).toContain("1/4");
	expect(t.captureCharFrame()).toContain("Dashboards stay up during deploys now");
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
	expect(menuFrame).toContain("Semantic diff (read-only)");
	await arrow(t, "down");
	await arrow(t, "down");
	await press(t, "RETURN"); // Previous page — reachable from chapter one because the prologue is a page
	expect(t.captureCharFrame()).toContain("1/4");
});

test("View menu toggles a read-only semantic diff without losing the focused file", async () => {
	const combined = RevueChaptersFileSchema.parse({
		chapters: [
			{
				...file.chapters[0],
				hunkRefs: [
					{ filePath: "src/lib/backoff.ts", oldStart: 0 },
					{ filePath: "src/lib/apiClient.ts", oldStart: 41 },
				],
			},
		],
	});
	const diffFiles = await loadPatch(PATCH);
	let loads = 0;
	const t = await testRender(
		<App
			file={combined}
			diffFiles={diffFiles}
			loadSemanticDiff={async () => {
				loads += 1;
				return {
					version: "Difftastic 0.67.0",
					files: [
						{
							path: "src/lib/backoff.ts",
							lines: [semanticLine("added: src/lib/backoff.ts"), semanticLine("semantic backoff")],
						},
						{
							path: "src/lib/apiClient.ts",
							lines: [
								semanticLine("modified: src/lib/apiClient.ts"),
								semanticLine("semantic retry loop", "#a6e3a1"),
							],
						},
					],
				};
			}}
		/>,
		{ width: 120, height: 44, kittyKeyboard: true },
	);
	await t.renderOnce();
	await press(t, "TAB");
	expect(t.captureCharFrame()).toContain("▸[ ]▼ src/lib/apiClient.ts");

	await press(t, "F10");
	await arrow(t, "right");
	await arrow(t, "down");
	await press(t, "RETURN");
	await act(async () => Promise.resolve());
	await t.renderOnce();
	const semanticFrame = t.captureCharFrame();
	expect(semanticFrame).toContain("Semantic view (read-only)");
	expect(semanticFrame).toContain("semantic retry loop");
	expect(semanticFrame).toContain("anchors/ranges/threads Patch-only");
	expect(semanticFrame).toContain("▸[ ]▼ src/lib/apiClient.ts");
	const semanticRow = t
		.captureSpans()
		.lines.flatMap((line) => line.spans)
		.find((span) => span.text.includes("semantic retry loop"));
	expect(semanticRow?.fg.g).toBeCloseTo(227 / 255);

	await press(t, "F10");
	await arrow(t, "right");
	await press(t, "RETURN");
	const patchFrame = t.captureCharFrame();
	expect(patchFrame).toContain("Patch view");
	expect(patchFrame).toContain("return fetch");
	expect(patchFrame).toContain("▸[ ]▼ src/lib/apiClient.ts");
	expect(loads).toBe(1);
});

test("switching views preserves relative progress through the chapter", async () => {
	const scrollFile = RevueChaptersFileSchema.parse({
		chapters: [
			{
				id: "scroll-chapter",
				order: 1,
				title: "Keep view positions",
				summary: "Both renderings are longer than the viewport.",
				hunkRefs: [{ filePath: "scroll.ts", oldStart: 1 }],
				keyChanges: [],
			},
		],
	});
	const additions = Array.from({ length: 30 }, (_, index) => `+patch row ${index + 1}`).join("\n");
	const diffFiles = parsePatch(`diff --git a/scroll.ts b/scroll.ts
--- a/scroll.ts
+++ b/scroll.ts
@@ -1 +1,30 @@
-old row
${additions}
`);
	const semanticLines = Array.from({ length: 30 }, (_, index) =>
		semanticLine(`semantic row ${index + 1}`),
	);
	const t = await testRender(
		<App
			file={scrollFile}
			diffFiles={diffFiles}
			loadSemanticDiff={async () => ({
				version: "Difftastic 0.67.0",
				files: [{ path: "scroll.ts", lines: semanticLines }],
			})}
		/>,
		{ width: 100, height: 14, kittyKeyboard: true },
	);
	await t.renderOnce();
	for (let index = 0; index < 8; index += 1) await press(t, "j");
	expect(t.captureCharFrame()).not.toContain("patch row 1 ");

	await press(t, "F10");
	await arrow(t, "right");
	await arrow(t, "down");
	await press(t, "RETURN");
	await act(async () => Promise.resolve());
	await t.renderOnce();
	const semanticFrame = t.captureCharFrame();
	expect(semanticFrame).toContain("Semantic view (read-only)");
	expect(semanticFrame).toContain("semantic row");
	expect(semanticFrame).not.toContain("semantic row 1 ");
	for (let index = 0; index < 4; index += 1) await press(t, "j");

	await press(t, "F10");
	await arrow(t, "right");
	await press(t, "RETURN");
	expect(t.captureCharFrame()).not.toContain("patch row 1 ");

	await press(t, "F10");
	await arrow(t, "right");
	await arrow(t, "down");
	await press(t, "RETURN");
	expect(t.captureCharFrame()).not.toContain("semantic row 1 ");
});

test("an unavailable semantic diff stays in Patch with a safe explanation", async () => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(
		<App
			file={file}
			diffFiles={diffFiles}
			loadSemanticDiff={async () => {
				throw new Error("Semantic diff unavailable: incompatible difft.\u001b[31m");
			}}
		/>,
		{ width: 120, height: 44, kittyKeyboard: true },
	);
	await t.renderOnce();
	await nextChapter(t);
	await press(t, "F10");
	await arrow(t, "right");
	await arrow(t, "down");
	await press(t, "RETURN");
	await act(async () => Promise.resolve());
	await t.renderOnce();
	const frame = t.captureCharFrame();
	expect(frame).toContain("Patch view");
	expect(frame).toContain("Semantic diff unavailable: incompatible difft.");
	expect(frame).toContain("MAX_RETRIES");
	expect(frame).not.toContain("[31m");
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
	const nextLine = menuLines.find((line) => line.includes("Next page")) ?? "";
	expect(nextLine).not.toContain("]c");

	await click(t, checkboxX + 1, chapterY);
	expect(seen).toHaveLength(0);
	await click(t, bar.indexOf("View") + 1, 0); // toggles the open menu shut
	expect(t.captureCharFrame()).not.toContain("Semantic diff (read-only)");

	const reopenedBar = t.captureCharFrame().split("\n")[0] ?? "";
	await click(t, reopenedBar.indexOf("View") + 1, 0);
	const helpLines = t.captureCharFrame().split("\n");
	const helpY = helpLines.findIndex((line) => line.includes("Keyboard shortcuts"));
	const helpX = helpLines[helpY]?.indexOf("Keyboard shortcuts") ?? -1;
	await click(t, helpX + 1, helpY);
	expect(t.captureCharFrame()).toContain("Scrolling");
});

test("a chapter shows its file list", async () => {
	const t = await testRender(<App file={file} />, { width: 110, height: 40 });
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

test("inline threads show authors and compose new roots and replies", async () => {
	const threadFile = RevueChaptersFileSchema.parse({
		chapters: [
			{
				id: "thread-chapter",
				order: 1,
				title: "Review the value",
				summary: "A focused thread fixture.",
				hunkRefs: [{ filePath: "thread.ts", oldStart: 1 }],
				keyChanges: [],
			},
		],
	});
	const [diffFile] = parsePatch(`diff --git a/thread.ts b/thread.ts
--- a/thread.ts
+++ b/thread.ts
@@ -1 +1 @@
-old value
+new value
`);
	if (!diffFile) throw new Error("missing diff fixture");
	const runId = "a".repeat(64);
	const humanAuthor: ThreadAuthor = { kind: THREAD_AUTHOR_KIND.HUMAN, name: "Matt Reviewer" };
	const initial: ReviewThread = {
		id: "00000000-0000-4000-8000-000000000001",
		runId,
		anchor: {
			filePath: "thread.ts",
			oldStart: 1,
			side: "additions",
			startLine: 1,
			endLine: 1,
		},
		status: THREAD_STATUS.DEALT_WITH,
		createdAt: "2026-08-02T10:00:00.000Z",
		messages: [
			{
				id: "00000000-0000-4000-8000-000000000002",
				author: { kind: THREAD_AUTHOR_KIND.AGENT, name: "Review agent" },
				body: "Already addressed",
				createdAt: "2026-08-02T10:00:00.000Z",
			},
		],
	};
	const added: ReviewThread[] = [];
	const replied: ReviewThread[] = [];
	let quits = 0;
	const t = await testRender(
		<App
			file={threadFile}
			diffFiles={[diffFile]}
			initialThreads={[initial]}
			humanAuthor={humanAuthor}
			threadActions={{
				create: (anchor: ThreadAnchor, author: ThreadAuthor, body: string) => {
					const thread: ReviewThread = {
						...initial,
						id: "00000000-0000-4000-8000-000000000003",
						anchor,
						status: THREAD_STATUS.OPEN,
						createdAt: "2026-08-02T10:00:01.000Z",
						messages: [
							{
								id: "00000000-0000-4000-8000-000000000004",
								author,
								body,
								createdAt: "2026-08-02T10:00:01.000Z",
							},
						],
					};
					added.push(thread);
					return thread;
				},
				reply: (threadId, author, body) => {
					const target = threadId === initial.id ? initial : (added[0] ?? initial);
					const thread = {
						...target,
						messages: [
							...target.messages,
							{
								id: "00000000-0000-4000-8000-000000000005",
								author,
								body,
								createdAt: "2026-08-02T10:00:02.000Z",
							},
						],
					};
					replied.push(thread);
					return thread;
				},
				delete: () => initial,
				deleteMessage: () => {
					const root = initial.messages[0];
					if (!root) throw new Error("missing root message");
					return root;
				},
				markDealt: (id) => ({
					...(id === initial.id ? initial : (added[0] ?? initial)),
					status: THREAD_STATUS.DEALT_WITH,
				}),
				reopen: () => ({ ...initial, status: THREAD_STATUS.OPEN }),
			}}
			onQuit={() => (quits += 1)}
		/>,
		{ width: 100, height: 30, kittyKeyboard: true },
	);
	await t.renderOnce();
	expect(t.captureCharFrame()).toContain("✓ Dealt with");
	expect(t.captureCharFrame()).toContain("Agent · Review agent");
	let lifecycleLines = t.captureCharFrame().split("\n");
	let lifecycleY = lifecycleLines.findIndex((line) => line.includes("[Reopen]"));
	await click(t, lifecycleLines[lifecycleY]?.indexOf("Reopen") ?? -1, lifecycleY);
	expect(t.captureCharFrame()).toContain("! Open");
	lifecycleLines = t.captureCharFrame().split("\n");
	lifecycleY = lifecycleLines.findIndex((line) => line.includes("[Mark dealt with]"));
	await click(t, lifecycleLines[lifecycleY]?.indexOf("Mark dealt with") ?? -1, lifecycleY);
	expect(t.captureCharFrame()).toContain("✓ Dealt with");

	const lines = t.captureCharFrame().split("\n");
	const lineY = lines.findIndex((line) => line.includes("new value"));
	const sourceX = lines[lineY]?.indexOf("new value") ?? -1;
	const gutterX = lines[lineY]?.lastIndexOf("1", sourceX) ?? -1;
	await click(t, gutterX, lineY);
	const composerFrame = t.captureCharFrame();
	expect(composerFrame).toContain("New review thread");
	expect(composerFrame).toContain("thread.ts · additions · line 1");
	const composerLines = composerFrame.split("\n");
	const existingThreadActionsY = composerLines.findIndex((line) =>
		line.includes("[Delete thread]"),
	);
	const composerY = composerLines.findIndex((line) => line.includes("New review thread"));
	expect(composerY - 1).toBe(existingThreadActionsY + 1);

	await act(async () => t.mockInput.typeText("Please adjust"));
	let draftFrameLines = t.captureCharFrame().split("\n");
	let fileHeaderY = draftFrameLines.findIndex((line) => line.includes("thread.ts"));
	let collapseX = draftFrameLines[fileHeaderY]?.indexOf("▼") ?? -1;
	await click(t, collapseX, fileHeaderY);
	expect(t.captureCharFrame()).not.toContain("New review thread");
	draftFrameLines = t.captureCharFrame().split("\n");
	fileHeaderY = draftFrameLines.findIndex((line) => line.includes("thread.ts"));
	collapseX = draftFrameLines[fileHeaderY]?.indexOf("▶") ?? -1;
	await click(t, collapseX, fileHeaderY);
	expect(t.captureCharFrame()).toContain("Please adjust");

	await press(t, "q");
	expect(quits).toBe(0);
	expect(t.captureCharFrame()).toContain("Please adjustq");
	await act(async () => t.mockInput.pressEnter());
	await act(async () => t.mockInput.typeText("Second line"));
	await act(async () => t.mockInput.pressEnter({ ctrl: true }));
	await t.renderOnce();

	expect(added[0]?.messages[0]?.body).toBe("Please adjustq\nSecond line");
	expect(added[0]?.messages[0]?.author).toEqual(humanAuthor);
	expect(t.captureCharFrame()).toContain("2●");

	const replyLines = t.captureCharFrame().split("\n");
	const replyY = replyLines.findIndex((line) => line.includes("[Reply]"));
	await click(t, replyLines[replyY]?.indexOf("Reply") ?? -1, replyY);
	expect(t.captureCharFrame()).toContain("Reply to thread");
	await act(async () => t.mockInput.typeText("Human follow-up"));
	await act(async () => t.mockInput.pressEnter({ ctrl: true }));
	await t.renderOnce();
	expect(replied[0]?.messages.at(-1)).toMatchObject({
		author: humanAuthor,
		body: "Human follow-up",
	});
	expect(t.captureCharFrame()).toContain("Human · Matt Reviewer");
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
