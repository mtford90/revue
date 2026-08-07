import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { prepareSyntaxHighlighting } from "../../packages/diff/src/index.ts";
import { formatAnsiDiffFile } from "../../packages/diff-ansi/src/index.ts";
import { layoutForFile } from "../../packages/revuediff/src/pager.ts";
import { classifyPagerInput } from "../../packages/revuediff/src/pagerInput.ts";
import { resolveTheme, withTransparentSurfaces } from "../../packages/theme/src/index.ts";
import type { Scenario } from "./revuediff-scenarios.ts";

export const SCHEMA_VERSION = 2;
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
	inputBytes: number;
	outputBytes: number;
	exitCode: number | null;
	timedOut: boolean;
	error?: string;
};
export type ProcessResult = Sample & { stdout: string; stderr: string };
export type BenchmarkResult = ReturnType<typeof summary> & {
	warmupFailures: number;
	rawWarmupSamples: Sample[];
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
	return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
};
export const summary = (samples: Sample[]) => {
	const successful = samples.filter((sample) => sample.exitCode === 0 && !sample.timedOut);
	const ttfb = successful.flatMap((sample) => (sample.ttfbMs === null ? [] : [sample.ttfbMs]));
	const total = successful.map((sample) => sample.totalMs);
	const outputBytes = successful.map((sample) => sample.outputBytes);
	const inputThroughput = successful
		.filter((sample) => sample.totalMs > 0)
		.map((sample) => Math.round(sample.inputBytes / (sample.totalMs / 1000)));
	const outputThroughput = successful
		.filter((sample) => sample.totalMs > 0)
		.map((sample) => Math.round(sample.outputBytes / (sample.totalMs / 1000)));
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
		totalP50Ms: percentile(total, 50),
		totalP95Ms: percentile(total, 95),
		outputBytesP50: percentile(outputBytes, 50),
		inputThroughputBytesPerSecondP50: percentile(inputThroughput, 50),
		outputThroughputBytesPerSecondP50: percentile(outputThroughput, 50),
		rawSamples: samples,
	};
};

const delay = (milliseconds: number) =>
	new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const killProcessTree = (
	child: ReturnType<typeof Bun.spawn>,
	signal: "SIGTERM" | "SIGKILL",
): void => {
	try {
		// detached creates a POSIX process group on macOS/Linux; a negative pid targets descendants too.
		process.kill(-child.pid, signal);
		return;
	} catch {
		try {
			child.kill(signal);
		} catch {
			// It may have exited between the state check and signal delivery.
		}
	}
};

/**
 * Drain both output pipes concurrently, but enforce a bounded lifecycle: deadline, process-group
 * SIGTERM, grace period, then process-group SIGKILL. A timeout is sticky even if TERM exits zero.
 */
