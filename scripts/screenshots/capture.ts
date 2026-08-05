#!/usr/bin/env bun
// Drives revue under vhs across a scenario × width × layout × theme matrix and writes one PNG per
// combination, so the patch view can be judged against the diff shapes that usually break renderers.
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildFixture } from "./fixtures.ts";
import { SCENARIOS, type Scenario } from "./scenarios.ts";
import {
	type CellSize,
	calibrate,
	renderTape,
	runTape,
	solveViewport,
	type Viewport,
} from "./vhs.ts";

const COLUMNS = [80, 120, 180, 240];
const ROWS = 50;
/**
 * Font sizes tried from largest down, until the frame fits the limit. vhs cannot convert frames
 * beyond roughly 2150 pixels wide, so the widest terminals are drawn in a smaller face.
 */
const FONT_SIZES = [14, 12];
const MAX_FRAME_WIDTH = 2048;
const LAYOUTS = [
	{ id: "split", preference: "split" },
	{ id: "stack", preference: "stacked" },
] as const;
const THEMES = ["ayu-dark", "ayu-light"] as const;
/** Scenarios run in parallel; each scenario's own shots stay serial, one git repo at a time. */
const WORKERS = 4;
const MIN_BYTES = 4096;
/** The status bar's quit hint: the first thing on screen once the review has painted. */
const READY_PATTERN = "q quit";

const repoRoot = resolve(import.meta.dir, "..", "..");
const outDir = join(repoRoot, "scripts", "screenshots", "out");
const shotsDir = join(outDir, "shots");
const workDir = join(outDir, "work");
const mainEntry = join(repoRoot, "packages", "tui", "src", "main.tsx");

type Job = {
	id: string;
	scenario: Scenario;
	viewport: Viewport;
	layout: (typeof LAYOUTS)[number];
	theme: string;
	repo: string;
};

type Capture = {
	id: string;
	scenario: string;
	cols: number;
	rows: number;
	fontSize: number;
	layout: string;
	theme: string;
	files: string[];
};

const jobsFor = (scenario: Scenario, repo: string, viewports: Viewport[]): Job[] =>
	viewports.flatMap((viewport) =>
		LAYOUTS.flatMap((layout) =>
			THEMES.map((theme) => ({
				id: `${scenario.id}--w${viewport.cols}--${layout.id}--${theme}`,
				scenario,
				viewport,
				layout,
				theme,
				repo,
			})),
		),
	);

/** An isolated HOME keeps the reviewer's own preferences out of the sweep, and the layout fixed. */
const prepareHome = async (job: Job): Promise<string> => {
	const home = join(workDir, "homes", job.id);
	await mkdir(join(home, ".revue"), { recursive: true });
	await writeFile(
		join(home, ".revue", "preferences.json"),
		`${JSON.stringify({ diffPreference: job.layout.preference }, null, 2)}\n`,
		"utf8",
	);
	return home;
};

const commandFor = (job: Job, home: string): string =>
	[
		`cd '${job.repo}'`,
		`HOME='${home}' bun run '${mainEntry}' diff --ref work --theme ${job.theme}`,
	].join(" && ");

const isUsable = async (path: string): Promise<boolean> => {
	try {
		const info = await stat(path);
		return info.size >= MIN_BYTES;
	} catch {
		return false;
	}
};

const shotPaths = (job: Job): { screenshot: string; paged?: string } => ({
	screenshot: join(shotsDir, `${job.id}.png`),
	paged: job.scenario.pagedShot ? join(shotsDir, `${job.id}--paged.png`) : undefined,
});

const attempt = async (job: Job): Promise<{ files: string[]; stderr: string }> => {
	const home = await prepareHome(job);
	const { screenshot, paged } = shotPaths(job);
	const tape = renderTape({
		fontSize: job.viewport.fontSize,
		widthPx: job.viewport.widthPx,
		heightPx: job.viewport.heightPx,
		command: commandFor(job, home),
		waitFor: READY_PATTERN,
		screenshot,
		pagedScreenshot: paged,
	});
	const run = await runTape(tape, join(workDir, "tapes", `${job.id}.tape`));
	const expected = paged ? [screenshot, paged] : [screenshot];
	const usable = await Promise.all(expected.map(isUsable));
	return { files: usable.every(Boolean) ? expected : [], stderr: run.stderr };
};

