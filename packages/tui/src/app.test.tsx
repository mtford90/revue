import { afterEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { RGBA } from "@opentui/core";
import { testRender as renderOpenTui } from "@opentui/react/test-utils";
import { parsePatch } from "@revue/diff";
import { resolveTheme, THEME_IDS, THEMES } from "@revue/theme";
import {
	type ReviewThread,
	type RevueChaptersFile,
	RevueChaptersFileSchema,
	type RunContextFile,
	THREAD_ANCHOR_KIND,
	THREAD_AUTHOR_KIND,
	THREAD_STATUS,
	type ThreadAnchor,
	type ThreadAuthor,
	type ViewState,
} from "@revue/types";
import { act } from "react";
import sample from "../../../examples/sample-run/chapters.json" with { type: "json" };
import { App, type ReviewUpdate } from "./app.tsx";
import { preparePatch } from "./diff.ts";
import { mergeKeymap } from "./keybindings.ts";
import { KEYMAP } from "./keymap.ts";
import { defaultPanelWidth } from "./layout.ts";
import type { Preferences } from "./preferences.ts";
import type { PermalinkContext } from "./sourceLink.ts";
import { parseCustomTheme } from "./themes.ts";
import { createThread } from "./threads.ts";
import { epilogueSession, type ReviewSessionState } from "./viewState.ts";

const PATCH = `${import.meta.dir}/../../../examples/sample-run/diff.patch`;
const theme = resolveTheme("catppuccin-mocha");
const loadPatch = async (path: string) =>
	preparePatch(await readFile(path, "utf8"), theme.syntaxTheme);
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
	await press(t, ".");
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

const statusLine = (t: Awaited<ReturnType<typeof testRender>>) =>
	t.captureCharFrame().trimEnd().split("\n").at(-1) ?? "";

test("a chapterless run opens straight onto every file with file-based progress", async () => {
	const diffFiles = await loadPatch(PATCH);
	const seen: ViewState[] = [];
	const t = await testRender(
		<App file={null} diffFiles={diffFiles} onViewStateChange={(next) => seen.push(next)} />,
		{ width: 130, height: 44 },
	);
	await t.renderOnce();
	const frame = t.captureCharFrame();

	expect(frame).toContain("All files");
	expect(frame).toContain("0/3 files");
	expect(frame).not.toContain("Chapters (");
	expect(frame).toContain("src/lib/apiClient.ts");
	expect(frame).toContain("src/lib/backoff.ts");
	expect(statusLine(t)).toContain("All files"); // the flat surface is the only page

	await press(t, "f"); // review the focused file
	expect(seen.at(-1)?.files).toContain("__files__::src/lib/apiClient.test.ts");
	expect(t.captureCharFrame()).toContain("1/3 files");
});

test("a chapterless run still reaches the Comments surface", async () => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(<App file={null} diffFiles={diffFiles} />, {
		width: 130,
		height: 44,
		kittyKeyboard: true,
	});
	await t.renderOnce();
	const bar = t.captureCharFrame().split("\n")[0] ?? "";
	expect(bar).toContain("Diff");
	expect(bar).toContain("Comments");
	expect(bar).not.toContain("Narrative"); // nothing to narrate

	await press(t, "o");
	expect(t.captureCharFrame()).toContain("No comments in this review yet.");
	expect(statusLine(t)).toContain("Comments");

	await press(t, "o"); // toggles back to the files
	expect(t.captureCharFrame()).toContain("src/lib/apiClient.ts");
	expect(statusLine(t)).not.toContain("Comments");
});

test("the Files surface never shows story paging, even without the sidebar", async () => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(<App file={file} diffFiles={diffFiles} />, {
		width: 60, // too narrow for the sidebar, so the nav strip stands in
		height: 44,
	});
	await t.renderOnce();
	expect(t.captureCharFrame()).toContain("Prev");

	await press(t, "w");
	const frame = t.captureCharFrame();
	expect(frame).toContain("All files");
	expect(frame).not.toContain("Prev");
	expect(frame).not.toContain("Next");
});

test("w jumps a narrated run to the whole diff and page navigation returns to the story", async () => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(<App file={file} diffFiles={diffFiles} />, {
		width: 130,
		height: 44,
	});
	await t.renderOnce();
	await nextChapter(t); // chapter one, so the surface toggle must work mid-story

	await press(t, "w");
	const frame = t.captureCharFrame();
	expect(frame).toContain("All files");
	expect(frame).toContain("Files (3)");
	expect(frame).toContain("src/lib/apiClient.ts");
	expect(frame).toContain("src/lib/backoff.ts");
	expect(frame).toContain("src/lib/apiClient.test.ts");
	// The surface drops every trace of the story: no chapter index, file-based progress.
	expect(frame).not.toContain("Chapters (");
	expect(frame).toContain("0/3 files");

	await press(t, "w"); // toggles straight back to the story page it left
	expect(t.captureCharFrame()).toContain("Add a reusable backoff helper");

	await press(t, "w");
	await nextChapter(t); // page navigation exits the surface into the story
	const returned = t.captureCharFrame();
	expect(returned).not.toContain("Files (3)");
	expect(statusLine(t)).toContain("Ch 2/3");
});

test("the menu bar's Narrative and Diff buttons switch surfaces with the pointer", async () => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(<App file={file} diffFiles={diffFiles} />, {
		width: 130,
		height: 44,
	});
	await t.renderOnce();
	const bar = t.captureCharFrame().split("\n")[0] ?? "";
	expect(bar).toContain("Narrative");
	expect(bar).toContain("Diff");

	await click(t, bar.indexOf("Diff") + 1, 0);
	const frame = t.captureCharFrame();
	expect(frame).toContain("Files (3)");
	expect(frame).not.toContain("Chapters (");

	await click(t, bar.indexOf("Narrative") + 1, 0);
	expect(t.captureCharFrame()).toContain("Chapters (3)");
});

test("the surface tabs abbreviate to initials when full labels no longer fit", async () => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(<App file={file} diffFiles={diffFiles} />, { width: 50, height: 44 });
	await t.renderOnce();
	const bar = t.captureCharFrame().split("\n")[0] ?? "";
	expect(bar).not.toContain("Narrative");
	expect(bar.trimEnd()).toMatch(/ N {2}D {2}C$/);

	await click(t, bar.lastIndexOf(" D ") + 1, 0);
	expect(t.captureCharFrame()).toContain("Files (3)");
});

test("the surface tabs centre on the terminal, not the space left by the menus", async () => {
	const diffFiles = await loadPatch(PATCH);
	const width = 130;
	const t = await testRender(<App file={file} diffFiles={diffFiles} />, { width, height: 44 });
	await t.renderOnce();
	const bar = t.captureCharFrame().split("\n")[0] ?? "";

	const tabsStart = bar.indexOf("Narrative") - 1;
	const tabsEnd = bar.indexOf("Comments") + "Comments".length + 1;
	expect(Math.abs((tabsStart + tabsEnd) / 2 - width / 2)).toBeLessThanOrEqual(1);
});

async function settle(t: Awaited<ReturnType<typeof testRender>>) {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await t.renderOnce();
	});
}

test("expander bands reveal pinned context lines above a hunk", async () => {
	const diffFiles = await loadPatch(PATCH);
	const blobLines = Array.from({ length: 60 }, (_, index) => `ctx ${index + 1}`);
	const t = await testRender(
		<App
			file={file}
			diffFiles={diffFiles}
			loadFileLines={async (path) => (path === "src/lib/apiClient.ts" ? blobLines : null)}
		/>,
		{ width: 130, height: 60 },
	);
	await t.renderOnce();
	await nextChapter(t);
	await nextChapter(t); // chapter 2 shows src/lib/apiClient.ts (@@ -41)
	await settle(t); // the blob lines land asynchronously

	const frame = t.captureCharFrame();
	expect(frame).toContain("expand up"); // forty unchanged lines sit above the hunk

	const lines = frame.split("\n");
	const bandY = lines.findIndex((line) => line.includes("expand up"));
	await click(t, (lines[bandY]?.indexOf("expand up") ?? -1) + 1, bandY);
	await settle(t); // highlighting the widened patch is asynchronous too

	const expanded = t.captureCharFrame();
	expect(expanded).toContain("ctx 40"); // one twenty-line step upward
	expect(expanded).toContain("ctx 21");
	expect(expanded).not.toContain("ctx 20");
	expect(expanded).toContain("expand all"); // the last twenty lines fit one reveal
});

test("opens on the prologue with the chapter list and review progress", async () => {
	const t = await testRender(<App file={file} />, { width: 130, height: 32 });
	await t.renderOnce();
	const frame = t.captureCharFrame();

	expect(frame).toContain("Chapters (3)"); // sidebar index disclosure
	expect(frame).toContain("Prologue"); // sidebar entry
	expect(frame).toContain("1. Add a re"); // sidebar chapter label (single-line truncated)
	expect(frame).toContain("Dashboards stay up during deploys now"); // prologue outcome
	expect(frame).toContain("0/3 files"); // none reviewed yet
});

test("the chapter index checkbox toggles review while the title only navigates", async () => {
	const seen: ViewState[] = [];
	const t = await testRender(<App file={file} onViewStateChange={(next) => seen.push(next)} />, {
		width: 130,
		height: 32,
	});
	await t.renderOnce();
	const lines = t.captureCharFrame().split("\n");
	const chapterY = lines.findIndex((line) => line.includes("1. Add a re"));
	const chapterLine = lines[chapterY] ?? "";

	await click(t, chapterLine.indexOf("[ ]") + 1, chapterY);
	await settle(t);
	expect(seen.at(-1)?.chapters).toContain("chapter-1");
	expect(statusLine(t)).toContain("Prologue");

	await click(t, chapterLine.indexOf("1. Add a re"), chapterY);
	await settle(t);
	expect(seen).toHaveLength(1);
	expect(statusLine(t)).toContain("Ch 1/3");
});

const twelveChapters: RevueChaptersFile = {
	...file,
	chapters: Array.from({ length: 12 }, (_, index) => ({
		id: `chapter-${index + 1}`,
		order: index + 1,
		title: `Responsive chapter ${index + 1}`,
		summary: `Summary ${index + 1}`,
		hunkRefs: [],
		keyChanges: [],
		excerpts: [],
	})),
};

test("a tall terminal expands the chapter index while a short terminal keeps it bounded", async () => {
	const width = 130;
	const indexContainsLastChapter = (frame: string) =>
		frame
			.split("\n")
			.some((line) =>
				line.slice(0, defaultPanelWidth(width)).includes("12. Responsive chapter 12"),
			);
	const short = await testRender(<App file={twelveChapters} />, { width, height: 18 });
	await short.renderOnce();
	expect(indexContainsLastChapter(short.captureCharFrame())).toBe(false);

	const tall = await testRender(<App file={twelveChapters} />, { width, height: 60 });
	await tall.renderOnce();
	expect(indexContainsLastChapter(tall.captureCharFrame())).toBe(true);
});