export async function collectProcess(
	cmd: string[],
	input: string,
	timeoutMs: number,
	deadlines: { terminationGraceMs?: number; killGraceMs?: number } = {},
): Promise<ProcessResult> {
	const started = performance.now();
	const inputBytes = Buffer.byteLength(input);
	let child: ReturnType<typeof Bun.spawn>;
	try {
		child = Bun.spawn({
			cmd,
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			detached: process.platform !== "win32",
			env: { ...process.env, REVUEDIFF_CONFIG: "/dev/null" },
		});
	} catch (error) {
		return {
			ttfbMs: null,
			totalMs: performance.now() - started,
			inputBytes,
			outputBytes: 0,
			exitCode: null,
			timedOut: false,
			error: String(error),
			stdout: "",
			stderr: "",
		};
	}
	let firstByte: number | null = null;
	let exitCode: number | null = null;
	let settledComplete = false;
	let timedOut = false;
	let inputError: string | undefined;
	const stdoutChunks: Uint8Array[] = [];
	const stderrChunks: Uint8Array[] = [];
	const stdoutReader = child.stdout.getReader();
	const stderrReader = child.stderr.getReader();
	const drain = async (
		reader: ReadableStreamDefaultReader<Uint8Array>,
		chunks: Uint8Array[],
		first: boolean,
	) => {
		try {
			for (;;) {
				const chunk = await reader.read();
				if (chunk.done) break;
				if (first && firstByte === null && chunk.value.byteLength > 0)
					firstByte = performance.now() - started;
				chunks.push(chunk.value);
			}
		} catch (error) {
			if (!timedOut) throw error;
		} finally {
			reader.releaseLock();
		}
	};
	const readOutput = drain(stdoutReader, stdoutChunks, true);
	const readError = drain(stderrReader, stderrChunks, false);
	const writeInput = (async () => {
		try {
			await child.stdin.write(input);
			child.stdin.end();
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "EPIPE" && !timedOut) inputError = String(error);
		}
	})();
	const exited = child.exited.then((code) => {
		exitCode = code;
	});
	const settled = Promise.all([exited, writeInput, readOutput, readError]).then(() => {
		settledComplete = true;
	});
	let resolveDeadline: (() => void) | undefined;
	const deadline = new Promise<void>((resolvePromise) => {
		resolveDeadline = resolvePromise;
	});
	const terminationGraceMs = deadlines.terminationGraceMs ?? 500;
	const killGraceMs = deadlines.killGraceMs ?? 500;
	const timer = setTimeout(() => {
		void (async () => {
			timedOut = true;
			killProcessTree(child, "SIGTERM");
			await delay(terminationGraceMs);
			if (!settledComplete) killProcessTree(child, "SIGKILL");
			await Promise.race([
				settled.then(
					() => undefined,
					() => undefined,
				),
				delay(killGraceMs),
			]);
			resolveDeadline?.();
		})();
	}, timeoutMs);
	const outcome = await Promise.race([
		settled.then(() => "settled" as const),
		deadline.then(() => "deadline" as const),
	]);
	clearTimeout(timer);
	if (outcome === "deadline") {
		try {
			child.stdin.end();
		} catch {
			// The descriptor may already be closed.
		}
		void stdoutReader.cancel().catch(() => undefined);
		void stderrReader.cancel().catch(() => undefined);
	}
	const stdout = Buffer.concat(stdoutChunks).toString();
	const stderr = Buffer.concat(stderrChunks).toString();
	const error = timedOut
		? `timed out after ${timeoutMs}ms${stderr.trim() ? `: ${stderr.trim()}` : ""}`
		: exitCode !== 0
			? stderr.trim() || inputError
			: inputError;
	return {
		ttfbMs: firstByte,
		totalMs: performance.now() - started,
		inputBytes,
		outputBytes: Buffer.byteLength(stdout),
		exitCode,
		timedOut,
		error,
		stdout,
		stderr,
	};
}

const sampleOnly = ({ stdout: _stdout, stderr: _stderr, ...sample }: ProcessResult): Sample =>
	sample;

export async function benchmark(command: string[], scenario: Scenario, options: Options) {
	const warmupSamples: Sample[] = [];
	for (let i = 0; i < options.warmups; i += 1)
		warmupSamples.push(
			sampleOnly(await collectProcess(command, scenario.input, options.timeoutMs)),
		);
	const samples: Sample[] = [];
	for (let i = 0; i < options.repetitions; i += 1)
		samples.push(sampleOnly(await collectProcess(command, scenario.input, options.timeoutMs)));
	const measured = summary(samples);
	const warmupFailures = warmupSamples.filter(
		(sample) => sample.exitCode !== 0 || sample.timedOut,
	).length;
	return {
		...measured,
		failures: measured.failures + warmupFailures,
		warmupFailures,
		rawWarmupSamples: warmupSamples,
	};
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI is the formatted-output contract.
const ANSI_CONTROL = /\x1b\[[0-?]*[ -/]*[@-~]/;

export function validateScenarioOutput(
	scenario: Scenario,
	result: Pick<ProcessResult, "exitCode" | "timedOut" | "stdout" | "stderr">,
): string[] {
	const errors: string[] = [];
	if (result.timedOut) errors.push("validation process timed out");
	if (result.exitCode !== 0) errors.push(`validation exited ${String(result.exitCode)}`);
	if (result.stderr.trim()) errors.push(`validation wrote stderr: ${result.stderr.trim()}`);
	if (scenario.expect.kind === "help") {
		for (const text of scenario.expect.contains)
			if (!result.stdout.includes(text))
				errors.push(`help output is missing ${JSON.stringify(text)}`);
	} else if (scenario.expect.kind === "passthrough") {
		if (result.stdout !== scenario.expect.output)
			errors.push("passthrough output was not sanitised exactly");
		if (ANSI_CONTROL.test(result.stdout)) errors.push("passthrough output contained ANSI controls");
	} else {
		if (!ANSI_CONTROL.test(result.stdout))
			errors.push("formatted output did not contain ANSI styling");
		if (result.stdout === scenario.input) errors.push("formatted output was unchanged passthrough");
		for (const file of scenario.expect.files) {
			const header = `${file.path}  +${file.additions} -${file.deletions}`;
			if (!result.stdout.includes(header))
				errors.push(`formatted output is missing changed-row header ${header}`);
		}
	}
	return errors;
}

export async function validateExecutableScenario(
	command: string[],
	scenario: Scenario,
	timeoutMs: number,
) {
	const result = await collectProcess(command, scenario.input, timeoutMs);
	const errors = validateScenarioOutput(scenario, result);
	return {
		passed: errors.length === 0,
		errors,
		exitCode: result.exitCode,
		timedOut: result.timedOut,
		outputBytes: result.outputBytes,
		outputSha256: digest(result.stdout),
	};
}

export function hasBenchmarkFailures(results: Record<string, { failures: number }>): boolean {
	return Object.values(results).some((result) => result.failures > 0);
}

const requestedWidth = (args: string[]): number => {
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument?.startsWith("--width=")) return Number(argument.slice("--width=".length));
		if (argument === "--width") return Number(args[index + 1]);
	}
	return 80;
};

