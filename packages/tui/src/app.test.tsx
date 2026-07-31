import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { RevueChaptersFileSchema, type ViewState } from "@revue/types";
import { act } from "react";
import sample from "../../../examples/sample-chapters.json" with { type: "json" };
import { App } from "./app.tsx";
import { loadPatch } from "./diff.ts";

const PATCH = `${import.meta.dir}/../../../examples/sample.diff`;

// React's act() needs this flag to flush state updates from mocked key presses.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const file = RevueChaptersFileSchema.parse(sample);

async function press(t: Awaited<ReturnType<typeof testRender>>, key: string) {
	await act(async () => {
		t.mockInput.pressKey(key);
	});
	await t.renderOnce();
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

test("a chapter shows its file list", async () => {
	const t = await testRender(<App file={file} />, { width: 110, height: 32 });
	await t.renderOnce();
	await press(t, "j"); // into chapter 1
	const frame = t.captureCharFrame();

	expect(frame).toContain("Files (1)");
	expect(frame).toContain("src/lib/backoff.ts");
});

test("with a patch, a chapter renders its real diff body and per-file stats", async () => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(<App file={file} diffFiles={diffFiles} />, { width: 120, height: 44 });
	await t.renderOnce();
	await press(t, "j"); // into chapter 1 (backoff.ts, a new file)
	const frame = t.captureCharFrame();

	expect(frame).toContain("backoff"); // real added line from the diff
	expect(frame).toContain("MAX_RETRIES");
	expect(frame).toContain("+9 -0"); // file-list stats from the parsed patch
});

test("space marks a chapter reviewed, persists, and auto-advances", async () => {
	const seen: ViewState[] = [];
	const t = await testRender(<App file={file} onViewStateChange={(n) => seen.push(n)} />, {
		width: 110,
		height: 32,
	});
	await t.renderOnce();
	await press(t, "j"); // chapter 1
	await press(t, " "); // spacebar → mark reviewed
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
	await press(t, "j"); // chapter 1 (one file)
	await press(t, "f"); // mark that file reviewed

	expect(seen.at(-1)?.files).toContain("chapter-1::src/lib/backoff.ts");
	expect(seen.at(-1)?.chapters).toContain("chapter-1"); // all files reviewed -> chapter reviewed
});

test("number keys check a chapter's key changes", async () => {
	const seen: ViewState[] = [];
	const t = await testRender(<App file={file} onViewStateChange={(n) => seen.push(n)} />, {
		width: 110,
		height: 32,
	});
	await t.renderOnce();
	await press(t, "j"); // chapter 1
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