test("the prologue's mermaid diagram is drawn, and says so when it cannot be", async () => {
	const t = await testRender(<App file={file} />, { width: 130, height: 44 });
	await t.renderOnce();
	const drawn = t.captureCharFrame();

	expect(drawn).toContain("diagram (mermaid)");
	expect(drawn).toContain("│ Dashboard │");
	expect(drawn).toContain("retry on 503"); // the edge label survives the drawing
	expect(drawn).not.toContain("A[Dashboard]"); // and the source it was drawn from does not

	const undrawn: RevueChaptersFile = file.prologue
		? { ...file, prologue: { ...file.prologue, diagram: "stateDiagram-v2\n  [*] --> open" } }
		: file;
	const other = await testRender(<App file={undrawn} />, { width: 130, height: 44 });
	await other.renderOnce();
	const frame = other.captureCharFrame();

	expect(frame).toContain("diagram (mermaid source)");
	expect(frame).toContain("[*] --> open");
});

const withInterlude: RevueChaptersFile = {
	...file,
	chapters: [
		...file.chapters,
		{
			id: "interlude",
			order: file.chapters.length + 1,
			title: "Why the migration is staged",
			summary: "The retry work lands before the callers so nothing regresses mid-deploy.",
			hunkRefs: [],
			keyChanges: [],
			excerpts: [],
		},
	],
};

test("an interlude is an ordinary page marked as carrying no diff", async () => {
	const diffFiles = await loadPatch(PATCH);
	const seen: ViewState[] = [];
	const t = await testRender(
		<App
			file={withInterlude}
			diffFiles={diffFiles}
			onViewStateChange={(next) => seen.push(next)}
		/>,
		{ width: 130, height: 44 },
	);
	await t.renderOnce();
	expect(t.captureCharFrame()).toContain("¶ 4. Why the migration"); // the index marks it

	for (let step = 0; step < 4; step += 1) await nextChapter(t);
	const frame = t.captureCharFrame();

	expect(frame).toContain("Why the migration is staged");
	expect(frame).toContain("¶ interlude");
	expect(frame).toContain("The retry work lands"); // the prose, which the sidebar wraps
	expect(frame).not.toContain("Files ("); // no file list
	expect(frame).not.toContain("What to review");
	expect(frame).toContain("── end of chapter ──");
	expect(frame).toContain("x mark this chapter read · . next page");
	expect(statusLine(t)).toContain("Ch 4/4");

	await press(t, "x");
	expect(seen.at(-1)?.chapters).toContain("interlude");
	expect(t.captureCharFrame()).toContain("[x] ¶ 4. Why the migration");
});

const withInterludeDiagram: RevueChaptersFile = {
	...file,
	chapters: [
		...file.chapters,
		{
			id: "interlude",
			order: file.chapters.length + 1,
			title: "Why the migration is staged",
			summary: "The order matters.\n\n```ascii\nretry -> callers\n```",
			hunkRefs: [],
			keyChanges: [],
			excerpts: [],
		},
	],
};

test("an interlude draws the figure its prose is built around", async () => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(<App file={withInterludeDiagram} diffFiles={diffFiles} />, {
		width: 130,
		height: 44,
	});
	await t.renderOnce();
	for (let step = 0; step < 4; step += 1) await nextChapter(t);

	// A figure is usually the whole reason an interlude exists, so it draws without being asked.
	expect(t.captureCharFrame()).toContain("retry -> callers");
});

test("a run says when prep kept part of the change out of it", async () => {
	const diffFiles = await loadPatch(PATCH);
	// "Every unit narrated" is true of the run and says nothing about what prep dropped.
	const t = await testRender(
		<App file={file} diffFiles={diffFiles} omittedNotice="2 files omitted · .revueignore" />,
		{ width: 130, height: 44 },
	);
	await t.renderOnce();

	expect(t.captureCharFrame()).toContain("2 files omitted · .revueignore");
});

test("reopening restores the page, collapsed files, scroll, and reviewer settings", async () => {
	const diffFiles = await loadPatch(PATCH);
	const sessions: ReviewSessionState[] = [];
	const preferences: Preferences[] = [];
	const initialSession: ReviewSessionState = {
		pageId: "chapter-2",
		pages: {
			"chapter-2": {
				selectedFile: 0,
				selectedHunk: 0,
				selectedKeyChange: 0,
				collapsedFiles: ["src/lib/apiClient.ts"],
				openExcerpts: [],
				foldedDiagrams: [],
				scrollTop: 0,
				panelScrollTop: 0,
			},
		},
	};
	const t = await testRender(
		<App
			file={file}
			diffFiles={diffFiles}
			initialSessionState={initialSession}
			initialPreferences={{ sidebarPreference: "hidden", diffPreference: "stacked" }}
			onSessionStateChange={(next) => sessions.push(next)}
			onPreferencesChange={(next) => preferences.push(next)}
			onQuit={() => {}}
		/>,
		{ width: 130, height: 30 },
	);
	await t.renderOnce();

	const reopened = t.captureCharFrame();
	expect(statusLine(t)).toContain("Ch 2/3");
	expect(reopened).toContain("▶ src/lib/apiClient.ts");
	expect(reopened).not.toContain("Chapters (3)");

	await press(t, "s");
	await press(t, "q");

	expect(preferences.at(-1)).toMatchObject({
		sidebarPreference: "shown",
		diffPreference: "stacked",
	});
	expect(sessions.at(-1)).toMatchObject({
		pageId: "chapter-2",
		pages: {
			"chapter-2": {
				collapsedFiles: ["src/lib/apiClient.ts"],
				openExcerpts: [],
				foldedDiagrams: [],
				scrollTop: expect.any(Number),
			},
		},
	});
});

test("ctrl+r saves the session position and invokes onReload", async () => {
	const diffFiles = await loadPatch(PATCH);
	const sessions: ReviewSessionState[] = [];
	let reloads = 0;
	const t = await testRender(
		<App
			file={file}
			diffFiles={diffFiles}
			onSessionStateChange={(next) => sessions.push(next)}
			onReload={() => (reloads += 1)}
		/>,
		{ width: 130, height: 30, kittyKeyboard: true },
	);
	await t.renderOnce();
	await nextChapter(t);

	await act(async () => {
		t.mockInput.pressKey("r", { ctrl: true });
	});
	await act(async () => {
		await t.renderOnce();
	});

	expect(reloads).toBe(1);
	expect(sessions.at(-1)).toMatchObject({ pageId: "chapter-1" });
});

test("the status bar carries progress and the help hints", async () => {
	const t = await testRender(<App file={file} />, { width: 110, height: 32 });
	await t.renderOnce();
	const bar = statusLine(t);

	expect(bar).toContain("revue");
	expect(bar).toContain("0/3 files");
	expect(bar).not.toContain("Semantic"); // Patch is the only code representation
	expect(bar.trimEnd().endsWith("? help · q quit")).toBe(true);
});

test("a narrow status bar sheds detail rather than crowding the hints", async () => {
	const t = await testRender(<App file={file} />, { width: 24, height: 32 });
	await t.renderOnce();
	const bar = statusLine(t);

	expect(bar).toContain("? · q");
	expect(bar).not.toContain("files");
});

test("the sidebar index walks back to the prologue from any chapter", async () => {
	const t = await testRender(<App file={file} />, { width: 130, height: 32 });
	await t.renderOnce();
	await nextChapter(t);
	await nextChapter(t);
	expect(statusLine(t)).toContain("Ch 2/3");

	const lines = t.captureCharFrame().split("\n");
	const prologueY = lines.findIndex((line) => line.includes("Prologue"));
	await click(t, (lines[prologueY]?.indexOf("Prologue") ?? -1) + 1, prologueY);

	expect(statusLine(t)).toContain("Prologue");
	expect(t.captureCharFrame()).toContain("Dashboards stay up during deploys now");
});

test("the prologue's chapter list opens the chapter it names", async () => {
	const t = await testRender(<App file={file} />, { width: 110, height: 60 });
	await t.renderOnce();
	const lines = t.captureCharFrame().split("\n");
	const entryY = lines.findLastIndex((line) => line.includes("Retry transient failures"));
	await click(t, (lines[entryY]?.indexOf("Retry transient") ?? -1) + 1, entryY);

	expect(statusLine(t)).toContain("Ch 2/3");
});

