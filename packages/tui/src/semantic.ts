import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeTerminalLine } from "@revue/diff";
import type { PreparedRun } from "@revue/prep";
import { RUN_FILE_STATUS, RUN_OBJECT_KIND, type RunFile } from "@revue/types";
import { z } from "zod";

const REQUIRED_HELP_OPTIONS = ["--display", "json"];
const CONTEXT_LINES = 3;

export type SemanticEmphasisRange = { start: number; end: number };

export type SemanticEmphasis = {
	deletions: Map<number, SemanticEmphasisRange[]>;
	additions: Map<number, SemanticEmphasisRange[]>;
};

export type SemanticFileDiff = {
	path: string;
	/** A unified patch following Difftastic's alignment; null when only the notes apply. */
	patch: string | null;
	notes: string[];
	/** Char-exact novel ranges per 1-based line, keyed by diff side. */
	emphasis: SemanticEmphasis;
};

export type SemanticDiffResult = {
	files: SemanticFileDiff[];
	version: string;
};

export class SemanticDiffError extends Error {}

type SemanticRun = Pick<PreparedRun, "directory" | "manifest">;

type ProcessResult = { exitCode: number; stdout: string; stderr: string };

const changeSchema = z.object({
	start: z.number().int().min(0),
	end: z.number().int().min(0),
});

const sideSchema = z.object({
	line_number: z.number().int().min(0),
	changes: z.array(changeSchema),
});

const fileReportSchema = z.object({
	status: z.string(),
	chunks: z
		.array(z.array(z.object({ lhs: sideSchema.optional(), rhs: sideSchema.optional() })))
		.optional(),
	aligned_lines: z
		.array(z.tuple([z.number().int().nullable(), z.number().int().nullable()]))
		.optional(),
});

type FileReport = z.infer<typeof fileReportSchema>;

export const terminalSafe = (value: string): string =>
	value.split("\n").map(sanitizeTerminalLine).join("\n").trim();

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
			env: { ...process.env, NO_COLOR: "1", TERM: "dumb", DFT_UNSTABLE: "yes" },
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

const metadataOnlyNotes = (file: RunFile): string[] | null => {
	const header = statusHeader(file);
	if (file.isBinary) {
		return [header, "Binary snapshots cannot be represented as a semantic source diff."];
	}
	if (file.oldKind === RUN_OBJECT_KIND.SYMLINK || file.newKind === RUN_OBJECT_KIND.SYMLINK) {
		return [
			header,
			"Symlink snapshots are not parsed as source code; review the link-target change in Patch view.",
		];
	}
	if (file.status === RUN_FILE_STATUS.MODE_CHANGED) {
		return [
			header,
			`File mode changed ${modeDescription(file.oldMode)} -> ${modeDescription(file.newMode)}; there is no semantic content change.`,
		];
	}
	if (file.oldBlob === file.newBlob) {
		return [
			header,
			"Pinned old and new contents are identical; there is no semantic content change.",
		];
	}
	return null;
};

const emptyEmphasis = (): SemanticEmphasis => ({
	deletions: new Map(),
	additions: new Map(),
});

const splitLines = (content: string): string[] => {
	const lines = content.split("\n").map((line) => line.replace(/\r$/, ""));
	if (lines.at(-1) === "") lines.pop();
	return lines;
};

/** Difftastic reports UTF-8 byte offsets; spans render per char, so convert against the raw line. */
const byteRangeToCharRange = (
	line: string,
	range: { start: number; end: number },
): SemanticEmphasisRange | null => {
	const bytes = Buffer.from(line, "utf8");
	const start = bytes.subarray(0, Math.min(range.start, bytes.length)).toString("utf8").length;
	const end = bytes.subarray(0, Math.min(range.end, bytes.length)).toString("utf8").length;
	return end > start ? { start, end } : null;
};

const mergedRanges = (ranges: SemanticEmphasisRange[]): SemanticEmphasisRange[] => {
	const sorted = [...ranges].sort((left, right) => left.start - right.start);
	const merged: SemanticEmphasisRange[] = [];
	for (const range of sorted) {
		const last = merged.at(-1);
		if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
		else merged.push({ ...range });
	}
	return merged;
};

type NovelLines = {
	deletions: Map<number, SemanticEmphasisRange[]>;
	additions: Map<number, SemanticEmphasisRange[]>;
};

/** Flatten Difftastic's unordered chunk entries into per-side novel-line maps keyed by 0-based line. */
const novelLines = (report: FileReport, oldLines: string[], newLines: string[]): NovelLines => {
	const deletions = new Map<number, SemanticEmphasisRange[]>();
	const additions = new Map<number, SemanticEmphasisRange[]>();
	const record = (
		target: Map<number, SemanticEmphasisRange[]>,
		lines: string[],
		side: z.infer<typeof sideSchema>,
	) => {
		const line = lines[side.line_number];
		if (line === undefined) return;
		const ranges = side.changes.flatMap((change) => byteRangeToCharRange(line, change) ?? []);
		target.set(
			side.line_number,
			mergedRanges([...(target.get(side.line_number) ?? []), ...ranges]),
		);
	};
	for (const entry of (report.chunks ?? []).flat()) {
		if (entry.lhs) record(deletions, oldLines, entry.lhs);
		if (entry.rhs) record(additions, newLines, entry.rhs);
	}
	return { deletions, additions };
};

