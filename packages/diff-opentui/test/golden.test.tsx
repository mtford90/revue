import { afterEach, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { testRender as renderOpenTui } from "@opentui/react/test-utils";
import { type DiffLayout, parsePatch, planDiagram, planDiff, planExcerpt } from "@revue/diff";
import { resolveTheme } from "@revue/theme";
import { act } from "react";
import { DiagramBlock, DiffBody, ExcerptBlock, OPENTUI_DIFF_CHROME } from "../src/index.ts";
import { unifiedDiff } from "./goldens/diffText.ts";
import {
	GOLDEN_DIAGRAM_SCENARIOS,
	GOLDEN_EXCERPT_SCENARIOS,
	GOLDEN_LAYOUTS,
	GOLDEN_SCENARIOS,
	type GoldenDiagramScenario,
	type GoldenExcerptScenario,
	type GoldenScenario,
} from "./goldens/scenarios.ts";
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
	const plan = planDiff({
		file,
		layout,
		width,
		visibility: { lineNumbers: true, changeMarkers: true, hunkHeaders: true },
		chrome: OPENTUI_DIFF_CHROME,
		syntaxTheme: theme.syntaxTheme,
	});
	const rendered = await renderOpenTui(<DiffBody plan={plan} theme={theme} />, {
		width,
		height: scenario.height,
	});
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

const checkGolden = async (name: string, actual: string): Promise<void> => {
	const path = join(GOLDEN_DIR, `${name}.txt`);
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
};

for (const testCase of cases) {
	test(`golden: ${caseName(testCase)}`, async () => {
		await checkGolden(caseName(testCase), await render(testCase));
	});
}

type ExcerptCase = { scenario: GoldenExcerptScenario; width: number };

const excerptCases: ExcerptCase[] = GOLDEN_EXCERPT_SCENARIOS.flatMap((scenario) =>
	scenario.widths.map((width) => ({ scenario, width })),
);

const excerptCaseName = ({ scenario, width }: ExcerptCase) => `${scenario.name}--w${width}`;

// An excerpt is full width with one gutter in either diff layout, so its goldens have no
// layout axis: `planExcerpt` takes no layout, and `plan.test.ts` holds that column contract.
const renderExcerpt = async ({ scenario, width }: ExcerptCase): Promise<string> => {
	const plan = planExcerpt({
		key: scenario.name,
		quotation: scenario.quotation,
		folded: scenario.folded,
		width,
		chrome: OPENTUI_DIFF_CHROME,
	});
	const rendered = await renderOpenTui(<ExcerptBlock plan={plan} theme={theme} />, {
		width,
		height: scenario.height,
	});
	activeRenderers.push(rendered.renderer);
	await rendered.renderOnce();
	return serialiseFrame(
		rendered.captureSpans(),
		`${excerptCaseName({ scenario, width })} — ${scenario.covers}`,
	);
};

for (const testCase of excerptCases) {
	test(`golden: ${excerptCaseName(testCase)}`, async () => {
		await checkGolden(excerptCaseName(testCase), await renderExcerpt(testCase));
	});
}

type DiagramCase = { scenario: GoldenDiagramScenario; width: number };

const diagramCases: DiagramCase[] = GOLDEN_DIAGRAM_SCENARIOS.flatMap((scenario) =>
	scenario.widths.map((width) => ({ scenario, width })),
);

const diagramCaseName = ({ scenario, width }: DiagramCase) => `${scenario.name}--w${width}`;

const renderDiagram = async ({ scenario, width }: DiagramCase): Promise<string> => {
	const plan = planDiagram({
		key: scenario.name,
		diagram: scenario.diagram,
		folded: scenario.folded,
		width,
		chrome: OPENTUI_DIFF_CHROME,
	});
	const rendered = await renderOpenTui(<DiagramBlock plan={plan} theme={theme} />, {
		width,
		height: scenario.height,
	});
	activeRenderers.push(rendered.renderer);
	await rendered.renderOnce();
	return serialiseFrame(
		rendered.captureSpans(),
		`${diagramCaseName({ scenario, width })} — ${scenario.covers}`,
	);
};

for (const testCase of diagramCases) {
	test(`golden: ${diagramCaseName(testCase)}`, async () => {
		await checkGolden(diagramCaseName(testCase), await renderDiagram(testCase));
	});
}
