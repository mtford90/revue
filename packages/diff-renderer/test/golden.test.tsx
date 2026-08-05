import { afterEach, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { testRender as renderOpenTui } from "@opentui/react/test-utils";
import { resolveTheme } from "@revue/theme";
import { act } from "react";
import { DiffBody, type DiffLayout, parsePatch } from "../src/index.ts";
import { unifiedDiff } from "./goldens/diffText.ts";
import { GOLDEN_LAYOUTS, GOLDEN_SCENARIOS, type GoldenScenario } from "./goldens/scenarios.ts";
import { serialiseFrame } from "./goldens/serialise.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Fixed so a golden records the theme's colours, not the machine's preference. */
const theme = resolveTheme("ayu-dark");

const GOLDEN_DIR = join(import.meta.dir, "__goldens__");
const UPDATING = process.env.UPDATE_GOLDENS === "1";

const activeRenderers: Awaited<ReturnType<typeof renderOpenTui>>["renderer"][] = [];

afterEach(async () => {
	for (const renderer of activeRenderers.splice(0)) {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		await act(async () => renderer.destroy());
	}
});

type Case = { scenario: GoldenScenario; layout: DiffLayout; width: number };

const cases: Case[] = GOLDEN_SCENARIOS.flatMap((scenario) =>
	GOLDEN_LAYOUTS.flatMap((layout) => scenario.widths.map((width) => ({ scenario, layout, width }))),
);

const caseName = ({ scenario, layout, width }: Case) => `${scenario.name}--${layout}-w${width}`;

const render = async ({ scenario, layout, width }: Case): Promise<string> => {
	const [file] = parsePatch(scenario.patch);
	if (!file) throw new Error(`scenario ${scenario.name} has no parsable file`);
	// Syntax highlighting is prepared asynchronously and depends on a WASM grammar,
	// so goldens deliberately render unhighlighted text.
	const rendered = await renderOpenTui(
		<DiffBody file={file} theme={theme} layout={layout} width={width} />,
		{ width, height: scenario.height },
	);
	activeRenderers.push(rendered.renderer);
	await rendered.renderOnce();
	return serialiseFrame(
		rendered.captureSpans(),
		`${caseName({ scenario, layout, width })} — ${scenario.covers}`,
	);
};

const readGolden = async (path: string): Promise<string | undefined> => {
	const golden = Bun.file(path);
	return (await golden.exists()) ? await golden.text() : undefined;
};

for (const testCase of cases) {
	test(`golden: ${caseName(testCase)}`, async () => {
		const path = join(GOLDEN_DIR, `${caseName(testCase)}.txt`);
		const actual = await render(testCase);
		if (UPDATING) {
			await mkdir(dirname(path), { recursive: true });
			await Bun.write(path, actual);
			expect(actual.length).toBeGreaterThan(0);
			return;
		}
		const expected = await readGolden(path);
		if (expected === undefined) {
			throw new Error(`missing golden ${path}\n\nCreate it with: bun run goldens:update`);
		}
		if (expected !== actual) {
			throw new Error(
				`golden mismatch ${path}\n("-" is the committed golden, "+" is what rendering produced)\n\n${unifiedDiff(expected, actual)}\n\nIf the new rendering is correct, re-bless with: bun run goldens:update`,
			);
		}
	});
}
