import { describe, expect, test } from "bun:test";
import { classifyPagerInput } from "../../packages/revuediff/src/pagerInput.ts";
import {
	collectProcess,
	hasBenchmarkFailures,
	parseArgs,
	percentile,
	stageTimings,
	summary,
	validateScenarioOutput,
} from "./revuediff-benchmark.ts";
import {
	buildScenarios,
	formattedScenarios,
	validateScenarioPatch,
} from "./revuediff-scenarios.ts";

describe("Revuediff performance benchmark helpers", () => {
	test("parses repeatable benchmark controls", () => {
		expect(
			parseArgs(["--compare", "--stages", "--json", "report.json", "-n", "3", "--warmups", "2"]),
		).toMatchObject({
			compare: true,
			stages: true,
			jsonPath: "report.json",
			repetitions: 3,
			warmups: 2,
		});
		expect(() => parseArgs(["--repetitions", "0"])).toThrow("positive integer");
	});

	test("aggregates input throughput from each successful sample", () => {
		expect(percentile([1, 3, 5, 7], 50)).toBe(3);
		const result = summary([
			{
				ttfbMs: 1,
				totalMs: 100,
				inputBytes: 100,
				outputBytes: 20,
				exitCode: 0,
				timedOut: false,
			},
			{
				ttfbMs: 5,
				totalMs: 200,
				inputBytes: 1_000,
				outputBytes: 40,
				exitCode: 0,
				timedOut: false,
			},
			{
				ttfbMs: null,
				totalMs: 9,
				inputBytes: 100,
				outputBytes: 0,
				exitCode: 1,
				timedOut: false,
			},
		]);
		expect(result).toMatchObject({
			runs: 3,
			failures: 1,
			ttfbP50Ms: 1,
			totalP95Ms: 200,
			inputThroughputBytesPerSecondP50: 1_000,
			outputThroughputBytesPerSecondP50: 200,
		});
		expect(result.rawSamples).toHaveLength(3);
	});

	test("generates source-backed patches with changed rows and exact file counts", async () => {
		const scenarios = buildScenarios();
		expect(scenarios).toHaveLength(7);
		const expectedCounts: Record<string, number> = {
			"tiny-lazygit": 1,
			"medium-mixed": 10,
			"large-mixed": 50,
			"tiny-narrow-stacked": 1,
			"tiny-wide-split": 1,
		};
		for (const scenario of formattedScenarios(scenarios)) {
			const expectedCount = expectedCounts[scenario.id];
			if (expectedCount === undefined) throw new Error(`missing expected count for ${scenario.id}`);
			const classified = classifyPagerInput(scenario.input);
			expect(classified.kind).toBe("supported");
			if (classified.kind !== "supported") continue;
			expect(classified.files).toHaveLength(expectedCount);
			expect(classified.files.reduce((sum, file) => sum + file.stats.additions, 0)).toBeGreaterThan(
				0,
			);
			expect(classified.files.reduce((sum, file) => sum + file.stats.deletions, 0)).toBeGreaterThan(
				0,
			);
			expect(scenario.source.files).toHaveLength(expectedCount);
			expect(scenario.source.additions).toBeGreaterThan(0);
			expect(scenario.source.deletions).toBeGreaterThan(0);
			for (const file of scenario.source.files.filter((file) => file.language === "json")) {
				expect(() => JSON.parse(file.before)).not.toThrow();
				expect(() => JSON.parse(file.after)).not.toThrow();
			}
			await validateScenarioPatch(scenario);
		}
	});

	test("defines observable executable expectations for every scenario", () => {
		const scenarios = buildScenarios();
		const formatted = scenarios.find((scenario) => scenario.id === "tiny-lazygit");
		const passthrough = scenarios.find((scenario) => scenario.id === "unsupported-passthrough");
		const help = scenarios.find((scenario) => scenario.id === "startup-help");
		expect(formatted).toBeDefined();
		expect(passthrough).toBeDefined();
		expect(help).toBeDefined();
		if (!formatted || !passthrough || !help) return;
		expect(
			validateScenarioOutput(formatted, {
				exitCode: 0,
				timedOut: false,
				stdout: "\x1b[38;2;1;2;3msrc/lazygit-selection.ts  +3 -3\x1b[0m\n",
				stderr: "",
			}),
		).toEqual([]);
		expect(
			validateScenarioOutput(passthrough, {
				exitCode: 0,
				timedOut: false,
				stdout: "not a supported diff\n",
				stderr: "",
			}),
		).toEqual([]);
		expect(
			validateScenarioOutput(help, {
				exitCode: 0,
				timedOut: false,
				stdout: "Usage:\n  revuediff [options] < diff.patch\n",
				stderr: "",
			}),
		).toEqual([]);
		expect(
			validateScenarioOutput(formatted, {
				exitCode: 0,
				timedOut: false,
				stdout: formatted.input,
				stderr: "",
			}),
		).toContain("formatted output did not contain ANSI styling");
	});

	test("runs diagnostic stages serially at each scenario's real geometry", async () => {
		const stages = await stageTimings(buildScenarios());
		expect(stages).toHaveLength(5);
		const byId = Object.fromEntries(stages.map((stage) => [stage.id, stage]));
		expect(byId["tiny-narrow-stacked"]).toMatchObject({
			width: 60,
			layouts: ["stack"],
			sequence: ["classify", "syntax-first-pass", "syntax-warmed", "format"],
		});
		expect(byId["tiny-wide-split"]).toMatchObject({ width: 160, layouts: ["split"] });
		expect(stages[0]).toMatchObject({ syntaxFirstPassState: "cold-shiki-startup" });
		for (const stage of stages) {
			if ("error" in stage) throw new Error(stage.error);
			expect(stage.syntaxWarmedMs).toBeGreaterThanOrEqual(0);
		}
	});

	test("collects first byte while draining large stdout", async () => {
		const result = await collectProcess(["sh", "-c", "head -c 2000000 /dev/zero"], "", 5_000);
		expect(result).toMatchObject({ exitCode: 0, timedOut: false, outputBytes: 2_000_000 });
		expect(result.ttfbMs).not.toBeNull();
	});

	test("hard-kills a process tree after a bounded timeout", async () => {
		const result = await collectProcess(
			["sh", "-c", "trap 'exit 0' TERM; (trap '' TERM; sleep 30) & wait"],
			"",
			30,
			{ terminationGraceMs: 30, killGraceMs: 100 },
		);
		expect(result.timedOut).toBe(true);
		expect(result.error).toContain("timed out");
	});

	test("a timed-out sample stays failed even when it later exits zero", async () => {
		const result = await collectProcess(
			["sh", "-c", "trap 'exit 0' TERM; while :; do :; done"],
			"",
			30,
			{ terminationGraceMs: 100, killGraceMs: 100 },
		);
		expect(result.timedOut).toBe(true);
		expect(summary([result]).failures).toBe(1);
		expect(hasBenchmarkFailures({ forced: summary([result]) })).toBe(true);
	});
});
