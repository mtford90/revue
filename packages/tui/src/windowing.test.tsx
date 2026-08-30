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

const bigPatch = (linesPerFile = LINES_PER_FILE) =>
	Array.from({ length: FILE_COUNT }, (_, fileIndex) => {
		const path = `src/f${fileIndex}.txt`;
		const added = Array.from(
			{ length: linesPerFile },
			(_, line) => `+line ${line + 1} of f${fileIndex}`,
		).join("\n");
		return [
			`diff --git a/${path} b/${path}`,
			"index 0000000..1111111 100644",
			`--- a/${path}`,
			`+++ b/${path}`,
			`@@ -1,1 +1,${linesPerFile} @@`,
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

test("Tab centres an off-screen file whose rows are unmounted", async () => {
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
	const rows = frame.split("\n");
	const headerRow = rows.findIndex((row) => row.includes(`▼ src/f${FILE_COUNT - 1}.txt`));
	expect(Math.abs(headerRow - rows.length / 2)).toBeLessThanOrEqual(3);
	expect(frame).toContain(`line 1 of f${FILE_COUNT - 1}`);
});

test("Tab preserves the viewport when the next file is already visible", async () => {
	const diffFiles = await preparePatch(bigPatch(20), theme.syntaxTheme);
	const t = await testRender(<App file={null} diffFiles={diffFiles} />, {
		width: 120,
		height: 40,
	});
	await t.renderOnce();
	const before = t.captureCharFrame().split("\n");
	const firstLineRow = before.findIndex((row) => row.includes("line 1 of f0"));
	expect(before.join("\n")).toContain("▼ src/f1.txt");

	await press(t, "\t");
	await settleWindow(t);
	const after = t.captureCharFrame().split("\n");
	expect(after.findIndex((row) => row.includes("line 1 of f0"))).toBe(firstLineRow);
});