/** Shots already on disk are kept, so an interrupted sweep resumes; delete `out/` to redo them. */
const existingShots = async (job: Job): Promise<string[]> => {
	const { screenshot, paged } = shotPaths(job);
	const expected = paged ? [screenshot, paged] : [screenshot];
	const usable = await Promise.all(expected.map(isUsable));
	return usable.every(Boolean) ? expected : [];
};

const captureJob = async (job: Job): Promise<Capture | string> => {
	const done = await existingShots(job);
	const first = done.length > 0 ? { files: done, stderr: "" } : await attempt(job);
	const result = first.files.length > 0 ? first : await attempt(job);
	if (result.files.length === 0)
		return `${job.id}: ${result.stderr.trim() || "no screenshot written"}`;
	return {
		id: job.id,
		scenario: job.scenario.id,
		cols: job.viewport.cols,
		rows: job.viewport.rows,
		fontSize: job.viewport.fontSize,
		layout: job.layout.id,
		theme: job.theme,
		files: result.files,
	};
};

const runQueue = async <T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> => {
	const queue = [...items];
	const results: R[] = [];
	const consume = async (): Promise<void> => {
		for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
			results.push(await worker(next));
		}
	};
	await Promise.all(Array.from({ length: Math.min(WORKERS, items.length) }, consume));
	return results;
};

const captureScenario = async (
	scenario: Scenario,
	viewports: Viewport[],
): Promise<(Capture | string)[]> => {
	const repo = await buildFixture(scenario, join(workDir, "fixtures"));
	const results: (Capture | string)[] = [];
	for (const job of jobsFor(scenario, repo, viewports)) {
		results.push(await captureJob(job));
	}
	return results;
};

type MeasuredFont = { fontSize: number; cell: CellSize };

/** The largest font whose frame stays inside vhs's conversion limit at this many columns. */
const fontFor = (cols: number, fonts: MeasuredFont[]): MeasuredFont => {
	const fits = fonts.find(({ cell }) => cols * cell.widthPx <= MAX_FRAME_WIDTH);
	const smallest = fonts[fonts.length - 1];
	if (!smallest) throw new Error("no font sizes to measure");
	return fits ?? smallest;
};

const resolveViewports = async (): Promise<Viewport[]> => {
	const fonts: MeasuredFont[] = [];
	for (const fontSize of FONT_SIZES) {
		fonts.push({ fontSize, cell: await calibrate(workDir, fontSize) });
	}
	const viewports: Viewport[] = [];
	for (const cols of COLUMNS) {
		const { fontSize, cell } = fontFor(cols, fonts);
		viewports.push(await solveViewport(workDir, cell, { cols, rows: ROWS, fontSize }));
	}
	return viewports;
};

/** `--scenario <id>` recaptures one shape without waiting on the whole matrix. */
const selectedScenarios = (): Scenario[] => {
	const index = process.argv.indexOf("--scenario");
	if (index === -1) return SCENARIOS;
	const id = process.argv[index + 1];
	const chosen = SCENARIOS.filter((scenario) => scenario.id === id);
	if (chosen.length === 0) throw new Error(`unknown scenario: ${id ?? "(missing)"}`);
	return chosen;
};

const main = async (): Promise<number> => {
	for (const directory of [shotsDir, join(workDir, "tapes"), join(workDir, "fixtures")]) {
		await mkdir(directory, { recursive: true });
	}

	const viewports = await resolveViewports();
	process.stdout.write(
		`terminal sizes: ${viewports
			.map((v) => `${v.cols}x${v.rows}=${v.widthPx}x${v.heightPx}px @${v.fontSize}pt`)
			.join(", ")}\n`,
	);

	const scenarios = selectedScenarios();
	const batches = await runQueue(scenarios, (scenario) => captureScenario(scenario, viewports));
	const results = batches.flat();
	const captures = results.filter((result): result is Capture => typeof result !== "string");
	const failures = results.filter((result): result is string => typeof result === "string");
	const shots = captures.flatMap((capture) => capture.files);

	// A filtered run only knows about its own scenario, so it leaves the whole-sweep manifest alone.
	if (scenarios.length === SCENARIOS.length) {
		await writeFile(
			join(outDir, "manifest.json"),
			`${JSON.stringify({ captures, failures }, null, 2)}\n`,
			"utf8",
		);
	}
	process.stdout.write(`${shots.length} screenshots in ${shotsDir}\n`);
	for (const failure of failures) process.stderr.write(`FAILED ${failure}\n`);
	return failures.length === 0 ? 0 : 1;
};

process.exit(await main());
