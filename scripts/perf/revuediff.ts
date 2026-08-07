#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { join } from "node:path";
import { classifyPagerInput } from "../../packages/revuediff/src/pagerInput.ts";
import {
	benchmark,
	catCommand,
	commandAvailable,
	commandVersion,
	compileRevuediff,
	digest,
	fileDigest,
	type Options,
	parseArgs,
	SCHEMA_VERSION,
	short,
	stageTimings,
	TARGETS,
	validateExecutableScenario,
	writeJson,
} from "./revuediff-benchmark.ts";
import {
	buildScenarios,
	type FormattedScenario,
	formattedScenarios,
	type Scenario,
	validateScenarioPatch,
	withTempDirectory,
	writeSourceTree,
} from "./revuediff-scenarios.ts";

const HELP = `Revuediff performance benchmark

bun run perf:revuediff [--compare] [--stages] [--json path] [--repetitions N] [--warmups N] [--timeout-ms N]

Measures a compiled release-style executable in fresh processes. --compare uses optional Delta stdin and Difftastic Git external-diff contracts.`;

type TableRow = {
	tool: string;
	id: string;
	ttfbP50Ms: number | null;
	ttfbP95Ms: number | null;
	totalP50Ms: number | null;
	totalP95Ms: number | null;
	outputBytesP50: number | null;
	failures: number;
};

