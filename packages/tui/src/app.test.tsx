import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { RevueChaptersFileSchema } from "@revue/types";
import { act } from "react";
import sample from "../../../examples/sample-chapters.json" with { type: "json" };
import { App } from "./app.tsx";

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
