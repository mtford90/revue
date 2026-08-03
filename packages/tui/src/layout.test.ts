import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolveTheme } from "@revue/theme";
import type { ChapterDiffFile } from "./diff.ts";
import { preparePatch } from "./diff.ts";
import { layoutForFile, resolveLayout } from "./layout.ts";

const PATCH = `${import.meta.dir}/../../../examples/sample-run/diff.patch`;
const theme = resolveTheme("catppuccin-mocha");

const chapterFile = async (path: string): Promise<ChapterDiffFile> => {
	const files = await preparePatch(await readFile(PATCH, "utf8"), theme.syntaxTheme);
	const file = files.find((candidate) => candidate.path === path);
	if (!file) throw new Error(`no ${path} in the sample patch`);
	return { ...file, chapterPath: path };
};

const layout = (
	terminalWidth: number,
	sidebar: "auto" | "shown" | "hidden",
	diff: "auto" | "split" | "stacked",
	requestedSidebarWidth = 30,
) => resolveLayout({ terminalWidth, requestedSidebarWidth, sidebar, diff });

/** A terminal wide enough for the panel, with the divider dragged past its keep. */
const widened = (sidebar: "auto" | "shown" | "hidden", diff: "auto" | "split" | "stacked") =>
	layout(120, sidebar, diff, 55);

test("a terminal too narrow for the panel drops it even when it is pinned open", () => {
	expect(layout(50, "shown", "auto").showSidebar).toBe(false);
	expect(layout(50, "auto", "auto").showSidebar).toBe(false);
});

test("the sidebar yields once it would leave too little room to read a diff", () => {
	// Wide enough to seat the panel, too narrow to leave a readable diff beside it.
	expect(layout(110, "auto", "auto").showSidebar).toBe(false);
	expect(layout(110, "shown", "auto").showSidebar).toBe(true);
	expect(layout(120, "auto", "auto").showSidebar).toBe(true);
});

test("an asked-for split collapses a widened sidebar to win the columns it needs", () => {
	expect(widened("auto", "auto")).toMatchObject({ showSidebar: true, splitFits: false });
	expect(widened("auto", "split")).toMatchObject({ showSidebar: false, splitFits: true });
});

test("a pinned sidebar outranks an asked-for split", () => {
	expect(widened("shown", "split")).toMatchObject({ showSidebar: true, splitFits: false });
});

test("an automatic diff layout never moves the sidebar", () => {
	expect(widened("auto", "auto").showSidebar).toBe(true);
	expect(layout(140, "auto", "auto")).toMatchObject({ showSidebar: true, splitFits: true });
});

test("split is reported reachable whenever asking for it would work", () => {
	// Not seated right now, but one menu click away — the sidebar would yield.
	expect(widened("auto", "auto")).toMatchObject({ splitFits: false, splitReachable: true });
	// Pinned open, so no amount of asking will fit two panes in what is left.
	expect(widened("shown", "auto").splitReachable).toBe(false);
	expect(layout(70, "auto", "auto").splitReachable).toBe(false);
});

test("an explicit diff layout overrides what auto would have chosen", async () => {
	const newFile = await chapterFile("src/lib/backoff.ts");

	// Auto refuses to split a new file: one pane would be blank.
	expect(layoutForFile({ file: newFile, preference: "auto", splitFits: true })).toBe("stack");
	expect(layoutForFile({ file: newFile, preference: "split", splitFits: true })).toBe("split");

	const edited = await chapterFile("src/lib/apiClient.ts");
	expect(layoutForFile({ file: edited, preference: "auto", splitFits: true })).toBe("split");
	expect(layoutForFile({ file: edited, preference: "stacked", splitFits: true })).toBe("stack");
	expect(layoutForFile({ file: edited, preference: "split", splitFits: false })).toBe("stack");
});
