import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeTerminalLine } from "@revue/diff-renderer";
import type { PreparedRun } from "@revue/prep";
import { RUN_FILE_STATUS, RUN_OBJECT_KIND, type RunFile } from "@revue/types";

const REQUIRED_HELP_OPTIONS = ["--color", "--display", "--width"];
const SAFE_WIDTH_MINIMUM = 40;

/** Foreground colours by SGR code, so Difftastic's own styling follows the active theme. */
export type AnsiPalette = Record<number, string>;
const SIDE_BY_SIDE_MINIMUM = 80;
export type SemanticDiffSpan = {
	text: string;
	fg?: string;
	bold: boolean;
	dim: boolean;
	italic: boolean;
	underline: boolean;
};

export type SemanticDiffLine = {
	text: string;
	spans: SemanticDiffSpan[];
};

export type SemanticDiffFile = {
	path: string;
	lines: SemanticDiffLine[];
};

export type SemanticDiffResult = {
	files: SemanticDiffFile[];
	version: string;
};

export class SemanticDiffError extends Error {}

type SemanticRun = Pick<PreparedRun, "directory" | "manifest">;

type ProcessResult = { exitCode: number; stdout: string; stderr: string };
type SemanticStyle = Omit<SemanticDiffSpan, "text">;

const DEFAULT_STYLE: SemanticStyle = {
	bold: false,
	dim: false,
	italic: false,
	underline: false,
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: Difftastic styling arrives as SGR sequences.
const SGR_SEQUENCE = /\x1b\[([0-9;]*)m/g;

export const terminalSafe = (value: string): string =>
	value.split("\n").map(sanitizeTerminalLine).join("\n").trim();

const applySgr = (
	style: SemanticStyle,
	parameters: string,
	palette: AnsiPalette,
): SemanticStyle => {
	const next = { ...style };
	for (const value of (parameters || "0").split(";")) {
		const code = Number(value);
		if (code === 0) Object.assign(next, DEFAULT_STYLE, { fg: undefined });
		else if (code === 1) next.bold = true;
		else if (code === 2) next.dim = true;
		else if (code === 3) next.italic = true;
		else if (code === 4) next.underline = true;
		else if (code === 22) Object.assign(next, { bold: false, dim: false });
		else if (code === 23) next.italic = false;
		else if (code === 24) next.underline = false;
		else if (code === 39) next.fg = undefined;
		else if (palette[code]) next.fg = palette[code];
	}
	return next;
};

const styledLine = (value: string, palette: AnsiPalette): SemanticDiffLine => {
	const spans: SemanticDiffSpan[] = [];
	let cursor = 0;
	let style = { ...DEFAULT_STYLE };
	for (const match of value.matchAll(SGR_SEQUENCE)) {
		const text = sanitizeTerminalLine(value.slice(cursor, match.index));
		if (text) spans.push({ text, ...style });
		style = applySgr(style, match[1] ?? "0", palette);
		cursor = (match.index ?? cursor) + match[0].length;
	}
	const remainder = sanitizeTerminalLine(value.slice(cursor));
	if (remainder) spans.push({ text: remainder, ...style });
	return { text: spans.map((span) => span.text).join(""), spans };
};

const plainLine = (text: string): SemanticDiffLine => ({
	text,
	spans: text ? [{ text, ...DEFAULT_STYLE }] : [],
});

const styledOutput = (output: string, palette: AnsiPalette): SemanticDiffLine[] => {
	const lines = output.split("\n").map((line) => styledLine(line.replace(/\r$/, ""), palette));
	const lastContent = lines.findLastIndex((line) => line.text.length > 0);
	return lastContent < 0 ? [] : lines.slice(0, lastContent + 1);
};

const describeProcessFailure = (result: ProcessResult): string => {
	const detail = terminalSafe(result.stderr || result.stdout)
		.replace(/\s+/g, " ")
		.slice(0, 240);
	return detail ? `: ${detail}` : ` (exit ${result.exitCode})`;
};

async function runProcess(executable: string, args: string[]): Promise<ProcessResult> {
	let child: ReturnType<typeof Bun.spawn>;
	try {
		child = Bun.spawn([executable, ...args], {
			env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
			stdout: "pipe",
			stderr: "pipe",
		});
	} catch (error) {
		throw new SemanticDiffError(
			`Semantic diff unavailable: could not start ${JSON.stringify(executable)} (${terminalSafe(error instanceof Error ? error.message : String(error))}). Install a compatible Difftastic executable and retry.`,
		);
	}
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
}

async function detectDifftastic(executable: string): Promise<string> {
	const versionResult = await runProcess(executable, ["--version"]);
	if (versionResult.exitCode !== 0) {
		throw new SemanticDiffError(
			`Semantic diff unavailable: ${JSON.stringify(executable)} --version failed${describeProcessFailure(versionResult)}.`,
		);
	}
	const version = terminalSafe(versionResult.stdout || versionResult.stderr).split("\n")[0] ?? "";
	if (!/^Difftastic\s+\d+\.\d+\.\d+(?:\b|$)/.test(version)) {
		throw new SemanticDiffError(
			`Semantic diff unavailable: ${JSON.stringify(executable)} is not a compatible Difftastic executable (unexpected --version output).`,
		);
	}

	const helpResult = await runProcess(executable, ["--help"]);
	const help = `${helpResult.stdout}\n${helpResult.stderr}`;
	if (helpResult.exitCode !== 0 || REQUIRED_HELP_OPTIONS.some((option) => !help.includes(option))) {
		throw new SemanticDiffError(
			`Semantic diff unavailable: ${version} does not provide the required ${REQUIRED_HELP_OPTIONS.join(", ")} command-line options.`,
		);
	}
	return version;
}

const statusHeader = (file: RunFile): string => {
	if (file.status === RUN_FILE_STATUS.RENAMED || file.status === RUN_FILE_STATUS.COPIED) {
		return `${file.status}: ${file.previousPath ?? "(unknown)"} -> ${file.path}`;
	}
	return `${file.status}: ${file.path}`;
};

const modeDescription = (mode: string | null): string => (mode ? mode : "absent");

const metadataOnlyLines = (file: RunFile): SemanticDiffLine[] | null => {
	const header = plainLine(statusHeader(file));
	if (file.isBinary) {
		return [header, plainLine("Binary snapshots cannot be represented as a semantic source diff.")];
	}
	if (file.oldKind === RUN_OBJECT_KIND.SYMLINK || file.newKind === RUN_OBJECT_KIND.SYMLINK) {
		return [
			header,
			plainLine(
				"Symlink snapshots are not parsed as source code; review the link-target change in Patch view.",
			),
		];
	}
	if (file.status === RUN_FILE_STATUS.MODE_CHANGED) {
		return [
			header,
			plainLine(
				`File mode changed ${modeDescription(file.oldMode)} -> ${modeDescription(file.newMode)}; there is no semantic content change.`,
			),
		];
	}
	if (file.oldBlob === file.newBlob) {
		return [
			header,
			plainLine("Pinned old and new contents are identical; there is no semantic content change."),
		];
	}
	return null;
};

const blobPath = (run: SemanticRun, hash: string | null, emptyPath: string): string =>
	hash ? join(run.directory, "blobs", hash) : emptyPath;

const semanticArgs = (
	run: SemanticRun,
	file: RunFile,
	emptyPath: string,
	width: number,
): string[] => [
	"--color=always",
	width >= SIDE_BY_SIDE_MINIMUM ? "--display=side-by-side" : "--display=inline",
	`--width=${Math.max(SAFE_WIDTH_MINIMUM, Math.floor(width))}`,
	"--",
	file.path,
	blobPath(run, file.oldBlob, emptyPath),
	file.oldBlob ?? "0000000",
	file.oldMode ?? "000000",
	blobPath(run, file.newBlob, emptyPath),
	file.newBlob ?? "0000000",
	file.newMode ?? "000000",
];

const outputLines = (file: RunFile, output: string, palette: AnsiPalette): SemanticDiffLine[] => {
	const styled = styledOutput(output, palette);
	return [
		plainLine(statusHeader(file)),
		...(file.status === RUN_FILE_STATUS.ADDED
			? [
					plainLine(
						"Old snapshot is absent; comparing an empty pre-image with the pinned new snapshot.",
					),
				]
			: []),
		...(file.status === RUN_FILE_STATUS.DELETED
			? [
					plainLine(
						"New snapshot is absent; comparing the pinned old snapshot with an empty post-image.",
					),
				]
			: []),
		...(styled.length ? styled : [plainLine("Difftastic found no semantic content changes.")]),
	];
};

/**
 * Run Difftastic only against the verified blob files inside a prepared run.
 * No repository path or current Git state is consulted.
 */
export async function generateSemanticDiff(
	run: SemanticRun,
	width: number,
	palette: AnsiPalette,
	executable = "difft",
): Promise<SemanticDiffResult> {
	const version = await detectDifftastic(executable);
	const temporary = await mkdtemp(join(tmpdir(), "revue-semantic-"));
	const emptyPath = join(temporary, "empty");
	await writeFile(emptyPath, new Uint8Array());

	try {
		const files: SemanticDiffFile[] = [];
		for (const file of run.manifest.files) {
			const metadata = metadataOnlyLines(file);
			if (metadata) {
				files.push({ path: file.path, lines: metadata });
				continue;
			}
			const result = await runProcess(executable, semanticArgs(run, file, emptyPath, width));
			if (result.exitCode !== 0) {
				throw new SemanticDiffError(
					`Semantic diff unavailable: ${version} failed while comparing ${JSON.stringify(file.path)}${describeProcessFailure(result)}. Patch view remains active.`,
				);
			}
			files.push({ path: file.path, lines: outputLines(file, result.stdout, palette) });
		}
		return { files, version };
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}
