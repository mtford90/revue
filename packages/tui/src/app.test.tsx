import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { RevueChaptersFileSchema } from "@revue/types";
import { act } from "react";
import sample from "../../../examples/sample-chapters.json" with { type: "json" };
import { App } from "./app.tsx";
import { loadPatch } from "./diff.ts";

const PATCH = `${import.meta.dir}/../../../examples/sample.diff`;

// React's act() needs this flag to flush state updates from mocked key presses.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const file = RevueChaptersFileSchema.parse(sample);

test("opens on the prologue with the chapter list in the sidebar", async () => {
	const t = await testRender(<App file={file} />, { width: 110, height: 32 });
	await t.renderOnce();
	const frame = t.captureCharFrame();

	expect(frame).toContain("revue"); // sidebar title
	expect(frame).toContain("Prologue"); // sidebar entry
	expect(frame).toContain("Retry transient failures"); // sidebar chapter label
	expect(frame).toContain("Dashboards stay up during deploys now"); // prologue outcome
	expect(frame).toContain("1/4"); // status bar — prologue + 3 chapters
});

test("pressing j pages into the first chapter's detail", async () => {
	const t = await testRender(<App file={file} />, { width: 110, height: 32 });
	await t.renderOnce();
	await act(async () => {
		t.mockInput.pressKey("j");
	});
	await t.renderOnce();
	const frame = t.captureCharFrame();

	// These only render on a chapter page, not the prologue or sidebar.
	expect(frame).toContain("Hunks (1)");
	expect(frame).toContain("src/lib/backoff.ts");
	expect(frame).toContain("2/4");
});

test("with a patch, a chapter renders its real diff body via HunkReviewStream", async () => {
	const diffFiles = await loadPatch(PATCH);
	const t = await testRender(<App file={file} diffFiles={diffFiles} />, { width: 120, height: 44 });
	await t.renderOnce();
	await act(async () => {
		t.mockInput.pressKey("j"); // into chapter 1 (backoff.ts, a new file)
	});
	await t.renderOnce();
	const frame = t.captureCharFrame();

	// Real added lines from examples/sample.diff, not chapter metadata.
	expect(frame).toContain("backoff");
	expect(frame).toContain("MAX_RETRIES");
	expect(frame).not.toContain("Hunks (1)"); // the metadata fallback is replaced by the diff
});
