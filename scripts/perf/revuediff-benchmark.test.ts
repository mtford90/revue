import { describe, expect, test } from "bun:test";
import { classifyPagerInput } from "../../packages/revuediff/src/pagerInput.ts";
import { collectProcess, parseArgs, percentile, summary } from "./revuediff-benchmark.ts";
import { buildScenarios } from "./revuediff-scenarios.ts";

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
	test("aggregates nearest-rank percentiles and failures", () => {
		expect(percentile([1, 3, 5, 7], 50)).toBe(3);
		const result = summary([
			{ ttfbMs: 1, totalMs: 3, outputBytes: 10, exitCode: 0, timedOut: false },
			{ ttfbMs: 5, totalMs: 7, outputBytes: 20, exitCode: 0, timedOut: false },
			{ ttfbMs: null, totalMs: 9, outputBytes: 0, exitCode: 1, timedOut: false },
		]);
		expect(result).toMatchObject({ runs: 3, failures: 1, ttfbP50Ms: 1, totalP95Ms: 7 });
	});
	test("generates complete formatted and sanitised passthrough fixtures", () => {
		const scenarios = buildScenarios();
		expect(scenarios).toHaveLength(7);
		for (const scenario of scenarios.filter((item) => item.expect === "formatted"))
			expect(classifyPagerInput(scenario.input).kind).toBe("supported");
		const passthrough = scenarios.find((item) => item.id === "unsupported-passthrough");
		expect(passthrough).toBeDefined();
		const classified = classifyPagerInput(passthrough?.input ?? "");
		expect(classified).toMatchObject({ kind: "passthrough", text: "not a supported diff\n" });
	});
	test("collects first byte while draining large stdout", async () => {
		const result = await collectProcess(["sh", "-c", "head -c 2000000 /dev/zero"], "", 5_000);
		expect(result).toMatchObject({ exitCode: 0, timedOut: false, outputBytes: 2_000_000 });
		expect(result.ttfbMs).not.toBeNull();
	});
});
