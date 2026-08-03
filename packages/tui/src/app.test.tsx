import { afterEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { testRender as renderOpenTui } from "@opentui/react/test-utils";
import { parsePatch } from "@revue/diff-renderer";
import { resolveTheme } from "@revue/theme";
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
import type { PermalinkContext } from "./sourceLink.ts";

const PATCH = `${import.meta.dir}/../../../examples/sample-run/diff.patch`;
const theme = resolveTheme("catppuccin-mocha");
const loadPatch = async (path: string) =>
	preparePatch(await readFile(path, "utf8"), theme.syntaxTheme);
const semanticFile = (
	path: string,
	patch: string | null,
	{
		notes = [],
		additions = new Map<number, { start: number; end: number }[]>(),
	}: {
		notes?: string[];
		additions?: Map<number, { start: number; end: number }[]>;
	} = {},
) => ({
	path,
	patch,
	notes,
	emphasis: { deletions: new Map<number, { start: number; end: number }[]>(), additions },
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
	const t = await testRender(<App file={file} />, { width: 130, height: 32 });
	await t.renderOnce();
	const frame = t.captureCharFrame();

	expect(frame).toContain("revue"); // sidebar title
	expect(frame).toContain("Chapters (3)"); // sidebar index disclosure
	expect(frame).toContain("Prologue"); // sidebar entry
	expect(frame).toContain("1. Add a re"); // sidebar chapter label (single-line truncated)
	expect(frame).toContain("Dashboards stay up during deploys now"); // prologue outcome
	expect(frame).toContain("0/3 reviewed"); // none reviewed yet
});

test("the view indicator sits against the right edge, not beside the menu titles", async () => {
	const t = await testRender(<App file={file} />, { width: 110, height: 32 });
	await t.renderOnce();
	const bar = t.captureCharFrame().split("\n")[0] ?? "";

	expect(bar.trimEnd().endsWith("Patch view")).toBe(true);
	expect(bar.indexOf("Patch view") - bar.indexOf("View")).toBeGreaterThan(10);
});

test("the view indicator is dropped rather than crowding a narrow menu bar", async () => {
	const t = await testRender(<App file={file} />, { width: 24, height: 32 });
	await t.renderOnce();
	const bar = t.captureCharFrame().split("\n")[0] ?? "";

	expect(bar).toContain("File");
	expect(bar).not.toContain("Patch view");
});

test("the sidebar index walks back to the prologue from any chapter", async () => {
	const t = await testRender(<App file={file} />, { width: 130, height: 32 });
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
	await arrow(t, "right");
	const menuFrame = t.captureCharFrame();
	expect(menuFrame).toContain("[x] Patch view");
	expect(menuFrame).toContain("Semantic diff");
	expect(menuFrame).not.toContain("Next page"); // navigation lives in its own menu

	await arrow(t, "left");
	expect(t.captureCharFrame()).toContain("Next page");
	await press(t, "RETURN"); // Previous page — reachable from chapter one because the prologue is a page
	expect(t.captureCharFrame()).toContain("1/4");
});

test("View menu toggles the semantic diff without losing the focused file", async () => {
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
						semanticFile(
							"src/lib/backoff.ts",
							`--- /dev/null
+++ b/src/lib/backoff.ts
@@ -0,0 +1,1 @@
+semantic backoff
`,
							{ notes: ["added: src/lib/backoff.ts"] },
						),
						semanticFile(
							"src/lib/apiClient.ts",
							`--- a/src/lib/apiClient.ts
+++ b/src/lib/apiClient.ts
@@ -41,1 +41,1 @@
-old retry loop
+semantic retry loop
`,
							{
								notes: ["modified: src/lib/apiClient.ts"],
								additions: new Map([[41, [{ start: 0, end: 8 }]]]),
							},
						),
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
	await arrow(t, "right");
	await arrow(t, "down");
	await press(t, "RETURN");
	await act(async () => Promise.resolve());
	await t.renderOnce();
	const semanticFrame = t.captureCharFrame();
	expect(semanticFrame).toContain("Semantic view");
	expect(semanticFrame).toContain("semantic retry loop");
	expect(semanticFrame).toContain("modified: src/lib/apiClient.ts");
	expect(semanticFrame).toContain("src/lib/apiClient.ts");
	// The emphasis range covers chars 0-8, so "semantic" renders as its own restyled span.
	const emphasised = t
		.captureSpans()
		.lines.flatMap((line) => line.spans)
		.find((span) => span.text === "semantic");
	expect(emphasised).toBeDefined();

	await press(t, "F10");
	await arrow(t, "right");
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
	const semanticAdditions = Array.from(
		{ length: 30 },
		(_, index) => `+semantic row ${index + 1}`,
	).join("\n");
	const t = await testRender(
		<App
			file={scrollFile}
			diffFiles={diffFiles}
			loadSemanticDiff={async () => ({
				version: "Difftastic 0.67.0",
				files: [
					semanticFile(
						"scroll.ts",
						`--- a/scroll.ts\n+++ b/scroll.ts\n@@ -1,1 +1,30 @@\n-old row\n${semanticAdditions}\n`,
					),
				],
			})}
		/>,
		{ width: 100, height: 14, kittyKeyboard: true },
	);
	await t.renderOnce();
	for (let index = 0; index < 16; index += 1) await press(t, "j");
	expect(t.captureCharFrame()).not.toContain("patch row 1 ");

	await press(t, "F10");
	await arrow(t, "right");
	await arrow(t, "right");
	await arrow(t, "down");
	await press(t, "RETURN");
	await act(async () => Promise.resolve());
	await t.renderOnce();
	const semanticFrame = t.captureCharFrame();
	expect(semanticFrame).toContain("Semantic view");
	expect(semanticFrame).toContain("semantic row");
	expect(semanticFrame).not.toContain("semantic row 1 ");
	for (let index = 0; index < 4; index += 1) await press(t, "j");

	await press(t, "F10");
	await arrow(t, "right");
	await arrow(t, "right");
	await press(t, "RETURN");
	expect(t.captureCharFrame()).not.toContain("patch row 1 ");

	await press(t, "F10");
	await arrow(t, "right");
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
	// On the last page both Next page and Next unreviewed chapter are spent, so
	// the only selectable entry left is the one focus started on.
	await arrow(t, "down");
	await press(t, "RETURN");

	expect(t.captureCharFrame()).toContain("3/4");
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
	// Well clear of the dropdown: the file list inside the chapter's stacked narrative.
	const chapterY = chapterFrame.findIndex((line) => line.includes("src/lib/backoff.ts"));
	const checkboxX = chapterFrame[chapterY]?.indexOf("[ ]") ?? -1;

	const bar = chapterFrame[0] ?? "";
	await click(t, bar.indexOf("Navigate") + 1, 0);
	const menuLines = t.captureCharFrame().split("\n");
	const nextLine = menuLines.find((line) => line.includes("Next page")) ?? "";
	expect(nextLine).not.toContain("]c");

	// The backdrop swallows the click aimed at the chapter's review checkbox.
	await click(t, checkboxX + 1, chapterY);
	expect(seen).toHaveLength(0);
	expect(t.captureCharFrame()).not.toContain("Next page");

	await click(t, bar.indexOf("Help") + 1, 0);
	const helpLines = t.captureCharFrame().split("\n");
	const helpY = helpLines.findIndex((line) => line.includes("Keyboard shortcuts"));
	const helpX = helpLines[helpY]?.indexOf("Keyboard shortcuts") ?? -1;
	await click(t, helpX + 1, helpY);
	expect(t.captureCharFrame()).toContain("Scrolling");
});

test("s hides and restores the sidebar, giving its columns to the diff", async () => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(<App file={file} diffFiles={diffFiles} />, { width: 130, height: 32 });
	await t.renderOnce();
	await nextChapter(t);
	expect(t.captureCharFrame()).toContain("Chapters (3)");

	// Wide enough for the panel, so navigation stays inside it and no strip appears.
	const shown = t.captureCharFrame().split("\n");
	expect(shown[1]).not.toContain("Prev");
	expect(shown.some((line) => line.includes("◀ Prev") && line.includes("│"))).toBe(true);

	await press(t, "s");
	const hidden = t.captureCharFrame();
	expect(hidden).not.toContain("Chapters (3)");
	expect(hidden).toContain("MAX_RETRIES"); // the diff took the freed columns
	expect(hidden).toContain("Add a reusable backoff helper"); // the narrative stacked above it
	expect(hidden.split("\n")[1]).toContain("◀ Prev"); // the strip stands in for the panel's row

	await press(t, "s");
	expect(t.captureCharFrame()).toContain("Chapters (3)");
});

