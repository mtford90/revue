#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	benchmark,
	catCommand,
	commandAvailable,
	compileRevuediff,
	type Options,
	parseArgs,
	short,
	stageTimings,
	TARGETS,
	writeJson,
} from "./revuediff-benchmark.ts";
import { buildScenarios, withTempDirectory } from "./revuediff-scenarios.ts";

const HELP = `Revuediff performance benchmark

bun run perf:revuediff [--compare] [--stages] [--json path] [--repetitions N] [--warmups N] [--timeout-ms N]

Measures a compiled release-style executable in fresh processes. --compare uses optional Delta stdin and Difftastic Git external-diff contracts.`;

async function gitExternalDiff(directory: string, input: string) {
	const repo = join(directory, "difftastic-external-diff");
	await mkdir(repo);
	const run = async (args: string[]) => {
		const child = Bun.spawn(["git", ...args], { cwd: repo, stdout: "ignore", stderr: "pipe" });
		if ((await child.exited) !== 0)
			throw new Error(`git setup failed: ${await new Response(child.stderr).text()}`);
	};
	await run(["init", "-q"]);
	await run(["config", "user.email", "benchmark@example.invalid"]);
	await run(["config", "user.name", "benchmark"]);
	await writeFile(join(repo, "fixture.ts"), input);
	await run(["add", "fixture.ts"]);
	await run(["commit", "-qm", "fixture"]);
	await writeFile(join(repo, "fixture.ts"), input.replace(/value1/g, "value2"));
	return {
		id: "difftastic-external-diff",
		description: "Difftastic through Git --ext-diff (not an stdin pager)",
		args: [],
		input: "",
		meaningfulBytes: input.length,
		expect: "formatted" as const,
		command: [
			"sh",
			"-c",
			`cd ${JSON.stringify(repo)} && GIT_EXTERNAL_DIFF=difft git diff --ext-diff`,
		],
	};
}

const renderTable = (
	rows: {
		tool: string;
		id: string;
		ttfbP50Ms: number | null;
		ttfbP95Ms: number | null;
		totalP50Ms: number | null;
		totalP95Ms: number | null;
		outputBytes: number | null;
		failures: number;
	}[],
) => {
	console.log(
		"\ntool       scenario                 TTFB p50  p95       total p50 p95       bytes    failures",
	);
	for (const row of rows)
		console.log(
			`${row.tool.padEnd(10)} ${row.id.padEnd(24)} ${short(row.ttfbP50Ms).padEnd(9)} ${short(row.ttfbP95Ms).padEnd(9)} ${short(row.totalP50Ms).padEnd(9)} ${short(row.totalP95Ms).padEnd(9)} ${String(row.outputBytes ?? "-").padEnd(8)} ${row.failures}`,
		);
};

async function main() {
	let options: Options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		if ((error as Error).message === "help") {
			console.log(HELP);
			return;
		}
		throw error;
	}
	const scenarios = buildScenarios();
	await withTempDirectory(async (temporary) => {
		const executable = join(temporary, "revuediff");
		await compileRevuediff(executable);
		const rows: {
			tool: string;
			id: string;
			ttfbP50Ms: number | null;
			ttfbP95Ms: number | null;
			totalP50Ms: number | null;
			totalP95Ms: number | null;
			outputBytes: number | null;
			failures: number;
		}[] = [];
		const revuediff: Record<string, unknown> = {};
		for (const scenario of scenarios) {
			const result = await benchmark([executable, ...scenario.args], scenario, options);
			revuediff[scenario.id] = { description: scenario.description, ...result };
			rows.push({ tool: "revuediff", id: scenario.id, ...result });
		}
		const baselineScenario = scenarios.find((scenario) => scenario.id === "medium-mixed");
		if (!baselineScenario) throw new Error("medium benchmark scenario is missing");
		const baseline = await benchmark([catCommand], baselineScenario, options);
		rows.push({ tool: "cat", id: "medium-mixed", ...baseline });
		const comparators: Record<string, unknown> = {};
		if (options.compare) {
			if (await commandAvailable("delta")) {
				const delta: Record<string, unknown> = {};
				for (const scenario of scenarios.filter((scenario) => scenario.expect === "formatted")) {
					const result = await benchmark(
						["delta", "--paging=never", "--features=", "--syntax-theme=none"],
						scenario,
						options,
					);
					delta[scenario.id] = result;
					rows.push({ tool: "delta", id: scenario.id, ...result });
				}
				comparators.delta = {
					contract: "stdin pager path; input is the same deterministic unified diff",
					scenarios: delta,
				};
			} else comparators.delta = { skipped: "delta is not installed" };
			if (await commandAvailable("difft")) {
				const external = await gitExternalDiff(
					temporary,
					baselineScenario.input,
					options.timeoutMs,
				);
				const result = await benchmark(external.command, external, options);
				comparators.difftastic = {
					contract: "external-diff invocation; not equivalent to an stdin pager",
					scenarios: { [external.id]: result },
				};
				rows.push({ tool: "difftastic", id: external.id, ...result });
			} else
				comparators.difftastic = {
					skipped: "difft is not installed; external-diff comparison skipped",
				};
		}
		const stages = options.stages ? await stageTimings(scenarios) : undefined;
		const report = {
			schemaVersion: 1,
			generatedAt: new Date().toISOString(),
			environment: {
				platform: process.platform,
				arch: process.arch,
				bun: Bun.version,
				revuediffExecutable: executable,
			},
			methodology: {
				repetitions: options.repetitions,
				warmups: options.warmups,
				freshProcessPerRun: true,
				bufferedOutput: true,
				targets: TARGETS,
			},
			revuediff,
			baseline: { tool: "cat", scenario: baselineScenario.id, ...baseline },
			comparators,
			stages,
		};
		renderTable(rows);
		if (stages) {
			console.log("\nstages (one diagnostic pass; not a wall-clock budget):");
			for (const stage of stages)
				console.log(
					`${stage.id.padEnd(24)} classify ${short(stage.classifyMs)} syntax ${short(stage.syntaxMs)} format ${short(stage.formatMs)}`,
				);
		}
		console.log(
			`\nTargets (aspirational, non-gating): tiny TTFB p50 <= ${TARGETS.tinyTtfbP50Ms}ms, tiny p95 <= ${TARGETS.tinyP95Ms}ms, medium p50 <= ${TARGETS.mediumP50Ms}ms.`,
		);
		if (options.jsonPath) {
			await writeJson(options.jsonPath, report);
			console.log(`JSON report: ${options.jsonPath}`);
		}
	});
}
main().catch((error) => {
	console.error(error instanceof Error ? (error.stack ?? error.message) : error);
	process.exit(1);
});