test("a prologue focus area opens its matching review hint", async () => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(<App file={file} diffFiles={diffFiles} />, {
		width: 110,
		height: 60,
	});
	await t.renderOnce();
	const lines = t.captureCharFrame().split("\n");
	const focusY = lines.findIndex((line) => line.includes("Retry budget"));
	expect(focusY).toBeGreaterThan(0);
	await click(t, (lines[focusY]?.indexOf("Retry budget") ?? -1) + 1, focusY);

	expect(statusLine(t)).toContain("Ch 2/3");
	expect(t.captureCharFrame()).toContain("attempt += 1");
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

test(", walks back into the prologue instead of stopping at chapter one", async () => {
	const t = await testRender(<App file={file} />, { width: 110, height: 32 });
	await t.renderOnce();
	await nextChapter(t);
	expect(statusLine(t)).toContain("Ch 1/3");

	await press(t, ",");
	expect(statusLine(t)).toContain("Prologue");
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
	expect(menuFrame).toContain("[x] Line numbers");
	expect(menuFrame).toContain("Theme: ayu-dark");
	expect(menuFrame).not.toContain("Semantic"); // Patch is the only code representation
	expect(menuFrame).not.toContain("Next page"); // navigation lives in its own menu

	await arrow(t, "right");
	expect(t.captureCharFrame()).not.toContain("Theme: ayu-dark");
	await arrow(t, "left");
	await arrow(t, "left");
	expect(t.captureCharFrame()).toContain("Next page");
	await press(t, "RETURN"); // Previous page — reachable from chapter one because the prologue is a page
	expect(statusLine(t)).toContain("Prologue");
});

test("View menu independently persists line-number and change-marker toggles", async () => {
	const preferences: Preferences[] = [];
	const t = await testRender(
		<App file={file} onPreferencesChange={(next) => preferences.push(next)} />,
		{ width: 120, height: 42 },
	);
	await t.renderOnce();
	await press(t, "F10");
	await arrow(t, "right");
	await arrow(t, "right");
	let lines = t.captureCharFrame().split("\n");
	let y = lines.findIndex((line) => line.includes("Line numbers"));
	expect(lines[y]).toContain("[x]");
	await click(t, (lines[y]?.indexOf("Line numbers") ?? -1) + 1, y);
	expect(preferences.at(-1)?.lineNumbers).toBe(false);

	await press(t, "F10");
	await arrow(t, "right");
	await arrow(t, "right");
	lines = t.captureCharFrame().split("\n");
	y = lines.findIndex((line) => line.includes("Change markers"));
	expect(lines[y]).toContain("[x]");
	await click(t, (lines[y]?.indexOf("Change markers") ?? -1) + 1, y);
	expect(preferences.at(-1)).toMatchObject({ lineNumbers: false, changeMarkers: false });
});

test("View menu shows only the focused file and file navigation replaces it", async () => {
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
	const preferences: Preferences[] = [];
	const t = await testRender(
		<App
			file={combined}
			diffFiles={await loadPatch(PATCH)}
			initialPreferences={{ sidebarPreference: "hidden" }}
			onPreferencesChange={(next) => preferences.push(next)}
		/>,
		{ width: 120, height: 60, kittyKeyboard: true },
	);
	await t.renderOnce();
	// Both files are on screen; only backoff.ts declares the retry ceiling.
	expect(t.captureCharFrame()).toContain("MAX_RETRIES = 4");
	expect(t.captureCharFrame()).toContain("return fetch");

	await press(t, "F10");
	await arrow(t, "right");
	await arrow(t, "right");
	await arrow(t, "down");
	await arrow(t, "down");
	await arrow(t, "down");
	await press(t, "RETURN");

	expect(t.captureCharFrame()).toContain("MAX_RETRIES = 4");
	expect(t.captureCharFrame()).not.toContain("return fetch");
	expect(preferences.at(-1)).toMatchObject({ fileDisplay: "focused" });

	await press(t, "TAB");
	expect(t.captureCharFrame()).toContain("return fetch");
	expect(t.captureCharFrame()).not.toContain("MAX_RETRIES = 4");
});

test("reopening restores the exact scroll offset", async () => {
	const scrollFile = RevueChaptersFileSchema.parse({
		chapters: [
			{
				id: "restored-scroll",
				order: 1,
				title: "Restore the reader",
				summary: "The diff is longer than the viewport.",
				hunkRefs: [{ filePath: "restored.ts", oldStart: 1 }],
				keyChanges: [],
			},
		],
	});
	const additions = Array.from({ length: 30 }, (_, index) => `+restored row ${index + 1}`).join(
		"\n",
	);
	const diffFiles = parsePatch(`diff --git a/restored.ts b/restored.ts
--- a/restored.ts
+++ b/restored.ts
@@ -1 +1,30 @@
-old row
${additions}
`);
	const sessions: ReviewSessionState[] = [];
	const t = await testRender(
		<App
			file={scrollFile}
			diffFiles={diffFiles}
			initialPreferences={{ sidebarPreference: "hidden" }}
			initialSessionState={{
				pageId: "restored-scroll",
				pages: {
					"restored-scroll": {
						selectedFile: 0,
						selectedHunk: 0,
						selectedKeyChange: 0,
						collapsedFiles: [],
						openExcerpts: [],
						foldedDiagrams: [],
						scrollTop: 16,
						panelScrollTop: 0,
					},
				},
			}}
			onSessionStateChange={(next) => sessions.push(next)}
			onQuit={() => {}}
		/>,
		{ width: 100, height: 14 },
	);
	await t.renderOnce();
	await act(async () => Bun.sleep(60));
	await t.renderOnce();

	expect(t.captureCharFrame()).not.toContain("restored row 1 ");
	expect(t.captureCharFrame()).toContain("restored row");
	await press(t, "q");
	expect(sessions.at(-1)?.pages["restored-scroll"]?.scrollTop).toBe(16);
});

test("the bracket keys stay unbound now the chapter chord is retired", async () => {
	const t = await testRender(<App file={file} />, {
		width: 110,
		height: 32,
		kittyKeyboard: true,
	});
	await t.renderOnce();
	await press(t, "[");
	await press(t, "]");

	expect(statusLine(t)).toContain("Prologue");
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
	// On the last page Next page and Next unreviewed chapter are both spent, so focus
	// skips them: down reaches Diff, then Comments, and a third down wraps back
	// to Previous page.
	await arrow(t, "down");
	await arrow(t, "down");
	await arrow(t, "down");
	await press(t, "RETURN");

	expect(statusLine(t)).toContain("Ch 2/3");
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
	// Under 60 columns the dropdown drops its key hints, so the page-navigation key stays out.
	expect(nextLine).not.toContain(".");

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

test("the keys surface covers the review, keeps the bars, and gives the page back on Esc", async () => {
	let quits = 0;
	const t = await testRender(<App file={file} onQuit={() => (quits += 1)} />, {
		width: 110,
		height: 61,
		kittyKeyboard: true,
	});
	await t.renderOnce();
	await nextChapter(t);
	await press(t, "?");
	const frame = t.captureCharFrame();
	expect(frame).toContain("Here — Narrative & diff");
	expect(frame).toContain("Scrolling");
	// The surface substitutes for the review, not for the chrome: the bar underneath still names
	// the chapter you were on, which is how you get it back unchanged.
	expect(frame).toContain("File  Navigate  View  Help");
	expect(statusLine(t)).toContain("Ch 1/");

	await press(t, "ESCAPE");
	const closed = t.captureCharFrame();
	expect(closed).not.toContain("Here — Narrative & diff");
	expect(closed).toContain("Add a reusable backoff helper");
	expect(quits).toBe(0);
});

test("the keys surface documents the keys that fire here, and marks the ones that do not", async () => {
	const t = await testRender(<App file={file} />, { width: 110, height: 61, kittyKeyboard: true });
	await t.renderOnce();
	await press(t, "o"); // onto the Comments surface
	await press(t, "?");
	const frame = t.captureCharFrame();

	expect(frame).toContain("Here — Comments");
	expect(frame).toContain("Select the next thread");
	expect(frame).toContain("Jump to the selected thread");
	// Page scrolling does not fire in Comments, so it is dimmed under Elsewhere rather than
	// dropped: you would never learn it existed if it were hidden.
	expect(frame).toContain("Elsewhere — Narrative & diff · press w to get there");
	expect(frame).toContain("Scroll down half a page");
});

test("typing into the filter narrows the list without firing the actions it spells", async () => {
	let quits = 0;
	const t = await testRender(<App file={file} onQuit={() => (quits += 1)} />, {
		width: 110,
		height: 61,
		kittyKeyboard: true,
	});
	await t.renderOnce();
	await press(t, "?");
	for (const letter of ["q", "u", "i", "t"]) await press(t, letter);

	const frame = t.captureCharFrame();
	expect(frame).toContain("filter: quit");
	expect(frame).toContain("Quit (Esc also works)");
	expect(frame).not.toContain("Scroll down one line");
	// `q` quits, `u` and `i` scroll and `t` opens the theme picker — none of them may act while
	// the filter has the keyboard.
	expect(quits).toBe(0);
	expect(frame).not.toContain("Choose a theme");

	// Esc empties the filter first; only a second Esc closes.
	await press(t, "ESCAPE");
	expect(t.captureCharFrame()).toContain("Scroll down one line");
	await press(t, "ESCAPE");
	expect(t.captureCharFrame()).not.toContain("Here — Narrative & diff");
	expect(quits).toBe(0);
});

test("the status bar hints follow the surface and name the keys that are actually bound", async () => {
	const t = await testRender(<App file={file} />, { width: 130, height: 44 });
	await t.renderOnce();
	expect(statusLine(t)).toContain("j/k move");
	expect(statusLine(t)).toContain("o comments");

	// A long chapter title eats the width the hints were using, so they shed whole from the right
	// rather than truncating into half a hint.
	await nextChapter(t);
	expect(statusLine(t)).toContain("j/k move");
	expect(statusLine(t)).not.toContain("o comments");

	await press(t, "o");
	expect(statusLine(t)).toContain("Enter jump");
	expect(statusLine(t)).toContain("w files");
	expect(statusLine(t)).not.toContain("o comments");
});

test("a rebound help key changes the hint the status bar ends with", async () => {
	const { keymap } = mergeKeymap(KEYMAP, { "toggle-shortcut-help": "z" });
	const t = await testRender(<App file={file} keymap={keymap} />, { width: 130, height: 44 });
	await t.renderOnce();
	expect(statusLine(t)).toContain("z help · q quit");
});

test("a rebound action fires on its new key, its default key falls silent, and the menu hint updates", async () => {
	const { keymap } = mergeKeymap(KEYMAP, { quit: "z" });
	let quits = 0;
	const t = await testRender(<App file={file} keymap={keymap} onQuit={() => (quits += 1)} />, {
		width: 110,
		height: 32,
		kittyKeyboard: true,
	});
	await t.renderOnce();

	await press(t, "q");
	expect(quits).toBe(0);

	await press(t, "F10");
	expect(t.captureCharFrame()).toMatch(/Quit\s+z\b/);

	await press(t, "ESCAPE");
	await press(t, "z");
	expect(quits).toBe(1);
});

test("dropped keybinding overrides surface as a footer warning and help-overlay detail", async () => {
	const { keymap, issues } = mergeKeymap(KEYMAP, { "not-a-real-action": "z" });
	const t = await testRender(<App file={file} keymap={keymap} keymapIssues={issues} />, {
		width: 110,
		height: 60,
		kittyKeyboard: true,
	});
	await t.renderOnce();
	expect(t.captureCharFrame()).toContain("1 keybinding override ignored — press ? for details");

	await press(t, "?");
	const frame = t.captureCharFrame();
	expect(frame).toContain("Keybinding overrides ignored");
	expect(frame).toContain('not-a-real-action: unknown action "not-a-real-action"');
});

test("dropped theme issues surface as a footer warning and help-overlay detail, absent otherwise", async () => {
	const clean = await testRender(<App file={file} />, { width: 110, height: 60 });
	await clean.renderOnce();
	expect(clean.captureCharFrame()).not.toContain("theme issue");

	const themeIssues = [{ entry: "broken.background", reason: 'invalid colour "nope"; ignored' }];
	const t = await testRender(<App file={file} themeIssues={themeIssues} />, {
		width: 110,
		height: 60,
		kittyKeyboard: true,
	});
	await t.renderOnce();
	expect(t.captureCharFrame()).toContain("1 theme issue ignored — press ? for details");

	await press(t, "?");
	const frame = t.captureCharFrame();
	expect(frame).toContain("Theme issues ignored");
	expect(frame).toContain('broken.background: invalid colour "nope"; ignored');
});

test("dropped keybinding and theme issues combine into a single footer notice", async () => {
	const { keymap, issues: keymapIssues } = mergeKeymap(KEYMAP, { "not-a-real-action": "z" });
	const themeIssues = [{ entry: "broken.background", reason: 'invalid colour "nope"; ignored' }];
	const t = await testRender(
		<App file={file} keymap={keymap} keymapIssues={keymapIssues} themeIssues={themeIssues} />,
		{ width: 110, height: 60, kittyKeyboard: true },
	);
	await t.renderOnce();
	const frame = t.captureCharFrame();
	expect(frame).toContain("1 keybinding + 1 theme issues ignored — press ? for details");
	expect(frame).not.toContain("keybinding override ignored");
	expect(frame).not.toContain("theme issue ignored");
});

test("a chapter shows its file list with the shared directory hoisted", async () => {
	const t = await testRender(<App file={file} />, { width: 110, height: 40 });
	await t.renderOnce();
	await nextChapter(t); // into chapter 1
	const frame = t.captureCharFrame();

	expect(frame).toContain("Files (1) · in src/lib/");
	expect(frame).toContain("backoff.ts");
});

test("p cycles path display through tree and full", async () => {
	const t = await testRender(<App file={file} />, { width: 110, height: 40 });
	await t.renderOnce();
	await nextChapter(t); // into chapter 1

	await press(t, "p"); // tree
	const tree = t.captureCharFrame();
	expect(tree).toContain("src/lib/");
	expect(tree).toContain("backoff.ts");
	expect(tree).not.toContain("· in src/lib/");

	await press(t, "p"); // full
	expect(t.captureCharFrame()).toContain("src/lib/backoff.ts");

	await press(t, "p"); // back to smart
	expect(t.captureCharFrame()).toContain("Files (1) · in src/lib/");
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
	expect(frame).toContain("1/3 files");
	expect(statusLine(t)).toContain("Ch 2/3"); // auto-advanced from page 2 to page 3 (next unreviewed)
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
	const questionX = keyChangeLine.indexOf("Is a 100ms base");
	const tagX = keyChangeLine.indexOf("INFO");
	const continuationLine = lines.find((line) => line.includes("with a 5s cap")) ?? "";
	expect(tagX).toBeGreaterThan(0);
	expect(continuationLine.indexOf("with a 5s cap")).toBeLessThanOrEqual(tagX);
	await click(t, questionX, keyChangeY);
	expect(seen).toHaveLength(0);
	const focusedFrame = t.captureCharFrame();
	expect(focusedFrame).toContain("▸[ ]▼ src/lib/apiClient.ts");
	expect(focusedFrame.split("\n").find((line) => line.includes("return fetch"))).not.toContain("▌");
	expect(focusedFrame.split("\n").find((line) => line.includes("attempt += 1"))).not.toContain("▌");

	await click(t, keyChangeLine.indexOf("[ ]") + 1, keyChangeY);
	expect(seen.at(-1)?.keyChanges).toContain("chapter-1#0");
});

test("clicking a key change centres its exact anchored diff row", async () => {
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
	const hintLines = t.captureCharFrame().split("\n");
	const hintY = hintLines.findIndex((line) => line.includes("Review the exact deep line"));
	await click(t, (hintLines[hintY]?.indexOf("Review the exact deep line") ?? -1) + 1, hintY);

	const visibleLines = t.captureCharFrame().split("\n");
	const targetY = visibleLines.findIndex((line) => line.includes("exact row 25"));
	expect(targetY).toBeGreaterThanOrEqual(4);
	expect(targetY).toBeLessThanOrEqual(9);
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
			kind: THREAD_ANCHOR_KIND.HUNK,
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
	expect(t.captureCharFrame()).toContain("✓ Resolved");
	expect(t.captureCharFrame()).toContain("Agent · Review agent");
	let lifecycleLines = t.captureCharFrame().split("\n");
	const initialStatusY = lifecycleLines.findIndex((line) => line.includes("✓ Resolved"));
	expect(lifecycleLines[initialStatusY]).toContain("┌");
	let lifecycleY = lifecycleLines.findIndex((line) => line.includes("[Reopen]"));
	await click(t, lifecycleLines[lifecycleY]?.indexOf("Reopen") ?? -1, lifecycleY);
	expect(t.captureCharFrame()).toContain("! Open");
	lifecycleLines = t.captureCharFrame().split("\n");
	lifecycleY = lifecycleLines.findIndex((line) => line.includes("[Resolve]"));
	await click(t, lifecycleLines[lifecycleY]?.indexOf("Resolve") ?? -1, lifecycleY);
	expect(t.captureCharFrame()).toContain("✓ Resolved");

	const lines = t.captureCharFrame().split("\n");
	const lineY = lines.findIndex((line) => line.includes("new value"));
	const sourceX = lines[lineY]?.indexOf("new value") ?? -1;
	const gutterX = lines[lineY]?.lastIndexOf("1", sourceX) ?? -1;
	await click(t, gutterX, lineY);
	const composerFrame = t.captureCharFrame();
	expect(composerFrame).toContain("New review thread");
	expect(composerFrame).not.toContain("review unit oldStart");
	const composerLines = composerFrame.split("\n");
	const existingThreadActionsY = composerLines.findIndex((line) =>
		line.includes("[Delete thread]"),
	);
	const composerY = composerLines.findIndex((line) => line.includes("New review thread"));
	expect(composerLines[existingThreadActionsY + 1]).toContain("└");
	expect(composerY).toBe(existingThreadActionsY + 3);

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

test("o opens the Comments surface and Enter jumps back into the owning chapter", async () => {
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
	const anchor: ThreadAnchor = {
		kind: THREAD_ANCHOR_KIND.HUNK,
		filePath: "thread.ts",
		oldStart: 1,
		side: "additions",
		startLine: 1,
		endLine: 1,
	};
	const openThread: ReviewThread = {
		id: "00000000-0000-4000-8000-000000000010",
		runId,
		anchor,
		status: THREAD_STATUS.OPEN,
		createdAt: "2026-08-02T10:00:00.000Z",
		messages: [
			{
				id: "00000000-0000-4000-8000-000000000011",
				author: { kind: THREAD_AUTHOR_KIND.HUMAN, name: "Matt Reviewer" },
				body: "Rename this value",
				createdAt: "2026-08-02T10:00:00.000Z",
			},
		],
	};
	const resolvedThread: ReviewThread = {
		id: "00000000-0000-4000-8000-000000000012",
		runId,
		anchor,
		status: THREAD_STATUS.DEALT_WITH,
		createdAt: "2026-08-02T10:01:00.000Z",
		messages: [
			{
				id: "00000000-0000-4000-8000-000000000013",
				author: { kind: THREAD_AUTHOR_KIND.AGENT, name: "Review agent" },
				body: "Already addressed",
				createdAt: "2026-08-02T10:01:00.000Z",
			},
			{
				id: "00000000-0000-4000-8000-000000000014",
				author: { kind: THREAD_AUTHOR_KIND.HUMAN, name: "Matt Reviewer" },
				body: "Confirmed",
				createdAt: "2026-08-02T10:02:00.000Z",
			},
		],
	};
	const narrow = await testRender(
		<App file={threadFile} diffFiles={[diffFile]} initialThreads={[openThread, resolvedThread]} />,
		{ width: 60, height: 30 },
	);
	await narrow.renderOnce();
	const narrowBar = narrow.captureCharFrame().split("\n")[0] ?? "";
	expect(narrowBar).toContain("Comments"); // too tight for the count, so it sheds the suffix
	expect(narrowBar).not.toContain("·");

	const t = await testRender(
		<App file={threadFile} diffFiles={[diffFile]} initialThreads={[openThread, resolvedThread]} />,
		{ width: 100, height: 30, kittyKeyboard: true },
	);
	await t.renderOnce();
	expect(t.captureCharFrame()).toContain("Comments · 1"); // the tab wears the open count

	await press(t, "o");
	const listFrame = t.captureCharFrame();
	expect(statusLine(t)).toContain("Comments");
	expect(listFrame).toContain("1 open · 1 resolved");
	expect(listFrame).toContain("thread.ts:1");
	expect(listFrame).toContain("Rename this value");
	expect(listFrame).toContain("Already addressed");
	expect(listFrame).toContain("1 reply");
	expect(listFrame).not.toContain("new value"); // the list replaces the diff

	await press(t, "RETURN");
	const chapterFrame = t.captureCharFrame();
	expect(statusLine(t)).toContain("Ch 1/1");
	expect(chapterFrame).toContain("new value");
	expect(chapterFrame).toContain("Rename this value"); // the jumped-to thread is on screen
});

test("the Comments surface explains itself when the run has no threads", async () => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(<App file={file} diffFiles={diffFiles} />, {
		width: 120,
		height: 40,
		kittyKeyboard: true,
	});
	await t.renderOnce();
	await press(t, "o");
	expect(t.captureCharFrame()).toContain("No comments in this review yet.");
	await press(t, "o"); // toggles back to the story
	expect(statusLine(t)).not.toContain("Comments");
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
	expect(t.captureCharFrame()).toContain("1/3 files");
});

test("the theme picker previews a palette, applies the accepted one, and reports the choice", async () => {
	const chosen: string[] = [];
	const t = await testRender(
		<App
			file={file}
			initialThemeChoice={{ themeId: "nord" }}
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

/** Steps down the picker from `fromId` to the first theme of the other appearance. */
const stepsToOtherAppearance = (fromId: string) => {
	const start = THEME_IDS.indexOf(fromId);
	const from = THEMES[start]?.appearance;
	const target = THEMES.findIndex(
		(candidate, index) => index > start && candidate.appearance !== from,
	);
	return { steps: target - start, id: THEME_IDS[target] as string };
};

test("while following the terminal, a pick fills the half matching its own appearance", async () => {
	const preferences: Preferences[] = [];
	const t = await testRender(
		<App
			file={file}
			initialThemeChoice={{ darkThemeId: "nord" }}
			initialAppearance="dark"
			onPreferencesChange={(next) => preferences.push(next)}
		/>,
		{ width: 110, height: 32 },
	);
	await t.renderOnce();
	const background = () => t.captureSpans().lines[1]?.spans[0]?.bg;
	const nordBackground = background();

	await press(t, "t");
	expect(t.captureCharFrame()).toContain("follow terminal: on");

	const light = stepsToOtherAppearance("nord");
	for (let i = 0; i < light.steps; i++) await arrow(t, "down");
	expect(t.captureCharFrame()).toContain("enter → light theme");

	await act(async () => {
		t.mockInput.pressEnter();
	});
	await act(async () => {
		await t.renderOnce();
	});

	// The dark terminal keeps painting the dark half; only the light half moved.
	expect(background()).toEqual(nordBackground);
	expect(statusLine(t)).toContain("is now the light theme");
	expect(preferences.at(-1)).toMatchObject({ lightThemeId: light.id, darkThemeId: "nord" });
});

test("a terminal that switches to light mid-review repaints with the light half", async () => {
	let report: ((appearance: "light" | "dark") => void) | null = null;
	const t = await testRender(
		<App
			file={file}
			initialThemeChoice={{ lightThemeId: "ayu-light", darkThemeId: "nord" }}
			initialAppearance="dark"
			subscribeAppearance={(listener) => {
				report = listener;
				return () => {
					report = null;
				};
			}}
		/>,
		{ width: 110, height: 32 },
	);
	await t.renderOnce();
	const background = () => t.captureSpans().lines[1]?.spans[0]?.bg;
	const nordBackground = background();

	await act(async () => {
		report?.("light");
	});
	await act(async () => {
		await t.renderOnce();
	});

	expect(background()).not.toEqual(nordBackground);
	expect(background()?.toString()).toEqual(
		RGBA.fromHex(resolveTheme("ayu-light").background).toString(),
	);
});

test("pinning a theme stops it following the terminal", async () => {
	const preferences: Preferences[] = [];
	let report: ((appearance: "light" | "dark") => void) | null = null;
	const t = await testRender(
		<App
			file={file}
			initialThemeChoice={{ darkThemeId: "nord" }}
			initialAppearance="dark"
			subscribeAppearance={(listener) => {
				report = listener;
				return () => {
					report = null;
				};
			}}
			onPreferencesChange={(next) => preferences.push(next)}
		/>,
		{ width: 110, height: 32 },
	);
	await t.renderOnce();
	const background = () => t.captureSpans().lines[1]?.spans[0]?.bg;
	const nordBackground = background();

	await press(t, "t");
	await press(t, "a");
	expect(t.captureCharFrame()).toContain("follow terminal: off");
	expect(t.captureCharFrame()).toContain("enter accept");
	expect(preferences.at(-1)).toMatchObject({ themeId: "nord" });

	await press(t, "q");
	await act(async () => {
		report?.("light");
	});
	await act(async () => {
		await t.renderOnce();
	});
	expect(background()).toEqual(nordBackground);
});

test("a custom theme with extends and an override is selectable via the picker and paints the TUI", async () => {
	const custom = parseCustomTheme(
		"zzz-custom",
		`{ "extends": "nord", "label": "Nord, mauve", "overrides": { "background": "#2b0f2e" } }`,
	).theme;
	if (!custom) throw new Error("expected the custom theme to derive");
	const shadow = parseCustomTheme("nord", `{ "extends": "nord", "label": "Nord (mine)" }`).theme;
	if (!shadow) throw new Error("expected the shadowing theme to derive");

	const chosen: string[] = [];
	const t = await testRender(
		<App
			file={file}
			initialThemeChoice={{ themeId: "nord" }}
			customThemes={[custom, shadow]}
			onThemeChange={(next) => chosen.push(next.id)}
		/>,
		{ width: 110, height: 32 },
	);
	await t.renderOnce();
	const background = () => t.captureSpans().lines[1]?.spans[0]?.bg;
	const nordBackground = background();

	await press(t, "t");
	const listFrame = t.captureCharFrame();
	expect(listFrame).toContain("Nord (mine)");
	expect(listFrame).toContain("(customised)");
	// "nord" shadowed once, not twice.
	expect(listFrame.match(/Nord/g)).toHaveLength(1);

	// Cycle from "nord" to the pure-custom entry, slotted right after the last dark bundled theme
	// (its appearance), rather than after every bundled theme regardless of appearance.
	const lastDarkIndex = THEMES.reduce(
		(last, theme, index) => (theme.appearance === "dark" ? index : last),
		-1,
	);
	const steps = lastDarkIndex + 1 - THEME_IDS.indexOf("nord");
	for (let i = 0; i < steps; i++) await arrow(t, "down");
	const pickerFrame = t.captureCharFrame();
	expect(pickerFrame).toContain("Nord, mauve");
	expect(pickerFrame).toContain("(custom)");

	await act(async () => {
		t.mockInput.pressEnter();
	});
	await act(async () => {
		await t.renderOnce();
	});
	expect(chosen).toEqual(["zzz-custom"]);
	expect(background()).not.toEqual(nordBackground);
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

test("y flashes a Visual-mode text selection before clearing it", async () => {
	const diffFiles = await loadPatch(PATCH);
	const copied: string[] = [];
	const t = await testRender(
		<App
			file={file}
			diffFiles={diffFiles}
			onCopy={(text) => {
				copied.push(text);
				return true;
			}}
		/>,
		{ width: 160, height: 40 },
	);
	await t.renderOnce();
	await nextChapter(t);
	const lines = t.captureCharFrame().split("\n");
	const y = lines.findIndex((line) => line.includes("export function backoff"));
	const x = lines[y]?.indexOf("export") ?? -1;
	await act(async () => t.mockMouse.drag(x, y, x + 23, y));
	await t.renderOnce();
	const activeBackground = t
		.captureSpans()
		.lines[y]?.spans.find((span) => span.text.includes("export function backoff"))
		?.bg.toString();

	await press(t, "y");
	const flashedLine = t.captureCharFrame().split("\n");
	const flashedY = flashedLine.findIndex((line) => line.includes("export function backoff"));
	const flashedBackground = t
		.captureSpans()
		.lines[flashedY]?.spans.find((span) => span.text.includes("export function backoff"))
		?.bg.toString();

	expect(copied).toEqual(["export function backoff"]);
	expect(t.renderer.getSelection()).not.toBeNull();
	expect(flashedBackground).toBeDefined();
	expect(flashedBackground).not.toBe(activeBackground);

	await act(async () => {
		await Bun.sleep(200);
		await t.renderOnce();
	});
	expect(t.renderer.getSelection()).toBeNull();
});

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
	const anchors: ThreadAnchor[] = [];
	const unavailable = () => {
		throw new Error("unused thread action");
	};
	const t = await testRender(
		<App
			file={file}
			diffFiles={diffFiles}
			threadActions={{
				create: (anchor, author, body) => {
					anchors.push(anchor);
					return createThread("0".repeat(64), anchor, author, body);
				},
				reply: unavailable,
				delete: unavailable,
				deleteMessage: unavailable,
				markDealt: unavailable,
				reopen: unavailable,
			}}
		/>,
		{ width: 160, height: 40, kittyKeyboard: true },
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
	await rightClick(t, code.x, code.y + 1);

	const menu = t.captureCharFrame().split("\n");
	const commentY = menu.findIndex((line) => line.includes("Comment on selection"));
	await click(t, (menu[commentY]?.indexOf("Comment on selection") ?? -1) + 1, commentY);

	expect(t.captureCharFrame()).not.toContain("review unit oldStart");
	await act(async () => t.mockInput.typeText("Review this range"));
	await act(async () => t.mockInput.pressEnter({ ctrl: true }));
	await t.renderOnce();
	expect(anchors[0]).toMatchObject({
		filePath: "src/lib/backoff.ts",
		side: "additions",
		startLine: 1,
		endLine: 3,
	});
});

/** A distinctive word of the current chapter's narration, in the sidebar. */
const proseWord = (t: Awaited<ReturnType<typeof testRender>>, word: string) => {
	const lines = t.captureCharFrame().split("\n");
	const y = lines.findIndex((line) => line.includes(word));
	return { x: (lines[y] ?? "").indexOf(word), y, width: word.length };
};

async function dragOverProse(t: Awaited<ReturnType<typeof testRender>>, word: string) {
	const prose = proseWord(t, word);
	await act(async () => {
		await t.mockMouse.drag(prose.x, prose.y, prose.x + prose.width, prose.y);
	});
	await act(async () => {
		await t.renderOnce();
	});
	return prose;
}

test("narration yanks with the selection key, like any other selected text", async () => {
	const diffFiles = await loadPatch(PATCH);
	const copied: string[] = [];
	const t = await testRender(
		<App
			file={file}
			diffFiles={diffFiles}
			onCopy={(text) => {
				copied.push(text);
				return true;
			}}
		/>,
		{ width: 160, height: 40 },
	);
	await t.renderOnce();
	await nextChapter(t);

	await dragOverProse(t, "Introduces");
	await press(t, "y");

	expect(copied).toEqual(["Introduces"]);
	expect(t.captureCharFrame()).toContain("Copied 1 selected line");
});

test("right-clicking narration offers only the verbs prose can answer", async () => {
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

	const prose = await dragOverProse(t, "Introduces");
	await rightClick(t, prose.x, prose.y);
	const menu = t.captureCharFrame();

	expect(menu).toContain("Copy selected text");
	expect(menu).toContain("Copy with chapter reference");
	expect(menu).toContain("Copy path:line");
	expect(menu).not.toContain("Copy GitHub link"); // prose has no line to point at
	expect(menu).not.toContain("Comment on selection"); // narration takes no threads

	// Copy path:line is offered but dead, so the keyboard cannot land on it.
	const menuLines = menu.split("\n");
	const pathY = menuLines.findIndex((line) => line.includes("Copy path:line"));
	await click(t, (menuLines[pathY]?.indexOf("Copy path:line") ?? -1) + 1, pathY);
	expect(copied).toEqual([]);
	expect(t.captureCharFrame()).toContain("Copy path:line"); // a dead entry does not close the menu
});

test("copying narration with its reference quotes the prose under the chapter heading", async () => {
	const diffFiles = await loadPatch(PATCH);
	const copied: string[] = [];
	const t = await testRender(
		<App
			file={file}
			diffFiles={diffFiles}
			onCopy={(text) => {
				copied.push(text);
				return true;
			}}
		/>,
		{ width: 160, height: 40 },
	);
	await t.renderOnce();
	await nextChapter(t);

	const prose = await dragOverProse(t, "Introduces");
	await rightClick(t, prose.x, prose.y);
	const menu = t.captureCharFrame().split("\n");
	const referenceY = menu.findIndex((line) => line.includes("Copy with chapter reference"));
	await click(t, (menu[referenceY]?.indexOf("Copy with chapter reference") ?? -1) + 1, referenceY);

	expect(copied).toEqual(["Ch 1 · Add a reusable backoff helper\n> Introduces"]);
	expect(t.captureCharFrame()).toContain("Copied narration · Ch 1");
});

test("an interlude's prose yanks and references like any other chapter summary", async () => {
	const diffFiles = await loadPatch(PATCH);
	const copied: string[] = [];
	const t = await testRender(
		<App
			file={withInterlude}
			diffFiles={diffFiles}
			onCopy={(text) => {
				copied.push(text);
				return true;
			}}
		/>,
		{ width: 160, height: 40 },
	);
	await t.renderOnce();
	for (let step = 0; step < 4; step += 1) await nextChapter(t);

	const prose = await dragOverProse(t, "regresses");
	await rightClick(t, prose.x, prose.y);
	const menu = t.captureCharFrame().split("\n");
	const referenceY = menu.findIndex((line) => line.includes("Copy with chapter reference"));
	await click(t, (menu[referenceY]?.indexOf("Copy with chapter reference") ?? -1) + 1, referenceY);

	expect(copied).toEqual(["Ch 4 · Why the migration is staged\n> regresses"]);
	expect(t.captureCharFrame()).toContain("Copied narration · Ch 4");
});

const CITATION = {
	filePath: "src/lib/transport.ts",
	startLine: 12,
	endLine: 14,
	caption: "the caller this change has to satisfy",
};

const withExcerpt: RevueChaptersFile = {
	...file,
	chapters: file.chapters.map((chapter) =>
		chapter.id === "chapter-1" ? { ...chapter, excerpts: [CITATION] } : chapter,
	),
};

/** What `revue context freeze` pinned for that citation; the TUI never re-reads the file. */
const frozenContext: RunContextFile = {
	runId: "a".repeat(64),
	source: { kind: "commit", revision: "0123456789abcdef0123456789abcdef01234567" },
	excerpts: [
		{
			filePath: CITATION.filePath,
			startLine: CITATION.startLine,
			endLine: CITATION.endLine,
			lines: ["export class Transport {", "  dispatch(request) {}", "}"],
			fileSha256: "b".repeat(64),
		},
	],
	unresolved: [],
};

const FOLDED_BAND = "⋯  context · src/lib/transport.ts 12–14  [▼ show 3 lines]";

/** Click a bracketed excerpt action wherever the current frame happens to place it. */
const clickAction = async (t: Awaited<ReturnType<typeof testRender>>, marker: string) => {
	const lines = t.captureCharFrame().split("\n");
	const row = lines.findIndex((line) => line.includes(marker));
	if (row < 0) throw new Error(`no row shows ${marker}`);
	await click(t, (lines[row] ?? "").indexOf(marker) + 2, row);
};

const renderExcerptChapter = async ({
	onViewStateChange,
	onCopy,
	permalinkContext,
	initialThreads,
	threadActions,
	openChapter = true,
}: {
	onViewStateChange?: (next: ViewState) => void;
	onCopy?: (text: string) => boolean;
	permalinkContext?: PermalinkContext;
	initialThreads?: ReviewThread[];
	threadActions?: Parameters<typeof App>[0]["threadActions"];
	openChapter?: boolean;
} = {}) => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(
		<App
			file={withExcerpt}
			context={frozenContext}
			diffFiles={diffFiles}
			permalinks={permalinkContext}
			onCopy={onCopy}
			onViewStateChange={onViewStateChange}
			initialThreads={initialThreads}
			threadActions={threadActions}
		/>,
		{ width: 130, height: 44, kittyKeyboard: true },
	);
	await t.renderOnce();
	if (openChapter) await nextChapter(t);
	return t;
};

/** The line-number cell beside a quoted line, found by walking back from its code. */
const excerptGutter = (t: Awaited<ReturnType<typeof testRender>>, code: string, number: string) => {
	const lines = t.captureCharFrame().split("\n");
	const y = lines.findIndex((line) => line.includes(code));
	const line = lines[y] ?? "";
	return { x: line.lastIndexOf(number, line.indexOf(code)), y };
};

const rowBackground = (t: Awaited<ReturnType<typeof testRender>>, code: string) => {
	const y = t
		.captureCharFrame()
		.split("\n")
		.findIndex((line) => line.includes(code));
	return t
		.captureSpans()
		.lines[y]?.spans.find((span) => span.text.includes(code))
		?.bg?.toString();
};

test("a cited excerpt is folded scenery that contributes nothing to review progress", async () => {
	const seen: ViewState[] = [];
	const t = await renderExcerptChapter({ onViewStateChange: (next) => seen.push(next) });
	const frame = t.captureCharFrame();

	expect(frame).toContain(FOLDED_BAND);
	expect(frame).not.toContain("[▲ hide]");
	expect(frame).not.toContain("export class Transport");
	// The quoted file is neither a reviewable file nor a checkbox anywhere.
	expect(frame).toContain("0/3 files");
	expect(frame).not.toContain("[ ] src/lib/transport.ts");

	await press(t, "x");

	expect(seen.at(-1)?.files).toEqual(["chapter-1::src/lib/backoff.ts"]);
	expect(t.captureCharFrame()).toContain("1/3 files");
});

/** One chapter over two files, each with a citation, so placement has somewhere to go wrong. */
const twoFileChapter: RevueChaptersFile = {
	...file,
	chapters: [
		{
			...(file.chapters[0] as (typeof file.chapters)[number]),
			hunkRefs: [
				{ filePath: "src/lib/backoff.ts", oldStart: 0 },
				{ filePath: "src/lib/apiClient.ts", oldStart: 41 },
			],
			excerpts: [CITATION, { ...CITATION, startLine: 13, endLine: 14 }],
		},
		...file.chapters.slice(2),
	],
};

test("focusing one file does not drag another file's quotation onto it", async () => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(
		<App
			file={twoFileChapter}
			context={frozenContext}
			diffFiles={diffFiles}
			initialPreferences={{ fileDisplay: "focused" }}
		/>,
		{ width: 130, height: 44, kittyKeyboard: true },
	);
	await t.renderOnce();
	await nextChapter(t);

	// The first citation belongs after the first file, which is the one on screen.
	expect(t.captureCharFrame()).toContain(FOLDED_BAND);

	// Walk the file cursor to the second file; it steps through the quotation on the way.
	for (let step = 0; step < 4 && !t.captureCharFrame().includes("return fetch"); step += 1) {
		await press(t, "TAB");
	}

	// The second citation follows the second file; the first must not have travelled with it.
	const frame = t.captureCharFrame();
	expect(frame).toContain("return fetch");
	expect(frame).not.toContain(FOLDED_BAND);
});

test("clicking the band opens the excerpt in place, caption above its header", async () => {
	const t = await renderExcerptChapter();

	await clickAction(t, "[▼ show");
	const opened = t.captureCharFrame().split("\n");
	const captionRow = opened.findIndex((line) => line.includes("the caller this change"));
	const headerRow = opened.findIndex((line) => line.includes("context · src/lib/transport.ts"));

	expect(opened.join("\n")).toContain("[▲ hide]");
	expect(opened.join("\n")).toContain("export class Transport {");
	expect(opened.join("\n")).toContain("  dispatch(request) {}");
	expect(captionRow).toBeGreaterThanOrEqual(0);
	expect(captionRow).toBe(headerRow - 1);

	await clickAction(t, "[▲ hide]");

	expect(t.captureCharFrame()).toContain(FOLDED_BAND);
});

test("dragging a quoted line's gutter tints the range and y yanks the quotation", async () => {
	const copied: string[] = [];
	const t = await renderExcerptChapter({
		onCopy: (text) => {
			copied.push(text);
			return true;
		},
	});
	await clickAction(t, "[▼ show");
	const untinted = rowBackground(t, "export class Transport {");

	const first = excerptGutter(t, "export class Transport {", "12");
	const second = excerptGutter(t, "dispatch(request)", "13");
	await act(async () => {
		await t.mockMouse.drag(first.x, first.y, second.x, second.y);
	});
	await act(async () => {
		await t.renderOnce();
	});

	const tint = RGBA.fromHex(resolveTheme(undefined).selectedHunk).toString();
	expect(rowBackground(t, "export class Transport {")).toBe(tint);
	expect(rowBackground(t, "dispatch(request)")).toBe(tint);
	expect(untinted).not.toBe(tint);
	// No composer: an excerpt line takes no comment, so the selection simply stands.
	expect(t.captureCharFrame()).not.toContain("New review thread");

	await press(t, "y");
	expect(copied).toEqual(["export class Transport {\n  dispatch(request) {}"]);
	expect(t.captureCharFrame()).toContain("Copied 2 selected lines");
});

test("an excerpt line answers the full range menu against its own file and lines", async () => {
	const copied: string[] = [];
	const t = await renderExcerptChapter({
		permalinkContext: permalinks(NEW_SHA),
		onCopy: (text) => {
			copied.push(text);
			return true;
		},
	});
	await clickAction(t, "[▼ show");

	const first = excerptGutter(t, "export class Transport {", "12");
	const second = excerptGutter(t, "dispatch(request)", "13");
	await act(async () => {
		await t.mockMouse.drag(first.x, first.y, second.x, second.y);
	});
	await act(async () => {
		await t.renderOnce();
	});
	await rightClick(t, first.x, first.y);

	const menu = t.captureCharFrame();
	expect(menu).toContain("Copy selected text");
	expect(menu).toContain("Copy path:line");
	expect(menu).toContain("Copy GitHub link");
	expect(menu).toContain("Comment on selection");

	const menuLines = menu.split("\n");
	const pathY = menuLines.findIndex((line) => line.includes("Copy path:line"));
	await click(t, (menuLines[pathY]?.indexOf("Copy path:line") ?? -1) + 1, pathY);
	// The quoted file, not the chapter's diffed file, and the citation's own line numbers.
	expect(copied).toEqual(["src/lib/transport.ts:12-13"]);

	await rightClick(t, first.x, first.y);
	const reopened = t.captureCharFrame().split("\n");
	const linkY = reopened.findIndex((line) => line.includes("Copy GitHub link"));
	await click(t, (reopened[linkY]?.indexOf("Copy GitHub link") ?? -1) + 1, linkY);

	expect(copied.at(-1)).toBe(
		`https://github.com/mtford/revue/blob/${NEW_SHA}/src/lib/transport.ts#L12-L13`,
	);
});

test("an uncommitted new side blocks a quoted line's link for the same stated reason", async () => {
	const t = await renderExcerptChapter({ permalinkContext: permalinks(null) });
	await clickAction(t, "[▼ show");

	const gutter = excerptGutter(t, "export class Transport {", "12");
	await rightClick(t, gutter.x, gutter.y);

	expect(t.captureCharFrame()).toContain("Copy GitHub link (side is not committed)");
});

test("the file cursor steps onto an excerpt so the existing toggle key opens it", async () => {
	const t = await renderExcerptChapter();

	await press(t, "TAB"); // off the chapter's only file, onto the excerpt that follows it
	await press(t, "RETURN");

	expect(t.captureCharFrame()).toContain("export class Transport {");

	await press(t, "RETURN");

	expect(t.captureCharFrame()).toContain(FOLDED_BAND);
});

const excerptThread = ({
	id,
	startLine,
	endLine,
	body,
}: {
	id: string;
	startLine: number;
	endLine: number;
	body: string;
}): ReviewThread => ({
	id,
	runId: frozenContext.runId,
	anchor: {
		kind: THREAD_ANCHOR_KIND.EXCERPT,
		filePath: CITATION.filePath,
		startLine,
		endLine,
	},
	status: THREAD_STATUS.OPEN,
	createdAt: "2026-08-02T10:00:00.000Z",
	messages: [
		{
			id: `${id.slice(0, -1)}9`,
			author: { kind: THREAD_AUTHOR_KIND.HUMAN, name: "Matt Reviewer" },
			body,
			createdAt: "2026-08-02T10:00:00.000Z",
		},
	],
});

test("Enter on a quoted selection starts a thread anchored to the excerpt, not to a hunk", async () => {
	const created: ThreadAnchor[] = [];
	const t = await renderExcerptChapter({
		threadActions: {
			create: (anchor, author, body) => {
				created.push(anchor);
				return {
					...excerptThread({
						id: "00000000-0000-4000-8000-000000000021",
						startLine: 12,
						endLine: 13,
						body,
					}),
					anchor,
					messages: [
						{
							id: "00000000-0000-4000-8000-000000000022",
							author,
							body,
							createdAt: "2026-08-02T10:00:01.000Z",
						},
					],
				};
			},
			reply: () => {
				throw new Error("unused");
			},
			delete: () => {
				throw new Error("unused");
			},
			deleteMessage: () => {
				throw new Error("unused");
			},
			markDealt: () => {
				throw new Error("unused");
			},
			reopen: () => {
				throw new Error("unused");
			},
		},
	});
	await clickAction(t, "[▼ show");

	const first = excerptGutter(t, "export class Transport {", "12");
	const second = excerptGutter(t, "dispatch(request)", "13");
	await act(async () => {
		await t.mockMouse.drag(first.x, first.y, second.x, second.y);
	});
	await act(async () => {
		await t.renderOnce();
	});
	await press(t, "RETURN");

	expect(t.captureCharFrame()).toContain("New review thread");

	await act(async () => t.mockInput.typeText("Does this caller still hold?"));
	await act(async () => t.mockInput.pressEnter({ ctrl: true }));
	await t.renderOnce();

	// The load-bearing assertion: quoted code takes its own anchor kind. Borrowing oldStart 0
	// would make it indistinguishable from a thread on a metadata review unit.
	expect(created).toEqual([
		{
			kind: THREAD_ANCHOR_KIND.EXCERPT,
			filePath: "src/lib/transport.ts",
			startLine: 12,
			endLine: 13,
		},
	]);
	const settled = t.captureCharFrame();
	expect(settled).not.toContain("New review thread");
	expect(settled).toContain("Does this caller still hold?");
	// The attachment marker slot in the excerpt gutter now carries the count.
	const quotedRow = settled.split("\n")[excerptGutter(t, "dispatch(request)", "13").y] ?? "";
	expect(quotedRow).toContain("13 1●");
});

test("excerpt threads list in the Comments surface, marked when the narrative stopped quoting them", async () => {
	const t = await renderExcerptChapter({
		openChapter: false,
		initialThreads: [
			excerptThread({
				id: "00000000-0000-4000-8000-000000000031",
				startLine: 12,
				endLine: 12,
				body: "Why does this stay synchronous?",
			}),
			excerptThread({
				id: "00000000-0000-4000-8000-000000000032",
				startLine: 90,
				endLine: 90,
				body: "Raised against a range the narrative dropped",
			}),
		],
	});

	await press(t, "o");
	const list = t.captureCharFrame();

	expect(list).toContain("src/lib/transport.ts:12");
	expect(list).toContain("Why does this stay synchronous?");
	// Kept and shown rather than pruned, and visibly distinguished from a live anchor.
	expect(list).toContain("src/lib/transport.ts:90 · no longer quoted");
	expect(list).toContain("Raised against a range the narrative dropped");

	await press(t, "RETURN");
	const chapterFrame = t.captureCharFrame();

	expect(statusLine(t)).toContain("Ch 1/");
	// Jumping opens the folded excerpt the thread hangs off, so the feedback is actually visible.
	expect(chapterFrame).toContain("export class Transport {");
	expect(chapterFrame).toContain("Why does this stay synchronous?");
});

/** The chrome an excerpt reserves before its code at the excerpt's default numbering width. */
const EXCERPT_GUTTER_COLUMNS = 17;

const ASCII_FIGURE = "prep ──▶ chapters.json ──▶ show";
const MERMAID_FLOWCHART = "graph LR; prep[revue prep] --> show[revue show]";
/** A box the flowchart above is drawn as, which its own source never contains. */
const MERMAID_DRAWN_BOX = "│ revue prep │";
/** Outside the drawn subset, so this block holds the author's source exactly as written. */
const MERMAID_UNDRAWN = "sequenceDiagram";
const MERMAID_UNDRAWN_LINE = "reviewer ->> agent: comment";

/** An interlude whose narration carries the figures as fenced blocks, and no diff at all. */
const withDiagrams: RevueChaptersFile = {
	...withExcerpt,
	chapters: [
		...withExcerpt.chapters,
		{
			id: "interlude",
			order: withExcerpt.chapters.length + 1,
			title: "How prep and show fit together",
			summary: [
				"Prep freezes the run; show only ever reads it.",
				"",
				"```ascii",
				ASCII_FIGURE,
				"```",
				"",
				"```mermaid",
				MERMAID_FLOWCHART,
				"```",
				"",
				"```mermaid",
				MERMAID_UNDRAWN,
				`  ${MERMAID_UNDRAWN_LINE}`,
				"```",
			].join("\n"),
			hunkRefs: [],
			keyChanges: [],
			excerpts: [],
		},
	],
};

/** The column a rendered line's own text starts on, ignoring the chrome before it. */
const textColumn = (t: Awaited<ReturnType<typeof testRender>>, needle: string) => {
	const line = t
		.captureCharFrame()
		.split("\n")
		.find((row) => row.includes(needle));
	if (line === undefined) throw new Error(`no row shows ${needle}`);
	return line.indexOf(needle);
};

/** The block rule immediately left of a rendered line, past the sidebar's own divider. */
const ruleColumn = (t: Awaited<ReturnType<typeof testRender>>, needle: string) => {
	const line =
		t
			.captureCharFrame()
			.split("\n")
			.find((row) => row.includes(needle)) ?? "";
	return line.lastIndexOf("│", line.indexOf(needle));
};

const textColour = (t: Awaited<ReturnType<typeof testRender>>, needle: string) => {
	const y = t
		.captureCharFrame()
		.split("\n")
		.findIndex((line) => line.includes(needle));
	return t
		.captureSpans()
		.lines[y]?.spans.find((span) => span.text.includes(needle))
		?.fg?.toString();
};

const gotoChapter = async (t: Awaited<ReturnType<typeof testRender>>, order: number) => {
	for (let step = 0; step < 8 && !statusLine(t).includes(`Ch ${order}/`); step += 1) {
		await nextChapter(t);
	}
	if (!statusLine(t).includes(`Ch ${order}/`)) throw new Error(`never reached chapter ${order}`);
};

/** Click the fold action on the band or header that carries a given label. */
const clickBlockAction = async (t: Awaited<ReturnType<typeof testRender>>, label: string) => {
	const lines = t.captureCharFrame().split("\n");
	const row = lines.findIndex((line) => line.includes(label));
	if (row < 0) throw new Error(`no foldable row shows ${label}`);
	const line = lines[row] ?? "";
	// The sidebar shares the terminal row, so the action is the bracket after the label itself.
	await click(t, line.indexOf("[", line.indexOf(label)) + 2, row);
};

test("an interlude's diagrams fold, open, and line up with quoted code", async () => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(
		<App file={withDiagrams} context={frozenContext} diffFiles={diffFiles} />,
		{ width: 130, height: 44 },
	);
	await t.renderOnce();
	await gotoChapter(t, 4);
	const opened = t.captureCharFrame();

	// A figure draws without being asked; an interlude often has nothing else on the page.
	expect(opened).toContain("diagram · ascii");
	expect(opened).toContain("[▲ hide]");
	expect(opened).toContain(ASCII_FIGURE);
	// A supported flowchart is drawn rather than transcribed, so its own source never appears.
	expect(opened).toContain("diagram · mermaid ");
	expect(opened).toContain(MERMAID_DRAWN_BOX);
	expect(opened).not.toContain(MERMAID_FLOWCHART);
	// Mermaid outside the drawn subset keeps its source, and the label says so.
	expect(opened).toContain("diagram · mermaid source");
	expect(opened).toContain(MERMAID_UNDRAWN_LINE);
	// The fences never reach the narration, which keeps its own prose.
	expect(opened).toContain("Prep freezes the run");
	expect(opened).not.toContain("```");
	// A figure has no line numbers, yet reserves the quoted block's whole gutter before its text.
	expect(textColumn(t, ASCII_FIGURE) - ruleColumn(t, ASCII_FIGURE)).toBe(EXCERPT_GUTTER_COLUMNS);
	// A drawing is the figure itself; undrawn Mermaid is source, so it reads as a label would.
	expect(textColour(t, ASCII_FIGURE)).toBe(RGBA.fromHex(resolveTheme(undefined).text).toString());
	expect(textColour(t, MERMAID_DRAWN_BOX)).toBe(
		RGBA.fromHex(resolveTheme(undefined).text).toString(),
	);
	expect(textColour(t, MERMAID_UNDRAWN_LINE)).toBe(
		RGBA.fromHex(resolveTheme(undefined).muted).toString(),
	);

	await clickBlockAction(t, "diagram · ascii");
	const folded = t.captureCharFrame();

	expect(folded).toContain("⋯  diagram · ascii  [▼ show 1 line]");
	expect(folded).not.toContain(ASCII_FIGURE);
	// Folding one figure leaves its neighbours alone.
	expect(folded).toContain(MERMAID_DRAWN_BOX);
	// The close still ends the page, below the figures rather than above them.
	expect(folded).toContain("── end of chapter ──");

	await clickBlockAction(t, "diagram · ascii");

	expect(t.captureCharFrame()).toContain(ASCII_FIGURE);
});

test("a fenced snippet in narration renders as code rather than raw backticks", async () => {
	const snippet = "revue show .revue/runs/latest";
	const withSnippet: RevueChaptersFile = {
		...file,
		chapters: file.chapters.map((chapter, index) =>
			index === 0
				? { ...chapter, summary: ["Run it yourself:", "```sh", snippet, "```"].join("\n") }
				: chapter,
		),
	};
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(<App file={withSnippet} diffFiles={diffFiles} />, {
		width: 130,
		height: 44,
	});
	await t.renderOnce();
	await nextChapter(t);
	const frame = t.captureCharFrame();

	expect(frame).toContain("Run it yourself:");
	expect(frame).toContain(snippet);
	expect(frame).not.toContain("```");
	// A snippet is code, not a diagram: it stays in the narration and gets no fold.
	expect(frame).not.toContain("diagram · ");
	expect(frame).not.toContain("[▼ show");
});

test("the epilogue ends the story, links its threads, and leaves carried progress alone", async () => {
	const runId = "a".repeat(64);
	const threadId = "00000000-0000-4000-8000-000000000020";
	const supersedingFile = RevueChaptersFileSchema.parse({
		chapters: [
			{
				id: "carried",
				order: 1,
				title: "The value it starts from",
				summary: "Untouched by the fix, so you have read this already.",
				hunkRefs: [{ filePath: "value.ts", oldStart: 1 }],
				keyChanges: [],
			},
			{
				id: "epilogue",
				order: 2,
				role: "epilogue",
				title: "Changes since your review",
				summary: "The retry budget is shared now, as you asked.",
				hunkRefs: [{ filePath: "retry.ts", oldStart: 1 }],
				keyChanges: [],
				threadRefs: [threadId],
			},
		],
	});
	const diffFiles = parsePatch(`diff --git a/value.ts b/value.ts
--- a/value.ts
+++ b/value.ts
@@ -1 +1 @@
-old value
+new value
diff --git a/retry.ts b/retry.ts
--- a/retry.ts
+++ b/retry.ts
@@ -1 +1 @@
-retry(own)
+retry(shared)
`);
	const thread: ReviewThread = {
		id: threadId,
		runId,
		migratedFrom: "b".repeat(64),
		anchor: {
			kind: THREAD_ANCHOR_KIND.HUNK,
			filePath: "retry.ts",
			oldStart: 1,
			side: "additions",
			startLine: 1,
			endLine: 1,
		},
		status: THREAD_STATUS.OPEN,
		createdAt: "2026-08-02T10:00:00.000Z",
		messages: [
			{
				id: "00000000-0000-4000-8000-000000000021",
				author: { kind: THREAD_AUTHOR_KIND.HUMAN, name: "Matt Reviewer" },
				body: "Share the retry budget",
				createdAt: "2026-08-02T10:00:00.000Z",
			},
		],
	};
	const t = await testRender(
		<App
			file={supersedingFile}
			diffFiles={diffFiles}
			initialThreads={[thread]}
			initialViewState={{
				chapters: ["carried"],
				files: ["carried::value.ts"],
				keyChanges: [],
			}}
		/>,
		{ width: 110, height: 34, kittyKeyboard: true },
	);
	await t.renderOnce();

	// The chapter carried through supersession keeps the mark it was read under.
	expect(t.captureCharFrame()).toContain("[x] Chapter 1/2");

	await nextChapter(t);
	const frame = t.captureCharFrame();
	expect(frame).toContain("[ ] Chapter 2/2"); // the epilogue is new, so it is unread
	expect(frame).toContain("Changes since your review");
	expect(frame).toContain("In reply to");
	expect(frame).toContain("retry.ts:1");
	expect(frame).toContain("Share the retry budget");
	expect(frame).toContain("retry(shared)"); // and it narrates the fix hunk itself

	// The citation is the first stop on the chapter walk, and Enter opens the conversation.
	await press(t, "J");
	expect(t.captureCharFrame()).toContain("▸ retry.ts:1");
	await act(async () => {
		t.mockInput.pressEnter();
	});
	await act(async () => {
		await t.renderOnce();
	});

	expect(statusLine(t)).toContain("Comments");
	expect(t.captureCharFrame()).toContain("1 open · 0 resolved");
	expect(t.captureCharFrame()).toContain("Share the retry budget");
});

// ── Watching a live review ───────────────────────────────────────────────────
// The TUI adopts what the agent writes without being asked, so these drive the App with injected
// watcher updates: filesystem-watch timing belongs to watch.test.ts, not to a render test.

const WATCHED_RUN = "a".repeat(64);
const HUMAN: ThreadAuthor = { kind: THREAD_AUTHOR_KIND.HUMAN, name: "Matt Reviewer" };
const AGENT: ThreadAuthor = { kind: THREAD_AUTHOR_KIND.AGENT, name: "Review agent" };

const watchedChapters = RevueChaptersFileSchema.parse({
	chapters: [
		{
			id: "watched",
			order: 1,
			title: "The retry budget",
			summary: "Three lines worth arguing about.",
			hunkRefs: [{ filePath: "retry.ts", oldStart: 1 }],
			keyChanges: [],
		},
	],
});

const watchedDiff = parsePatch(`diff --git a/retry.ts b/retry.ts
--- a/retry.ts
+++ b/retry.ts
@@ -1,3 +1,3 @@
-retry(one)
-retry(two)
-retry(three)
+retry(alpha)
+retry(beta)
+retry(gamma)
`);

const watchedThread = ({
	line,
	body,
	reply,
}: {
	line: number;
	body: string;
	reply?: string;
}): ReviewThread => ({
	id: `00000000-0000-4000-8000-00000000004${line}`,
	runId: WATCHED_RUN,
	anchor: {
		kind: THREAD_ANCHOR_KIND.HUNK,
		filePath: "retry.ts",
		oldStart: 1,
		side: "additions",
		startLine: line,
		endLine: line,
	},
	status: THREAD_STATUS.OPEN,
	createdAt: `2026-08-02T10:0${line}:00.000Z`,
	messages: [
		{
			id: `00000000-0000-4000-8000-00000000005${line}`,
			author: HUMAN,
			body,
			createdAt: `2026-08-02T10:0${line}:00.000Z`,
		},
		...(reply
			? [
					{
						id: `00000000-0000-4000-8000-00000000006${line}`,
						author: AGENT,
						body: reply,
						createdAt: `2026-08-02T11:0${line}:00.000Z`,
					},
				]
			: []),
	],
});

/** A stand-in for the filesystem watcher: the same seam, driven by the test rather than by disk. */
const updateDriver = () => {
	const listeners: ((update: ReviewUpdate) => void)[] = [];
	return {
		subscribe: (listener: (update: ReviewUpdate) => void) => {
			listeners.push(listener);
			return () => {
				listeners.splice(listeners.indexOf(listener), 1);
			};
		},
		emit: async (t: Awaited<ReturnType<typeof testRender>>, update: ReviewUpdate) => {
			await act(async () => {
				for (const listener of [...listeners]) listener(update);
			});
			await act(async () => {
				await t.renderOnce();
			});
		},
	};
};

const rowOf = (t: Awaited<ReturnType<typeof testRender>>, needle: string) =>
	t
		.captureCharFrame()
		.split("\n")
		.findIndex((line) => line.includes(needle));

test("an agent reply lands in the open review without a keypress, leaving the page where it was", async () => {
	const driver = updateDriver();
	const thread = watchedThread({ line: 1, body: "Share the retry budget" });
	const t = await testRender(
		<App
			file={watchedChapters}
			diffFiles={watchedDiff}
			initialThreads={[thread]}
			subscribeUpdates={driver.subscribe}
		/>,
		{ width: 110, height: 34, kittyKeyboard: true },
	);
	await t.renderOnce();
	await nextChapter(t);
	const before = rowOf(t, "retry(alpha)");
	expect(t.captureCharFrame()).not.toContain("Budget is shared now");

	await driver.emit(t, {
		kind: "threads",
		threads: [
			watchedThread({ line: 1, body: "Share the retry budget", reply: "Budget is shared now" }),
		],
		orphaned: [],
	});

	const frame = t.captureCharFrame();
	expect(frame).toContain("Budget is shared now");
	expect(frame).toContain("Review agent");
	// The narration under the reviewer's eyes did not move, and neither did the page they were on.
	expect(rowOf(t, "retry(alpha)")).toBe(before);
	expect(statusLine(t)).toContain("Ch 1/1");
});

test("threads awaiting the reviewer's verdict lead the Comments surface, and selection follows its thread", async () => {
	const driver = updateDriver();
	const threads = [
		watchedThread({ line: 1, body: "Share the retry budget" }),
		watchedThread({ line: 2, body: "Name this constant" }),
		watchedThread({ line: 3, body: "Why three retries?" }),
	];
	const t = await testRender(
		<App
			file={watchedChapters}
			diffFiles={watchedDiff}
			initialThreads={threads}
			subscribeUpdates={driver.subscribe}
		/>,
		{ width: 110, height: 34, kittyKeyboard: true },
	);
	await t.renderOnce();
	await press(t, "o");
	await arrow(t, "down"); // the reviewer is standing on the second thread

	expect(rowOf(t, "retry.ts:1")).toBeLessThan(rowOf(t, "retry.ts:3"));
	expect(t.captureCharFrame().split("\n")[rowOf(t, "retry.ts:2")]).toContain("▸");

	await driver.emit(t, {
		kind: "threads",
		threads: [
			threads[0] as ReviewThread,
			threads[1] as ReviewThread,
			watchedThread({ line: 3, body: "Why three retries?", reply: "Three is the tested budget" }),
		],
		orphaned: [],
	});

	// The answered thread is now the reviewer's to close, so it leads.
	expect(rowOf(t, "retry.ts:3")).toBeLessThan(rowOf(t, "retry.ts:1"));
	// And the reviewer is still standing on the thread they picked, not on its old row.
	expect(t.captureCharFrame().split("\n")[rowOf(t, "retry.ts:2")]).toContain("▸");
});

test("a carried thread this run no longer anchors is marked, not hidden", async () => {
	const thread = watchedThread({ line: 1, body: "Share the retry budget" });
	const t = await testRender(
		<App
			file={watchedChapters}
			diffFiles={watchedDiff}
			initialThreads={[thread]}
			initialOrphanedThreads={[thread.id]}
		/>,
		{ width: 110, height: 34, kittyKeyboard: true },
	);
	await t.renderOnce();
	await press(t, "o");

	expect(t.captureCharFrame()).toContain("retry.ts:1 · no longer quoted");
	expect(t.captureCharFrame()).toContain("Share the retry budget");
});

test("a superseding run raises a banner, changes nothing on its own, and redirects the reload key", async () => {
	const driver = updateDriver();
	let reloads = 0;
	const t = await testRender(
		<App
			file={watchedChapters}
			diffFiles={watchedDiff}
			subscribeUpdates={driver.subscribe}
			onReload={() => (reloads += 1)}
		/>,
		{ width: 110, height: 34, kittyKeyboard: true },
	);
	await t.renderOnce();
	await nextChapter(t);
	expect(t.captureCharFrame()).not.toContain("Revue updated");

	await driver.emit(t, {
		kind: "superseded",
		summary: "1 chapter revised, epilogue added",
	});

	const frame = t.captureCharFrame();
	expect(frame).toContain("Revue updated: 1 chapter revised, epilogue added");
	expect(frame).toContain("press Ctrl-r to read what changed");
	expect(frame).toContain("retry(alpha)"); // the review itself never moves under the reviewer
	expect(statusLine(t)).toContain("Ch 1/1");

	await act(async () => {
		t.mockInput.pressKey("r", { ctrl: true });
	});
	await act(async () => {
		await t.renderOnce();
	});
	expect(reloads).toBe(1);
});

test("following the banner opens the superseding run on its epilogue", async () => {
	const supersedingFile = RevueChaptersFileSchema.parse({
		chapters: [
			{
				id: "watched",
				order: 1,
				title: "The retry budget",
				summary: "Untouched by the fix, so you have read this already.",
				hunkRefs: [{ filePath: "retry.ts", oldStart: 1 }],
				keyChanges: [],
			},
			{
				id: "epilogue",
				order: 2,
				role: "epilogue",
				title: "Changes since your review",
				summary: "The retry budget is shared now, as you asked.",
				hunkRefs: [],
				keyChanges: [],
			},
		],
	});
	const t = await testRender(
		<App
			file={supersedingFile}
			diffFiles={watchedDiff}
			initialSessionState={epilogueSession(supersedingFile)}
		/>,
		{ width: 110, height: 34, kittyKeyboard: true },
	);
	await t.renderOnce();

	expect(statusLine(t)).toContain("Ch 2/2");
	expect(t.captureCharFrame()).toContain("Changes since your review");
});