const runGit = async (cwd: string, args: string[]): Promise<string> => {
	const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`);
	return stdout.trim();
};

async function gitExternalDiff(directory: string, scenario: FormattedScenario) {
	const repo = join(directory, `difftastic-${scenario.id}`);
	await mkdir(repo);
	await runGit(repo, ["init", "-q"]);
	await runGit(repo, ["config", "user.email", "benchmark@example.invalid"]);
	await runGit(repo, ["config", "user.name", "benchmark"]);
	await writeSourceTree(repo, scenario.source.files, "before");
	await runGit(repo, ["add", "."]);
	await runGit(repo, ["commit", "-qm", "pre-image"]);
	await writeSourceTree(repo, scenario.source.files, "after");
	const workload: Scenario = {
		...scenario,
		id: scenario.id,
		description: `${scenario.description} through Git external diff`,
		args: [],
		input: "",
	};
	return {
		workload,
		command: [
			"env",
			"GIT_EXTERNAL_DIFF=difft",
			"GIT_CONFIG_GLOBAL=/dev/null",
			"GIT_CONFIG_SYSTEM=/dev/null",
			"git",
			"-C",
			repo,
			"diff",
			"--ext-diff",
			"--no-renames",
		],
	};
}

const renderTable = (rows: TableRow[]) => {
	console.log(
		"\ntool       scenario                 TTFB p50  p95       total p50 p95       out bytes failures",
	);
	for (const row of rows)
		console.log(
			`${row.tool.padEnd(10)} ${row.id.padEnd(24)} ${short(row.ttfbP50Ms).padEnd(9)} ${short(row.ttfbP95Ms).padEnd(9)} ${short(row.totalP50Ms).padEnd(9)} ${short(row.totalP95Ms).padEnd(9)} ${String(row.outputBytesP50 ?? "-").padEnd(9)} ${row.failures}`,
		);
};

const scenarioIdentity = (scenario: Scenario, options: Options) => ({
	description: scenario.description,
	args: scenario.args,
	expect: scenario.expect,
	input: {
		bytes: Buffer.byteLength(scenario.input),
		sha256: digest(scenario.input),
	},
	source: {
		fileCount: scenario.source.files.length,
		additions: scenario.source.additions,
		deletions: scenario.source.deletions,
		bytes: scenario.source.bytes,
		digest: scenario.source.digest,
		paths: scenario.source.files.map((file) => file.path),
	},
	timeoutMs: options.timeoutMs,
	repetitions: options.repetitions,
	warmups: options.warmups,
});

const resultHasFailures = (value: unknown): boolean => {
	if (!value || typeof value !== "object") return false;
	if ("failures" in value && typeof value.failures === "number" && value.failures > 0) return true;
	return Object.values(value).some(resultHasFailures);
};

async function sourceIdentity() {
	const revision = await runGit(process.cwd(), ["rev-parse", "HEAD"]);
	const status = await runGit(process.cwd(), ["status", "--porcelain=v1"]);
	return { revision, dirty: status.length > 0 };
}

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
		const infrastructureFailures: string[] = [];
		for (const scenario of formattedScenarios(scenarios)) {
			try {
				await validateScenarioPatch(scenario);
				const classified = classifyPagerInput(scenario.input);
				if (classified.kind !== "supported") throw new Error("Revuediff classifier rejected it");
				const additions = classified.files.reduce((sum, file) => sum + file.stats.additions, 0);
				const deletions = classified.files.reduce((sum, file) => sum + file.stats.deletions, 0);
				if (
					classified.files.length !== scenario.expect.fileCount ||
					additions !== scenario.expect.additions ||
					deletions !== scenario.expect.deletions ||
					additions === 0 ||
					deletions === 0
				)
					throw new Error("classifier/parser stats do not match the generated source trees");
			} catch (error) {
				infrastructureFailures.push(
					`${scenario.id} patch integrity: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		const executable = join(temporary, "revuediff");
		await compileRevuediff(executable);
		const binaryVersion = await commandVersion([executable, "--version"]);
		const binaryDigest = await fileDigest(executable);
		const rows: TableRow[] = [];
		const revuediff: Record<string, unknown> = {};
		for (const scenario of scenarios) {
			const forceFailure =
				process.env.REVUEDIFF_PERF_FORCE_SAMPLE_FAILURE === "1" && scenario.id === "tiny-lazygit";
			const command = forceFailure ? ["sh", "-c", "exit 97"] : [executable, ...scenario.args];
			const validation = await validateExecutableScenario(command, scenario, options.timeoutMs);
			if (!validation.passed) {
				infrastructureFailures.push(
					`${scenario.id} executable validation: ${validation.errors.join("; ")}`,
				);
				revuediff[scenario.id] = {
					...scenarioIdentity(scenario, options),
					validation,
					benchmark: null,
				};
				continue;
			}
			const result = await benchmark(command, scenario, options);
			revuediff[scenario.id] = {
				...scenarioIdentity(scenario, options),
				validation,
				benchmark: result,
			};
			rows.push({ tool: "revuediff", id: scenario.id, ...result });
		}

		const baselineScenario = scenarios.find((scenario) => scenario.id === "medium-mixed");
		if (!baselineScenario) throw new Error("medium benchmark scenario is missing");
		const baselineResult = await benchmark([catCommand], baselineScenario, options);
		const baseline = {
			tool: "cat",
			contract: "stdin copy process baseline; no parsing, highlighting, or formatting",
			...scenarioIdentity(baselineScenario, options),
			benchmark: baselineResult,
		};
		rows.push({ tool: "cat", id: "medium-mixed", ...baselineResult });

		const comparators: Record<string, unknown> = {};
		if (options.compare) {
			if (await commandAvailable("delta")) {
				const version = await commandVersion(["delta", "--version"]);
				const deltaScenarios: Record<string, unknown> = {};
				for (const scenario of formattedScenarios(scenarios)) {
					const widthArgument = scenario.args.find((argument) => argument.startsWith("--width="));
					const command = [
						"env",
						"GIT_CONFIG_GLOBAL=/dev/null",
						"GIT_CONFIG_SYSTEM=/dev/null",
						"delta",
						"--paging=never",
						"--features=",
						...(widthArgument ? [widthArgument] : []),
					];
					const result = await benchmark(command, scenario, options);
					deltaScenarios[scenario.id] = {
						...scenarioIdentity(scenario, options),
						invocation: "delta --paging=never --features= --width=<scenario width>",
						benchmark: result,
					};
					rows.push({ tool: "delta", id: scenario.id, ...result });
				}
				comparators.delta = {
					version,
					contract: "same deterministic unified patch over stdin at the same requested width",
					featureDifferences:
						"Delta uses its own syntax engine/default theme and presentation; highlighting is enabled but visual work is not equivalent to Revuediff.",
					scenarios: deltaScenarios,
				};
			} else comparators.delta = { skipped: "delta is not installed", version: null };

			if (await commandAvailable("difft")) {
				const version = await commandVersion(["difft", "--version"]);
				const difftasticScenarios: Record<string, unknown> = {};
				for (const scenario of formattedScenarios(scenarios)) {
					const external = await gitExternalDiff(temporary, scenario);
					const result = await benchmark(external.command, external.workload, options);
					difftasticScenarios[scenario.id] = {
						...scenarioIdentity(external.workload, options),
						processStdinBytes: 0,
						invocation: "GIT_EXTERNAL_DIFF=difft git diff --ext-diff --no-renames",
						benchmark: result,
					};
					rows.push({ tool: "difftastic", id: scenario.id, ...result });
				}
				comparators.difftastic = {
					version,
					contract:
						"Git external-diff over the scenario's exact committed pre-image and worktree post-image files",
					featureDifferences:
						"Difftastic is a structural external diff, not a buffered stdin pager; stdin throughput and pager TTFB are not equivalent.",
					scenarios: difftasticScenarios,
				};
			} else
				comparators.difftastic = {
					skipped: "difft is not installed; external-diff comparison skipped",
					version: null,
				};
		}

		const stages = options.stages ? await stageTimings(scenarios) : undefined;
		const report = {
			schemaVersion: SCHEMA_VERSION,
			status:
				infrastructureFailures.length > 0 ||
				resultHasFailures(revuediff) ||
				resultHasFailures(baseline) ||
				resultHasFailures(comparators)
					? "failed"
					: "ok",
			generatedAt: new Date().toISOString(),
			sourceGit: await sourceIdentity(),
			compiledBinary: { digest: binaryDigest, version: binaryVersion },
			environment: {
				platform: platform(),
				release: release(),
				arch: arch(),
				runtime: { name: "Bun", version: Bun.version },
				tools: { git: await commandVersion(["git", "--version"]), cat: catCommand },
			},
			methodology: {
				repetitions: options.repetitions,
				warmups: options.warmups,
				timeoutMs: options.timeoutMs,
				freshProcessPerRun: true,
				bufferedOutput: true,
				validationBeforeTiming: true,
				stageIsolation: "serial, non-overlapping in declared sequence",
				targets: TARGETS,
			},
			infrastructureFailures,
			revuediff,
			baseline,
			comparators,
			stages,
		};
		renderTable(rows);
		if (stages) {
			console.log("\nstages (serial diagnostic passes; not a wall-clock budget):");
			for (const stage of stages) {
				if ("error" in stage) console.log(`${stage.id}: ${stage.error}`);
				else
					console.log(
						`${stage.id.padEnd(24)} width ${String(stage.width).padEnd(3)} ${stage.layouts.join("+")} classify ${short(stage.classifyMs)} syntax first ${short(stage.syntaxFirstPassMs)} (${stage.syntaxFirstPassState}) warmed ${short(stage.syntaxWarmedMs)} format ${short(stage.formatMs)}`,
					);
			}
		}
		console.log(
			`\nTargets (aspirational, non-gating): tiny TTFB p50 <= ${TARGETS.tinyTtfbP50Ms}ms, tiny p95 <= ${TARGETS.tinyP95Ms}ms, medium p50 <= ${TARGETS.mediumP50Ms}ms.`,
		);
		if (options.jsonPath) {
			await writeJson(options.jsonPath, report);
			console.log(`JSON report: ${options.jsonPath}`);
		}
		if (report.status === "failed")
			throw new Error(
				`benchmark correctness/infrastructure failure: ${infrastructureFailures.join("; ") || "one or more samples failed"}`,
			);
	});
}

const requestedJsonPath = (): string | undefined => {
	const index = process.argv.indexOf("--json");
	return index >= 0 ? process.argv[index + 1] : undefined;
};

main().catch(async (error) => {
	const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
	console.error(message);
	const jsonPath = requestedJsonPath();
	if (jsonPath && !existsSync(jsonPath)) {
		await writeJson(jsonPath, {
			schemaVersion: SCHEMA_VERSION,
			status: "failed",
			generatedAt: new Date().toISOString(),
			infrastructureFailures: [message],
		});
	}
	process.exit(1);
});