type AlignedPair = { old: number | null; new: number | null };

const displayablePairs = (
	report: FileReport,
	oldLines: string[],
	newLines: string[],
): AlignedPair[] =>
	(report.aligned_lines ?? [])
		.map(([oldIndex, newIndex]) => ({
			old: oldIndex !== null && oldIndex < oldLines.length ? oldIndex : null,
			new: newIndex !== null && newIndex < newLines.length ? newIndex : null,
		}))
		.filter((pair) => pair.old !== null || pair.new !== null);

/**
 * Difftastic's judgement decides what counts as a change: a pair it aligned without
 * novel tokens is semantically unchanged even when the text differs (whitespace,
 * reformatting), and renders as context.
 */
const pairIsChanged = (pair: AlignedPair, novel: NovelLines): boolean => {
	if (pair.old === null || pair.new === null) return true;
	return novel.deletions.has(pair.old) || novel.additions.has(pair.new);
};

type HunkGroup = { start: number; end: number };

/** Indexes into the aligned pairs covering each changed run plus its context, merged on overlap. */
const hunkGroups = (changed: boolean[]): HunkGroup[] => {
	const groups: HunkGroup[] = [];
	for (const [index, isChanged] of changed.entries()) {
		if (!isChanged) continue;
		const start = Math.max(0, index - CONTEXT_LINES);
		const end = Math.min(changed.length - 1, index + CONTEXT_LINES);
		const last = groups.at(-1);
		if (last && start <= last.end + 1) last.end = end;
		else groups.push({ start, end });
	}
	return groups;
};

/** One maximal streak of pairs sharing a shape, so deletions precede their paired additions. */
const pairShape = (pair: AlignedPair): "both" | "deletion" | "addition" =>
	pair.old !== null && pair.new !== null ? "both" : pair.old !== null ? "deletion" : "addition";

function hunkBody(
	pairs: AlignedPair[],
	changed: boolean[],
	group: HunkGroup,
	oldLines: string[],
	newLines: string[],
): string[] {
	const body: string[] = [];
	let cursor = group.start;
	while (cursor <= group.end) {
		const pair = pairs[cursor];
		if (!pair) break;
		if (!changed[cursor]) {
			// Context rows show the post-image, matching Difftastic's whitespace-blind alignment.
			body.push(` ${newLines[pair.new ?? -1] ?? oldLines[pair.old ?? -1] ?? ""}`);
			cursor += 1;
			continue;
		}
		const shape = pairShape(pair);
		const streak: AlignedPair[] = [];
		while (
			cursor <= group.end &&
			changed[cursor] &&
			pairs[cursor] &&
			pairShape(pairs[cursor] as AlignedPair) === shape
		) {
			streak.push(pairs[cursor] as AlignedPair);
			cursor += 1;
		}
		for (const entry of streak) {
			if (entry.old !== null) body.push(`-${oldLines[entry.old] ?? ""}`);
		}
		for (const entry of streak) {
			if (entry.new !== null) body.push(`+${newLines[entry.new] ?? ""}`);
		}
	}
	return body;
}

const hunkCounts = (body: string[]): { deletions: number; additions: number } => ({
	deletions: body.filter((line) => !line.startsWith("+")).length,
	additions: body.filter((line) => !line.startsWith("-")).length,
});

const firstLineNumbers = (pairs: AlignedPair[], group: HunkGroup): { old: number; new: number } => {
	let old: number | undefined;
	let added: number | undefined;
	for (let index = group.start; index <= group.end; index += 1) {
		const pair = pairs[index];
		if (!pair) continue;
		if (old === undefined && pair.old !== null) old = pair.old + 1;
		if (added === undefined && pair.new !== null) added = pair.new + 1;
	}
	return { old: old ?? 1, new: added ?? 1 };
};

function synthesisedPatch(
	file: RunFile,
	pairs: AlignedPair[],
	changed: boolean[],
	oldLines: string[],
	newLines: string[],
): string | null {
	const groups = hunkGroups(changed);
	if (!groups.length) return null;
	const oldPath = file.previousPath ?? file.path;
	const header = [`--- a/${oldPath}`, `+++ b/${file.path}`];
	const hunks = groups.map((group) => {
		const body = hunkBody(pairs, changed, group, oldLines, newLines);
		const counts = hunkCounts(body);
		const start = firstLineNumbers(pairs, group);
		return [
			`@@ -${start.old},${counts.deletions} +${start.new},${counts.additions} @@`,
			...body,
		].join("\n");
	});
	return `${[...header, ...hunks].join("\n")}\n`;
}