test("the keymap floats over the review instead of replacing it", async () => {
	let quits = 0;
	const t = await testRender(<App file={file} onQuit={() => (quits += 1)} />, {
		width: 110,
		height: 60,
		kittyKeyboard: true,
	});
	await t.renderOnce();
	await press(t, "?");
	const frame = t.captureCharFrame();
	expect(frame).toContain("Scrolling");
	expect(frame).toContain("Dashboards stay up during deploys now"); // the prologue is still behind it

	await press(t, "ESCAPE");
	expect(t.captureCharFrame()).not.toContain("Scrolling");
	expect(quits).toBe(0);
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
	let fileHeaderY = draftFrameLines.findIndex(
		(line) => line.includes("thread.ts") && line.includes("▼"),
	);
	let collapseX = draftFrameLines[fileHeaderY]?.indexOf("▼") ?? -1;
	await click(t, collapseX, fileHeaderY);
	expect(t.captureCharFrame()).not.toContain("New review thread");
	draftFrameLines = t.captureCharFrame().split("\n");
	fileHeaderY = draftFrameLines.findIndex(
		(line) => line.includes("thread.ts") && line.includes("▶"),
	);
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

test("the theme picker previews a palette, applies the accepted one, and reports the choice", async () => {
	const chosen: string[] = [];
	const t = await testRender(
		<App
			file={file}
			initialTheme={resolveTheme("nord")}
			onThemeChange={(next) => chosen.push(next.id)}
		/>,
		{ width: 110, height: 32 },
	);
	await t.renderOnce();
	const background = () => t.captureSpans().lines[1]?.spans[0]?.bg;
	const nordBackground = background();

	await press(t, "t");
	expect(t.captureCharFrame()).toContain("nord");

	await arrow(t, "down");
	expect(background()).not.toEqual(nordBackground);

	// A lone escape byte needs a real terminal to disambiguate; q dismisses the same way.
	await press(t, "q");
	expect(background()).toEqual(nordBackground);
	expect(chosen).toEqual([]);

	await press(t, "t");
	await arrow(t, "down");
	await act(async () => {
		t.mockInput.pressEnter();
	});
	await act(async () => {
		await t.renderOnce();
	});

	expect(t.captureCharFrame()).not.toContain("preview · enter accept");
	expect(background()).not.toEqual(nordBackground);
	expect(chosen).toEqual(["one-dark-pro"]);
});

const NEW_SHA = "b".repeat(40);
const OLD_SHA = "a".repeat(40);
const permalinks = (additions: string | null): PermalinkContext => ({
	remote: { owner: "mtford", repo: "revue" },
	shas: { additions, deletions: OLD_SHA },
});

/** The line-number cell of backoff.ts's first added line, past the sidebar divider. */
const backoffGutter = (t: Awaited<ReturnType<typeof testRender>>) => {
	const lines = t.captureCharFrame().split("\n");
	const y = lines.findIndex((line) => line.includes("Exponential backoff with a ceiling"));
	const line = lines[y] ?? "";
	return { x: line.indexOf("1", line.indexOf("│")), y };
};

/** The same line's source text, well clear of its gutter. */
const backoffCode = (t: Awaited<ReturnType<typeof testRender>>) => {
	const lines = t.captureCharFrame().split("\n");
	const y = lines.findIndex((line) => line.includes("Exponential backoff with a ceiling"));
	return { x: (lines[y] ?? "").indexOf("Exponential"), y };
};

async function rightClick(t: Awaited<ReturnType<typeof testRender>>, x: number, y: number) {
	await act(async () => {
		await t.mockMouse.click(x, y, 2);
	});
	await act(async () => {
		await t.renderOnce();
	});
}

test("right-clicking the gutter offers the range's verbs without opening a composer", async () => {
	const diffFiles = await loadPatch(PATCH);
	const copied: string[] = [];
	const t = await testRender(
		<App
			file={file}
			diffFiles={diffFiles}
			permalinks={permalinks(NEW_SHA)}
			onCopy={(text) => {
				copied.push(text);
				return true;
			}}
		/>,
		{ width: 160, height: 40 },
	);
	await t.renderOnce();
	await nextChapter(t); // chapter 1 covers backoff.ts, a new file

	const gutter = backoffGutter(t);
	await rightClick(t, gutter.x, gutter.y);
	const menu = t.captureCharFrame();
	expect(menu).toContain("Copy path:line");
	expect(menu).toContain("Copy GitHub link");
	expect(menu).toContain("Comment on selection");
	expect(menu).not.toContain("New review thread"); // the composer stayed shut

	const menuLines = menu.split("\n");
	const linkY = menuLines.findIndex((line) => line.includes("Copy GitHub link"));
	await click(t, (menuLines[linkY]?.indexOf("Copy GitHub link") ?? -1) + 1, linkY);

	expect(copied).toEqual([`https://github.com/mtford/revue/blob/${NEW_SHA}/src/lib/backoff.ts#L1`]);
	const closed = t.captureCharFrame();
	expect(closed).not.toContain("Comment on selection");
	expect(closed).toContain("Copied link:");
});

test("an uncommitted side reports why it has no link rather than handing over a wrong one", async () => {
	const diffFiles = await loadPatch(PATCH);
	const copied: string[] = [];
	const t = await testRender(
		<App
			file={file}
			diffFiles={diffFiles}
			permalinks={permalinks(null)}
			onCopy={(text) => {
				copied.push(text);
				return true;
			}}
		/>,
		{ width: 160, height: 40 },
	);
	await t.renderOnce();
	await nextChapter(t);

	const gutter = backoffGutter(t);
	await rightClick(t, gutter.x, gutter.y);
	expect(t.captureCharFrame()).toContain("Copy GitHub link (side is not committed)");

	// The disabled entry is skipped, so the keyboard lands on the verb that still works.
	await arrow(t, "down");
	await act(async () => {
		t.mockInput.pressEnter();
	});
	await act(async () => {
		await t.renderOnce();
	});
	expect(copied).toEqual([]);
	expect(t.captureCharFrame()).toContain("New review thread");
});

test("an open thread copies the range it is anchored to without losing the draft", async () => {
	const diffFiles = await loadPatch(PATCH);
	const copied: string[] = [];
	const t = await testRender(
		<App
			file={file}
			diffFiles={diffFiles}
			permalinks={permalinks(NEW_SHA)}
			onCopy={(text) => {
				copied.push(text);
				return true;
			}}
		/>,
		{ width: 160, height: 40, kittyKeyboard: true },
	);
	await t.renderOnce();
	await nextChapter(t);

	const gutter = backoffGutter(t);
	await click(t, gutter.x, gutter.y);
	expect(t.captureCharFrame()).toContain("New review thread");

	await act(async () => t.mockInput.typeText("Needs a cap"));
	await act(async () => {
		t.mockInput.pressKey("y", { ctrl: true });
	});
	await act(async () => {
		await t.renderOnce();
	});

	expect(copied).toEqual(["src/lib/backoff.ts:1"]);
	const lines = t.captureCharFrame().split("\n");
	const noticeY = lines.findIndex((line) => line.includes("Copied location: src/lib/backoff.ts:1"));
	// Inside the composer's own border, beside the draft, rather than down in the status bar.
	expect(lines[noticeY]).toContain("│");
	expect(lines.at(-2)).not.toContain("Copied location");
	expect(lines.join("\n")).toContain("Needs a cap"); // the draft survived the copy
});

test("right-clicking the code offers the same verbs as its gutter", async () => {
	const diffFiles = await loadPatch(PATCH);
	const copied: string[] = [];
	const t = await testRender(
		<App
			file={file}
			diffFiles={diffFiles}
			permalinks={permalinks(NEW_SHA)}
			onCopy={(text) => {
				copied.push(text);
				return true;
			}}
		/>,
		{ width: 160, height: 40 },
	);
	await t.renderOnce();
	await nextChapter(t);

	const code = backoffCode(t);
	await rightClick(t, code.x, code.y);
	const menu = t.captureCharFrame().split("\n");
	const pathY = menu.findIndex((line) => line.includes("Copy path:line"));
	expect(pathY).toBeGreaterThan(-1);
	await click(t, (menu[pathY]?.indexOf("Copy path:line") ?? -1) + 1, pathY);

	expect(copied).toEqual(["src/lib/backoff.ts:1"]);
});

test("dragging over code copies what was highlighted rather than the line's range", async () => {
	const diffFiles = await loadPatch(PATCH);
	const copied: string[] = [];
	const t = await testRender(
		<App
			file={file}
			diffFiles={diffFiles}
			permalinks={permalinks(NEW_SHA)}
			onCopy={(text) => {
				copied.push(text);
				return true;
			}}
		/>,
		{ width: 160, height: 40 },
	);
	await t.renderOnce();
	await nextChapter(t);

	const code = backoffCode(t);
	await act(async () => {
		await t.mockMouse.drag(code.x, code.y, code.x + 11, code.y);
	});
	await act(async () => {
		await t.renderOnce();
	});

	await press(t, "y");
	expect(copied).toEqual(["Exponential"]);
	expect(t.captureCharFrame()).toContain("Copied 1 selected line");
});

test("the pointer menu offers the highlight, and only while there is one", async () => {
	const diffFiles = await loadPatch(PATCH);
	const copied: string[] = [];
	const t = await testRender(
		<App
			file={file}
			diffFiles={diffFiles}
			permalinks={permalinks(NEW_SHA)}
			onCopy={(text) => {
				copied.push(text);
				return true;
			}}
		/>,
		{ width: 160, height: 40, kittyKeyboard: true },
	);
	await t.renderOnce();
	await nextChapter(t);

	const code = backoffCode(t);
	await rightClick(t, code.x, code.y);
	expect(t.captureCharFrame()).toContain("Copy path:line");
	expect(t.captureCharFrame()).not.toContain("Copy selected text");
	await press(t, "ESCAPE");

	await act(async () => {
		await t.mockMouse.drag(code.x, code.y, code.x + 11, code.y);
	});
	await act(async () => {
		await t.renderOnce();
	});
	await rightClick(t, code.x, code.y);
	const menu = t.captureCharFrame().split("\n");
	const textY = menu.findIndex((line) => line.includes("Copy selected text"));
	expect(textY).toBeGreaterThan(-1);
	await click(t, (menu[textY]?.indexOf("Copy selected text") ?? -1) + 1, textY);

	expect(copied).toEqual(["Exponential"]);
});

test("a highlight spanning lines carries its whole range into the pointer's verbs", async () => {
	const diffFiles = await loadPatch(PATCH);
	const copied: string[] = [];
	const t = await testRender(
		<App
			file={file}
			diffFiles={diffFiles}
			permalinks={permalinks(NEW_SHA)}
			onCopy={(text) => {
				copied.push(text);
				return true;
			}}
		/>,
		{ width: 160, height: 40 },
	);
	await t.renderOnce();
	await nextChapter(t);

	const code = backoffCode(t);
	await act(async () => {
		await t.mockMouse.drag(code.x, code.y, code.x + 6, code.y + 2);
	});
	await act(async () => {
		await t.renderOnce();
	});

	// The change markers are chrome, so no + survives into what was dragged over.
	expect(copied).toEqual([]);
	await press(t, "y");
	expect(copied[0]).not.toContain("+");
	expect(copied[0]?.split("\n")).toHaveLength(3);

	await rightClick(t, code.x, code.y + 1);
	const menu = t.captureCharFrame().split("\n");
	const pathY = menu.findIndex((line) => line.includes("Copy path:line"));
	await click(t, (menu[pathY]?.indexOf("Copy path:line") ?? -1) + 1, pathY);
	expect(copied.at(-1)).toBe("src/lib/backoff.ts:1-3");
});

test("commenting on a highlight anchors the thread to every line it covers", async () => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(<App file={file} diffFiles={diffFiles} />, { width: 160, height: 40 });
	await t.renderOnce();
	await nextChapter(t);

	const code = backoffCode(t);
	await act(async () => {
		await t.mockMouse.drag(code.x, code.y, code.x + 6, code.y + 2);
	});
	await act(async () => {
		await t.renderOnce();
	});
	await rightClick(t, code.x, code.y + 1);

	const menu = t.captureCharFrame().split("\n");
	const commentY = menu.findIndex((line) => line.includes("Comment on selection"));
	await click(t, (menu[commentY]?.indexOf("Comment on selection") ?? -1) + 1, commentY);

	expect(t.captureCharFrame()).toContain("src/lib/backoff.ts · additions · lines 1-3");
});