/** Diagnostic stages run serially; setup for each next stage begins only after the prior one ends. */
export async function stageTimings(scenarios: Scenario[]) {
	const theme = withTransparentSurfaces(resolveTheme("ayu-dark", null));
	const results = [];
	let syntaxStarted = false;
	for (const scenario of scenarios.filter((item) => item.expect.kind === "formatted")) {
		const classifyStart = performance.now();
		const classified = classifyPagerInput(scenario.input);
		const classifyMs = performance.now() - classifyStart;
		if (classified.kind === "passthrough") {
			results.push({ id: scenario.id, classifyMs, error: "scenario unexpectedly passed through" });
			continue;
		}
		const syntaxStart = performance.now();
		const firstPreparation = await prepareSyntaxHighlighting(classified.files, theme.syntaxTheme);
		const syntaxFirstPassMs = performance.now() - syntaxStart;
		const syntaxFirstPassState = `${syntaxStarted ? "warmed" : "cold"}-${firstPreparation.backend}`;
		syntaxStarted = true;
		const warmed = classifyPagerInput(scenario.input);
		if (warmed.kind === "passthrough") {
			results.push({
				id: scenario.id,
				classifyMs,
				error: "warm scenario unexpectedly passed through",
			});
			continue;
		}
		const warmedStart = performance.now();
		await prepareSyntaxHighlighting(warmed.files, theme.syntaxTheme);
		const syntaxWarmedMs = performance.now() - warmedStart;
		const width = requestedWidth(scenario.args);
		const layouts = [...new Set(warmed.files.map((file) => layoutForFile(file, width)))];
		const formatStart = performance.now();
		for (const file of warmed.files) {
			formatAnsiDiffFile({
				file,
				layout: layoutForFile(file, width),
				width,
				theme,
				lineNumbers: false,
				changeMarkers: false,
			});
		}
		results.push({
			id: scenario.id,
			width,
			layouts,
			sequence: ["classify", "syntax-first-pass", "syntax-warmed", "format"],
			classifyMs,
			syntaxFirstPassState,
			syntaxFirstPassMs,
			syntaxWarmedMs,
			formatMs: performance.now() - formatStart,
		});
	}
	return results;
}

export async function compileRevuediff(output: string) {
	const result = Bun.spawn(
		["bun", "build", "--compile", "packages/revuediff/src/main.ts", "--outfile", output],
		{ stdout: "pipe", stderr: "pipe" },
	);
	if ((await result.exited) !== 0)
		throw new Error(`compile failed: ${await new Response(result.stderr).text()}`);
	const addon = Bun.spawn([
		"bash",
		"scripts/build-native-highlighter.sh",
		"revuediff",
		join(dirname(output), "revuediff-highlighter.node"),
	]);
	if ((await addon.exited) !== 0) throw new Error("native highlighter build failed");
}
export async function writeJson(path: string, report: unknown) {
	await mkdir(dirname(resolve(path)), { recursive: true });
	await writeFile(path, `${JSON.stringify(report, null, "\t")}\n`);
}
export const commandAvailable = async (name: string) => {
	const command = Bun.spawn(["sh", "-c", 'command -v -- "$1" >/dev/null', "sh", name], {
		stdout: "ignore",
		stderr: "ignore",
	});
	return (await command.exited) === 0;
};
export const commandVersion = async (command: string[]): Promise<string> => {
	const result = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
	const [exitCode, stdout, stderr] = await Promise.all([
		result.exited,
		new Response(result.stdout).text(),
		new Response(result.stderr).text(),
	]);
	return exitCode === 0 ? (stdout.trim() || stderr.trim()).split("\n")[0] || "unknown" : "unknown";
};
export const digest = (value: string | Uint8Array): string => {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(value);
	return `sha256:${hasher.digest("hex")}`;
};
export const fileDigest = async (path: string) =>
	digest(new Uint8Array(await Bun.file(path).arrayBuffer()));
export const catCommand = existsSync("/bin/cat") ? "/bin/cat" : "cat";
export const short = (value: number | null) => (value === null ? "-" : `${value.toFixed(1)}ms`);
