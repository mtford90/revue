// Tape generation and the vhs invocation itself. vhs sizes its terminal in pixels, so the harness
// measures the cell box once and solves for the pixel size that yields the columns we asked for.
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const FONT_FAMILY = "Menlo";

export type TapeSpec = {
	fontSize: number;
	widthPx: number;
	heightPx: number;
	/** Shell line typed (hidden) to start the program under test. */
	command: string;
	/** Screen text vhs waits for before the first shot; omitted for plain shell tapes. */
	waitFor?: string;
	screenshot: string;
	/** A second shot after paging down, for scenarios where the first screen is a wall. */
	pagedScreenshot?: string;
};

const HEADER = (spec: TapeSpec): string[] => [
	'Set Shell "bash"',
	`Set FontFamily "${FONT_FAMILY}"`,
	`Set FontSize ${spec.fontSize}`,
	"Set Padding 0",
	`Set Width ${spec.widthPx}`,
	`Set Height ${spec.heightPx}`,
	"Set WaitTimeout 60s",
];

/** vhs only writes frames while shown, so every shot has to unhide first. */
const shot = (screenshot: string): string[] => [
	"Show",
	"Sleep 150ms",
	`Screenshot "${screenshot}"`,
];

const pagedShot = (screenshot: string | undefined): string[] =>
	screenshot ? ["Hide", "PageDown 3", "Sleep 1500ms", ...shot(screenshot)] : [];

export const renderTape = (spec: TapeSpec): string =>
	[
		...HEADER(spec),
		"Hide",
		`Type "${spec.command}"`,
		"Enter",
		spec.waitFor ? `Wait+Screen@60s /${spec.waitFor}/` : "Sleep 2s",
		"Sleep 1500ms",
		...shot(spec.screenshot),
		...pagedShot(spec.pagedScreenshot),
		"",
	].join("\n");

export type TapeRun = { ok: boolean; stderr: string };

/**
 * Chrome cannot start its own sandbox when vhs runs inside a confined process, and vhs only ever
 * points that browser at a local ttyd, so the harness disables it rather than failing to render.
 */
const vhsEnvironment = (): Record<string, string> => ({
	...(process.env as Record<string, string>),
	VHS_NO_SANDBOX: "true",
});

export const runTape = async (tape: string, tapePath: string): Promise<TapeRun> => {
	await writeFile(tapePath, tape, "utf8");
	const result = Bun.spawnSync(["vhs", tapePath], {
		env: vhsEnvironment(),
		stdout: "pipe",
		stderr: "pipe",
	});
	return { ok: result.exitCode === 0, stderr: result.stderr.toString() };
};

export type CellSize = { widthPx: number; heightPx: number };

type Measurement = { cols: number; rows: number; captured: boolean };

const measure = async (
	workDir: string,
	spec: { fontSize: number; widthPx: number; heightPx: number },
): Promise<Measurement> => {
	const sizePath = join(workDir, "size.txt");
	const screenshot = join(workDir, "calibration.png");
	await rm(screenshot, { force: true });
	const tape = renderTape({ ...spec, command: `stty size > '${sizePath}'`, screenshot });
	const run = await runTape(tape, join(workDir, "calibration.tape"));
	if (!run.ok) throw new Error(`vhs calibration failed:\n${run.stderr}`);
	const [rows, cols] = (await readFile(sizePath, "utf8")).trim().split(/\s+/).map(Number);
	if (!rows || !cols) throw new Error("vhs calibration produced no terminal size");
	return { cols, rows, captured: existsSync(screenshot) };
};

/** Pixel size of one terminal cell at a given font size, from a single large measurement. */
export const calibrate = async (workDir: string, fontSize: number): Promise<CellSize> => {
	const probe = { fontSize, widthPx: 1600, heightPx: 900 };
	const { cols, rows } = await measure(workDir, probe);
	return { widthPx: probe.widthPx / cols, heightPx: probe.heightPx / rows };
};

export type Viewport = {
	cols: number;
	rows: number;
	fontSize: number;
	widthPx: number;
	heightPx: number;
};

/**
 * vhs composites the terminal over a background of the size it was asked for, and its filter graph
 * rejects sizes whose halves land off the pixel grid, so every dimension is kept even.
 */
const even = (value: number): number => 2 * Math.round(value / 2);

/**
 * Refines the pixel size until vhs reports exactly the columns and rows asked for and actually
 * writes the screenshot; a size that measures right but captures nothing is grown by one cell.
 */
export const solveViewport = async (
	workDir: string,
	cell: CellSize,
	target: { cols: number; rows: number; fontSize: number },
): Promise<Viewport> => {
	const { cols, rows, fontSize } = target;
	let widthPx = even(cols * cell.widthPx);
	let heightPx = even(rows * cell.heightPx);
	for (let attempt = 0; attempt < 6; attempt++) {
		const measured = await measure(workDir, { fontSize, widthPx, heightPx });
		const sized = measured.cols === cols && measured.rows === rows;
		if (sized && measured.captured) return { cols, rows, fontSize, widthPx, heightPx };
		widthPx += sized ? 2 : even((cols - measured.cols) * cell.widthPx);
		heightPx += sized ? 0 : even((rows - measured.rows) * cell.heightPx);
	}
	throw new Error(`could not size a vhs terminal to ${cols}x${rows}`);
};
