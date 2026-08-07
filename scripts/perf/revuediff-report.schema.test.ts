import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const hash = `sha256:${"a".repeat(64)}`;
const sample = {
	ttfbMs: 1,
	totalMs: 2,
	inputBytes: 3,
	outputBytes: 4,
	exitCode: 0,
	timedOut: false,
};
const benchmark = {
	runs: 1,
	failures: 0,
	warmupFailures: 0,
	failureDetails: [],
	ttfbP50Ms: 1,
	ttfbP95Ms: 1,
	totalP50Ms: 2,
	totalP95Ms: 2,
	outputBytesP50: 4,
	inputThroughputBytesPerSecondP50: 1500,
	outputThroughputBytesPerSecondP50: 2000,
	rawSamples: [sample],
	rawWarmupSamples: [sample],
};
const identity = {
	description: "representative formatted scenario",
	args: ["--width=100"],
	expect: {
		kind: "formatted",
		ansi: true,
		fileCount: 1,
		additions: 1,
		deletions: 1,
		files: [{ path: "a.ts", additions: 1, deletions: 1 }],
	},
	input: { bytes: 3, sha256: hash },
	source: { fileCount: 1, additions: 1, deletions: 1, bytes: 3, digest: hash, paths: ["a.ts"] },
	timeoutMs: 1000,
	repetitions: 1,
	warmups: 1,
};
const successReport = () => ({
	schemaVersion: 2,
	status: "ok",
	generatedAt: "2026-01-02T03:04:05.000Z",
	sourceGit: { revision: "a".repeat(40), dirty: false },
	compiledBinary: { digest: hash, version: "0.5.0" },
	environment: {
		platform: "darwin",
		release: "25.0.0",
		arch: "arm64",
		runtime: { name: "Bun", version: "1.3.8" },
		tools: { git: "git version 2.50", cat: "cat" },
	},
	methodology: {
		repetitions: 1,
		warmups: 1,
		timeoutMs: 1000,
		freshProcessPerRun: true,
		bufferedOutput: true,
		validationBeforeTiming: true,
		stageIsolation: "serial, non-overlapping in declared sequence",
		targets: {
			tinyTtfbP50Ms: 75,
			tinyP95Ms: 100,
			mediumP50Ms: 200,
			largeRegression: "no >20% regression once a baseline is recorded",
		},
	},
	infrastructureFailures: [],
	revuediff: {
		tiny: {
			...identity,
			validation: {
				passed: true,
				errors: [],
				exitCode: 0,
				timedOut: false,
				outputBytes: 4,
				outputSha256: hash,
			},
			benchmark,
		},
	},
	baseline: { tool: "cat", contract: "stdin copy process baseline", ...identity, benchmark },
	comparators: {},
	stages: [
		{
			id: "tiny",
			width: 100,
			layouts: ["split"],
			sequence: ["classify", "syntax-first-pass", "syntax-warmed", "format"],
			classifyMs: 1,
			syntaxFirstPassState: "cold-shiki-startup",
			syntaxFirstPassMs: 1,
			syntaxWarmedMs: 1,
			formatMs: 1,
		},
	],
});

const validateReport = async () => {
	const schema = JSON.parse(
		await readFile(`${import.meta.dir}/revuediff-report.schema.json`, "utf8"),
	);
	const ajv = new Ajv2020({ allErrors: true, strict: true });
	addFormats(ajv);
	return ajv.compile(schema);
};

describe("revuediff report schema v2", () => {
	test("accepts representative success and minimal forced infrastructure failure reports", async () => {
		const validate = await validateReport();
		expect(validate(successReport()), JSON.stringify(validate.errors)).toBe(true);
		expect(
			validate({
				schemaVersion: 2,
				status: "failed",
				generatedAt: "2026-01-02T03:04:05.000Z",
				infrastructureFailures: ["compile failed"],
			}),
			JSON.stringify(validate.errors),
		).toBe(true);
	});

	test("rejects corrupted report contracts", async () => {
		const validate = await validateReport();
		const corruptions: [string, (report: ReturnType<typeof successReport>) => void][] = [
			[
				"null expectation",
				(report) => {
					report.revuediff.tiny.expect = null as never;
				},
			],
			[
				"removed distributions",
				(report) => {
					delete (report.revuediff.tiny.benchmark as Record<string, unknown>).rawSamples;
				},
			],
			[
				"invalid validation type",
				(report) => {
					report.revuediff.tiny.validation.passed = "yes" as never;
				},
			],
			[
				"missing source identity",
				(report) => {
					delete (report.revuediff.tiny as Record<string, unknown>).source;
				},
			],
			[
				"missing tool version",
				(report) => {
					delete (report.environment.tools as Record<string, unknown>).git;
				},
			],
			[
				"unknown stable field",
				(report) => {
					(report as Record<string, unknown>).producer = "future";
				},
			],
		];
		for (const [name, corrupt] of corruptions) {
			const report = successReport();
			corrupt(report);
			expect(validate(report), name).toBe(false);
		}
	});
});
