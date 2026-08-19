import { afterEach, expect, test } from "bun:test";
import { testRender as renderOpenTui } from "@opentui/react/test-utils";
import { resolveTheme } from "@revue/theme";
import { act } from "react";
import { App } from "./app.tsx";
import { preparePatch } from "./diff.ts";

// The viewport mounts only rows near the window; everything else is spacer
// gaps. These tests drive a diff far larger than any screen and prove the
// scroll geometry survives: far content paints exactly where full mounting
// would have put it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = resolveTheme("catppuccin-mocha");
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

/** Waits out the scroll poll (33ms) so the window replans, then repaints. */
async function settleWindow(t: Awaited<ReturnType<typeof testRender>>) {
	for (let i = 0; i < 3; i += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 45));
			await t.renderOnce();
		});
	}
}

const FILE_COUNT = 3;
const LINES_PER_FILE = 300;

const bigPatch = () =>
	Array.from({ length: FILE_COUNT }, (_, fileIndex) => {
		const path = `src/f${fileIndex}.txt`;
		const added = Array.from(
			{ length: LINES_PER_FILE },
			(_, line) => `+line ${line + 1} of f${fileIndex}`,
		).join("\n");
		return [
			`diff --git a/${path} b/${path}`,
			"index 0000000..1111111 100644",
			`--- a/${path}`,
			`+++ b/${path}`,
			`@@ -1,1 +1,${LINES_PER_FILE} @@`,
			`-old line of f${fileIndex}`,
			added,
		].join("\n");
	}).join("\n");

test("the bottom of a huge diff paints correctly after a jump across unmounted gaps", async () => {
	const diffFiles = await preparePatch(bigPatch(), theme.syntaxTheme);
	const t = await testRender(<App file={null} diffFiles={diffFiles} />, {
		width: 120,
		height: 40,
	});
	await t.renderOnce();

	const top = t.captureCharFrame();
	expect(top).toContain("line 1 of f0");
	expect(top).not.toContain(`line ${LINES_PER_FILE} of f${FILE_COUNT - 1}`);

	await press(t, "G"); // jump to the very bottom
	await settleWindow(t);
	const bottom = t.captureCharFrame();
	expect(bottom).toContain(`line ${LINES_PER_FILE} of f${FILE_COUNT - 1}`);
	expect(bottom).not.toContain("line 1 of f0");

	await press(t, "g"); // and back to the top
	await settleWindow(t);
	expect(t.captureCharFrame()).toContain("line 1 of f0");
});

test("wrapped lines keep the scroll geometry honest across unmounted gaps", async () => {
	// Every added line is several terminal rows wide, so planned heights only
	// match the painted body if the plan counts wrapped rows too.
	const path = "src/wide.txt";
	const line = (index: number) => `line ${index} of the wide file ${"pad ".repeat(40)}`;
	const added = Array.from({ length: 120 }, (_, index) => `+${line(index + 1)}`).join("\n");
	const diffFiles = await preparePatch(
		[
			`diff --git a/${path} b/${path}`,
			"index 0000000..1111111 100644",
			`--- a/${path}`,
			`+++ b/${path}`,
			"@@ -1,1 +1,120 @@",
			"-old wide line",
			added,
		].join("\n"),
		theme.syntaxTheme,
	);
	const t = await testRender(<App file={null} diffFiles={diffFiles} />, { width: 120, height: 40 });
	await t.renderOnce();

	// A marker at the head of each line survives the wrap intact.
	const top = t.captureCharFrame();
	expect(top).toContain("line 1 of the wide file");
	expect(top).not.toContain("line 120 of the wide file");

	await press(t, "G");
	await settleWindow(t);
	const bottom = t.captureCharFrame();
	expect(bottom).toContain("line 120 of the wide file");
	expect(bottom).not.toContain("line 1 of the wide file");
});

test("focusing a file whose rows are unmounted scrolls its header into view", async () => {
	const diffFiles = await preparePatch(bigPatch(), theme.syntaxTheme);
	const t = await testRender(<App file={null} diffFiles={diffFiles} />, {
		width: 120,
		height: 40,
	});
	await t.renderOnce();
	expect(t.captureCharFrame()).not.toContain(`line 1 of f${FILE_COUNT - 1}`);

	await press(t, "\t"); // f1
	await press(t, "\t"); // f2, far beyond the mounted window
	await settleWindow(t);
	const frame = t.captureCharFrame();
	// The reveal is minimal, so the header lands at the bottom edge of the view.
	expect(frame).toContain(`▼ src/f${FILE_COUNT - 1}.txt`);
	expect(frame).toContain(`line 300 of f${FILE_COUNT - 2}`);
});
