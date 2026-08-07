import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prepareSyntaxHighlighting } from "../../packages/diff/src/index.ts";
import { formatAnsiDiffFile } from "../../packages/diff-ansi/src/index.ts";
import { classifyPagerInput } from "../../packages/revuediff/src/pagerInput.ts";
import { resolveTheme, withTransparentSurfaces } from "../../packages/theme/src/index.ts";
import type { Scenario } from "./revuediff-scenarios.ts";

export const SCHEMA_VERSION = 1;
export const TARGETS = {
	tinyTtfbP50Ms: 75,
	tinyP95Ms: 100,
	mediumP50Ms: 200,
	largeRegression: "no >20% regression once a baseline is recorded",
};
export type Options = {
	compare: boolean;
	stages: boolean;
	jsonPath?: string;
	repetitions: number;
	warmups: number;
	timeoutMs: number;
};
export type Sample = {
	ttfbMs: number | null;
	totalMs: number;
	outputBytes: number;
	exitCode: number | null;
	timedOut: boolean;
	error?: string;
};

export function parseArgs(args: string[]): Options {
	const options: Options = {
		compare: false,
		stages: false,
		repetitions: 15,
		warmups: 3,
		timeoutMs: 30_000,
	};
	for (let i = 0; i < args.length; i += 1) {
		const value = args[i];
		if (value === "--compare") options.compare = true;
		else if (value === "--stages") options.stages = true;
		else if (value === "--json") {
			options.jsonPath = args[++i];
			if (!options.jsonPath) throw new Error("--json requires a path");
		} else if (value === "--repetitions" || value === "-n") {
			options.repetitions = integer(args[++i], value);
		} else if (value === "--warmups") options.warmups = integer(args[++i], value);
		else if (value === "--timeout-ms") options.timeoutMs = integer(args[++i], value);
		else if (value === "--help" || value === "-h") throw new Error("help");
		else throw new Error(`unknown benchmark option: ${value}`);
	}
	return options;
}
const integer = (value: string | undefined, name: string) => {
	if (!value || !/^[1-9]\d*$/.test(value)) throw new Error(`${name} requires a positive integer`);
	return Number(value);
};
export const percentile = (values: number[], p: number): number | null => {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
export const summary = (samples: Sample[]) => {
	const successful = samples.filter((sample) => sample.exitCode === 0 && !sample.timedOut);
	const ttfb = successful.flatMap((sample) => (sample.ttfbMs === null ? [] : [sample.ttfbMs]));
	const total = successful.map((sample) => sample.totalMs);
	const bytes = successful.map((sample) => sample.outputBytes);
	const p50TotalMs = percentile(total, 50);
	return {
		runs: samples.length,
		failures: samples.length - successful.length,
		failureDetails: samples
			.filter((sample) => sample.exitCode !== 0 || sample.timedOut)
			.map((sample) => ({
				exitCode: sample.exitCode,
				timedOut: sample.timedOut,
				error: sample.error,
			})),
		ttfbP50Ms: percentile(ttfb, 50),
		ttfbP95Ms: percentile(ttfb, 95),
		totalP50Ms: p50TotalMs,
		totalP95Ms: percentile(total, 95),
		outputBytes: percentile(bytes, 50),
		throughputBytesPerSecond:
			p50TotalMs && p50TotalMs > 0
				? Math.round((percentile(bytes, 50) ?? 0) / (p50TotalMs / 1000))
				: null,
	};
};

/** Reads stdout while the process runs, avoiding a full-pipe deadlock before waiting for exit. */
export async function collectProcess(
	cmd: string[],
	input: string,
	timeoutMs: number,
): Promise<Sample> {
	const started = performance.now();
	let child: ReturnType<typeof Bun.spawn>;
	try {
		child = Bun.spawn({
			cmd,
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, REVUEDIFF_CONFIG: "/dev/null" },
		});
	} catch (error) {
		return {
			ttfbMs: null,
			totalMs: performance.now() - started,
			outputBytes: 0,
			exitCode: null,
			timedOut: false,
			error: String(error),
		};
	}
	let firstByte: number | null = null;
	let outputBytes = 0;
	let stderr = "";
	let timedOut = false;
	const readOutput = (async () => {
		const reader = child.stdout.getReader();
		try {
			for (;;) {
				const chunk = await reader.read();
				if (chunk.done) break;
				if (firstByte === null) firstByte = performance.now() - started;
				outputBytes += chunk.value.byteLength;
			}
		} finally {
			reader.releaseLock();
		}
	})();
	const readError = new Response(child.stderr).text().then((text) => {
		stderr = text;
	});
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill();
	}, timeoutMs);
	try {
		await child.stdin.write(input);
		child.stdin.end();
		await Promise.all([child.exited, readOutput, readError]);
	} finally {
		clearTimeout(timer);
	}
	const exitCode = await child.exited;
	return {
		ttfbMs: firstByte,
		totalMs: performance.now() - started,
		outputBytes,
		exitCode,
		timedOut,
		error: exitCode === 0 ? undefined : stderr.trim() || undefined,
	};
}

export async function benchmark(command: string[], scenario: Scenario, options: Options) {
	for (let i = 0; i < options.warmups; i += 1)
		await collectProcess(command, scenario.input, options.timeoutMs);
	const samples: Sample[] = [];
	for (let i = 0; i < options.repetitions; i += 1)
		samples.push(await collectProcess(command, scenario.input, options.timeoutMs));
	return summary(samples);
}

export async function stageTimings(scenarios: Scenario[]) {
	const theme = withTransparentSurfaces(resolveTheme("ayu-dark", null));
	return Promise.all(
		scenarios
			.filter((scenario) => scenario.expect === "formatted")
			.map(async (scenario) => {
				const classifyStart = performance.now();
				const classified = classifyPagerInput(scenario.input);
				const classifyMs = performance.now() - classifyStart;
				if (classified.kind === "passthrough")
					return { id: scenario.id, classifyMs, syntaxMs: null, formatMs: null };
				const syntaxStart = performance.now();
				await prepareSyntaxHighlighting(classified.files, theme.syntaxTheme);
				const syntaxMs = performance.now() - syntaxStart;
				const formatStart = performance.now();
				classified.files.forEach((file) => {
					formatAnsiDiffFile({
						file,
						layout: scenario.args.includes("--width=60") ? "stack" : "split",
						width: scenario.args.includes("--width=60") ? 60 : 100,
						theme,
						lineNumbers: false,
						changeMarkers: false,
					});
				});
				return { id: scenario.id, classifyMs, syntaxMs, formatMs: performance.now() - formatStart };
			}),
	);
}

export async function compileRevuediff(output: string) {
	const result = Bun.spawn(
		["bun", "build", "--compile", "packages/revuediff/src/main.ts", "--outfile", output],
		{ stdout: "pipe", stderr: "pipe" },
	);
	if ((await result.exited) !== 0)
		throw new Error(`compile failed: ${await new Response(result.stderr).text()}`);
}
export async function writeJson(path: string, report: unknown) {
	await mkdir(dirname(resolve(path)), { recursive: true });
	await writeFile(path, `${JSON.stringify(report, null, "\t")}\n`);
}
export const commandAvailable = async (name: string) => {
	const process = Bun.spawn(["sh", "-c", `command -v ${name} >/dev/null`], {
		stdout: "ignore",
		stderr: "ignore",
	});
	return (await process.exited) === 0;
};
export const catCommand = existsSync("/bin/cat") ? "/bin/cat" : "cat";
export const short = (value: number | null) => (value === null ? "-" : `${value.toFixed(1)}ms`);