const wholeFilePatch = (
	file: RunFile,
	lines: string[],
	kind: "created" | "deleted",
): string | null => {
	if (!lines.length) return null;
	const marked = lines.map((line) => `${kind === "created" ? "+" : "-"}${line}`);
	const header =
		kind === "created"
			? ["--- /dev/null", `+++ b/${file.path}`, `@@ -0,0 +1,${lines.length} @@`]
			: [
					`--- a/${file.previousPath ?? file.path}`,
					"+++ /dev/null",
					`@@ -1,${lines.length} +0,0 @@`,
				];
	return `${[...header, ...marked].join("\n")}\n`;
};

/** Shift a novel-line map from 0-based file lines to the 1-based numbering anchors use. */
const oneBased = (
	map: Map<number, SemanticEmphasisRange[]>,
): Map<number, SemanticEmphasisRange[]> =>
	new Map([...map.entries()].map(([line, ranges]) => [line + 1, ranges]));

async function blobLines(run: SemanticRun, hash: string | null): Promise<string[]> {
	if (!hash) return [];
	try {
		return splitLines(await readFile(join(run.directory, "blobs", hash), "utf8"));
	} catch (error) {
		throw new SemanticDiffError(
			`Semantic diff unavailable: could not read pinned blob ${JSON.stringify(hash)} (${terminalSafe(error instanceof Error ? error.message : String(error))}).`,
		);
	}
}

const parseReport = (file: RunFile, version: string, stdout: string): FileReport => {
	let value: unknown;
	try {
		value = JSON.parse(stdout);
	} catch {
		throw new SemanticDiffError(
			`Semantic diff unavailable: ${version} did not produce JSON for ${JSON.stringify(file.path)}. Patch view remains active.`,
		);
	}
	const parsed = fileReportSchema.safeParse(value);
	if (!parsed.success) {
		throw new SemanticDiffError(
			`Semantic diff unavailable: ${version} produced an unsupported JSON layout for ${JSON.stringify(file.path)}. Patch view remains active.`,
		);
	}
	return parsed.data;
};

function changedFileDiff(
	file: RunFile,
	report: FileReport,
	oldLines: string[],
	newLines: string[],
): SemanticFileDiff {
	const novel = novelLines(report, oldLines, newLines);
	const pairs = displayablePairs(report, oldLines, newLines);
	const changed = pairs.map((pair) => pairIsChanged(pair, novel));
	const patch = synthesisedPatch(file, pairs, changed, oldLines, newLines);
	return {
		path: file.path,
		patch,
		notes: patch
			? []
			: [statusHeader(file), "Difftastic found only whitespace or formatting differences."],
		emphasis: {
			deletions: oneBased(novel.deletions),
			additions: oneBased(novel.additions),
		},
	};
}

function reportedFileDiff(
	file: RunFile,
	report: FileReport,
	oldLines: string[],
	newLines: string[],
): SemanticFileDiff {
	if (report.status === "changed") return changedFileDiff(file, report, oldLines, newLines);
	if (report.status === "created" || report.status === "deleted") {
		const lines = report.status === "created" ? newLines : oldLines;
		const patch = wholeFilePatch(file, lines, report.status);
		return {
			path: file.path,
			patch,
			notes: patch ? [] : [statusHeader(file), "The pinned snapshot is empty."],
			emphasis: emptyEmphasis(),
		};
	}
	return {
		path: file.path,
		patch: null,
		notes: [statusHeader(file), "Difftastic found no semantic content changes."],
		emphasis: emptyEmphasis(),
	};
}

const semanticArgs = (run: SemanticRun, file: RunFile, emptyPath: string): string[] => [
	"--display=json",
	"--",
	file.path,
	file.oldBlob ? join(run.directory, "blobs", file.oldBlob) : emptyPath,
	file.oldBlob ?? "0000000",
	file.oldMode ?? "000000",
	file.newBlob ? join(run.directory, "blobs", file.newBlob) : emptyPath,
	file.newBlob ?? "0000000",
	file.newMode ?? "000000",
];

/**
 * Run Difftastic only against the verified blob files inside a prepared run.
 * No repository path or current Git state is consulted.
 */
export async function generateSemanticDiff(
	run: SemanticRun,
	executable = "difft",
): Promise<SemanticDiffResult> {
	const version = await detectDifftastic(executable);
	const temporary = await mkdtemp(join(tmpdir(), "revue-semantic-"));
	const emptyPath = join(temporary, "empty");
	await writeFile(emptyPath, new Uint8Array());

	try {
		const files: SemanticFileDiff[] = [];
		for (const file of run.manifest.files) {
			const notes = metadataOnlyNotes(file);
			if (notes) {
				files.push({ path: file.path, patch: null, notes, emphasis: emptyEmphasis() });
				continue;
			}
			const result = await runProcess(executable, semanticArgs(run, file, emptyPath));
			if (result.exitCode !== 0) {
				throw new SemanticDiffError(
					`Semantic diff unavailable: ${version} failed while comparing ${JSON.stringify(file.path)}${describeProcessFailure(result)}. Patch view remains active.`,
				);
			}
			const report = parseReport(file, version, result.stdout);
			const [oldLines, newLines] = await Promise.all([
				blobLines(run, file.oldBlob),
				blobLines(run, file.newBlob),
			]);
			files.push(reportedFileDiff(file, report, oldLines, newLines));
		}
		return { files, version };
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}
