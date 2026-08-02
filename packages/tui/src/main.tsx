#!/usr/bin/env bun
import { writeFile } from "node:fs/promises";
import {
	formatMarkdownReview,
	MarkdownExportError,
	type MarkdownExportSelection,
} from "@revue/markdown-export";
import {
	GitError,
	PrepArgumentError,
	type PreparedRun,
	PrepError,
	prepareRun,
	ReviewCoverageError,
	RunArtifactError,
} from "@revue/prep";
import { RUN_EXCLUSION_REASON } from "@revue/types";
import { ChaptersFileError, loadReviewRun } from "./load.ts";
import { formatSummary } from "./summary.ts";
import { defaultStatePath, loadViewState, runKey } from "./viewState.ts";

const HELP = `revue — narrative code review in your terminal

Usage:
  revue prep [refs] [--base <ref>] [--compare <ref>] [--ref <mode>]
             [--ignore <pattern>]... [--show-ignored]
  revue show <run-directory>           open a prepared run in the interactive TUI
  revue show <run-directory> --check   validate a prepared run and print a summary
  revue export <run-directory>         export the full ordered review as Markdown

Prep modes: committed, staged, unstaged, work. Without explicit scope, prep reviews local
working-tree changes when present and otherwise compares HEAD with the detected main/master base.
The revue-chapters skill reads hunks.txt and writes chapters.json inside the printed run directory.
`;

const SHOW_HELP = `usage: revue show <run-directory> [--check]`;
const EXPORT_HELP = `usage: revue export <run-directory>
                     [--prologue | --chapter-id <id> | --chapter-order <number>]
                     [--output <path>]`;
const PREP_HELP = `usage: revue prep [main | main feature | main..feature | main...feature]
                  [--base <ref>] [--compare <ref>]
                  [--ref committed|staged|unstaged|work]
                  [--ignore <gitignore-pattern>]... [--show-ignored]`;

const prepSummary = (run: PreparedRun): string => {
	const { manifest } = run;
	const scope = manifest.scope;
	return [
		`Prepared ${scope.mode} run ${manifest.runId.slice(0, 12)}`,
		`base  ${scope.base.ref} ${scope.base.sha}`,
		`head  ${scope.head.ref} ${scope.head.sha}`,
		`scope ${scope.comparison} ${scope.oldEndpoint.kind}:${scope.oldEndpoint.revision} → ${scope.newEndpoint.kind}:${scope.newEndpoint.revision}`,
		`${manifest.totals.files} files, ${manifest.totals.reviewUnits} review units, +${manifest.totals.additions} -${manifest.totals.deletions}, ${manifest.totals.excluded} omitted`,
	].join("\n");
};

const exclusionSource = (reason: string): string => {
	if (reason === RUN_EXCLUSION_REASON.REVUE_IGNORE) return ".revueignore";
	if (reason === RUN_EXCLUSION_REASON.SESSION_IGNORE) return "--ignore";
	return "built-in";
};

const ignoredDetails = (run: PreparedRun): string => {
	const persistent = run.manifest.ignore?.revueIgnore ?? [];
	const session = run.manifest.ignore?.session ?? [];
	const patterns = [
		...persistent.map((pattern) => `  .revueignore ${JSON.stringify(pattern)}`),
		...session.map((pattern) => `  --ignore     ${JSON.stringify(pattern)}`),
	];
	const exclusions = run.manifest.exclusions.map((exclusion) => {
		const matched =
			exclusion.matchedPath && exclusion.matchedPath !== exclusion.path
				? ` (matched ${JSON.stringify(exclusion.matchedPath)})`
				: "";
		return `  ${JSON.stringify(exclusion.path)}${matched}: ${exclusionSource(exclusion.reason)} ${JSON.stringify(exclusion.pattern)}`;
	});
	return [
		"Effective review ignore patterns (.revueignore, then --ignore):",
		...(patterns.length ? patterns : ["  (none)"]),
		"Omitted paths:",
		...(exclusions.length ? exclusions : ["  (none)"]),
	].join("\n");
};

async function cmdPrep(args: string[]): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		process.stdout.write(`${PREP_HELP}\n`);
		return 0;
	}
	try {
		const showIgnored = args.includes("--show-ignored");
		const prepArgs = args.filter((argument) => argument !== "--show-ignored");
		const run = await prepareRun(prepArgs);
		process.stderr.write(`${prepSummary(run)}\n`);
		if (showIgnored) process.stderr.write(`${ignoredDetails(run)}\n`);
		process.stdout.write(`${run.directory}\n`);
		return 0;
	} catch (error) {
		if (
			error instanceof PrepArgumentError ||
			error instanceof PrepError ||
			error instanceof GitError ||
			error instanceof RunArtifactError
		) {
			process.stderr.write(`${error.message}\n`);
			return 1;
		}
		throw error;
	}
}

interface ExportArguments {
	directory: string;
	selection: MarkdownExportSelection;
	output?: string;
}

function parseExportArguments(args: string[]): ExportArguments {
	const positionals: string[] = [];
	const selections: MarkdownExportSelection[] = [];
	let output: string | undefined;

	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === "--prologue") {
			selections.push({ kind: "prologue" });
			continue;
		}
		if (argument === "--chapter-id") {
			const id = args[++index];
			if (!id) throw new Error("--chapter-id requires a non-empty id");
			selections.push({ kind: "chapter-id", id });
			continue;
		}
		if (argument === "--chapter-order") {
			const raw = args[++index];
			const order = raw && /^[1-9]\d*$/.test(raw) ? Number(raw) : Number.NaN;
			if (!Number.isSafeInteger(order)) {
				throw new Error("--chapter-order requires a positive integer");
			}
			selections.push({ kind: "chapter-order", order });
			continue;
		}
		if (argument === "--output") {
			const path = args[++index];
			if (!path) throw new Error("--output requires a path");
			if (output !== undefined) throw new Error("--output may only be specified once");
			output = path;
			continue;
		}
		if (argument?.startsWith("-")) throw new Error(`unknown export option: ${argument}`);
		if (argument) positionals.push(argument);
	}

	if (selections.length > 1) {
		throw new Error("choose only one of --prologue, --chapter-id, or --chapter-order");
	}
	const directory = positionals[0];
	if (positionals.length !== 1 || !directory) throw new Error("export requires one run directory");
	return { directory, selection: selections[0] ?? { kind: "full" }, output };
}

async function cmdExport(args: string[]): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		process.stdout.write(`${EXPORT_HELP}\n`);
		return 0;
	}

	let parsed: ExportArguments;
	try {
		parsed = parseExportArguments(args);
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n${EXPORT_HELP}\n`,
		);
		return 1;
	}

	let run: Awaited<ReturnType<typeof loadReviewRun>>;
	try {
		run = await loadReviewRun(parsed.directory);
	} catch (error) {
		if (
			error instanceof ChaptersFileError ||
			error instanceof RunArtifactError ||
			error instanceof ReviewCoverageError
		) {
			process.stderr.write(`${error.message}\n`);
			return 1;
		}
		throw error;
	}

	const state = await loadViewState(defaultStatePath(), runKey(run.manifest.runId, run.chapters));
	let markdown: string;
	try {
		markdown = formatMarkdownReview(
			{
				runId: run.manifest.runId,
				files: run.manifest.files,
				chapters: run.chapters,
			},
			{ selection: parsed.selection, viewState: state },
		);
	} catch (error) {
		if (error instanceof MarkdownExportError) {
			process.stderr.write(`${error.message}\n`);
			return 1;
		}
		throw error;
	}

	if (!parsed.output) {
		process.stdout.write(markdown);
		return 0;
	}
	try {
		await writeFile(parsed.output, markdown, "utf8");
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		process.stderr.write(`Could not write Markdown export to ${parsed.output}: ${detail}\n`);
		return 1;
	}
	process.stderr.write(`Wrote Markdown export to ${parsed.output}\n`);
	return 0;
}

async function cmdShow(args: string[]): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		process.stdout.write(`${SHOW_HELP}\n`);
		return 0;
	}
	const unknownOption = args.find((argument) => argument.startsWith("-") && argument !== "--check");
	const positionals = args.filter((argument) => !argument.startsWith("-"));
	const directory = positionals[0];
	if (unknownOption || positionals.length !== 1 || !directory) {
		process.stderr.write(
			`${unknownOption ? `unknown show option: ${unknownOption}\n` : ""}${SHOW_HELP}\n`,
		);
		return 1;
	}

	let run: Awaited<ReturnType<typeof loadReviewRun>>;
	try {
		run = await loadReviewRun(directory);
	} catch (error) {
		if (
			error instanceof ChaptersFileError ||
			error instanceof RunArtifactError ||
			error instanceof ReviewCoverageError
		) {
			process.stderr.write(`${error.message}\n`);
			return 1;
		}
		throw error;
	}

	if (args.includes("--check") || !process.stdout.isTTY) {
		process.stdout.write(`${formatSummary(run.chapters)}\n`);
		return 0;
	}

	const [{ runApp }, { preparePatch }, { openFileStore }] = await Promise.all([
		import("./app.tsx"),
		import("./diff.ts"),
		import("./viewState.ts"),
	]);
	const diffFiles = await preparePatch(run.patch);
	const store = await openFileStore(defaultStatePath(), runKey(run.manifest.runId, run.chapters));
	await runApp(run.chapters, {
		diffFiles,
		initialViewState: store.get(),
		onViewStateChange: (next) => store.set(next),
	});
	return 0;
}

async function main(): Promise<number> {
	const [command, ...args] = process.argv.slice(2);
	if (command === "show") return cmdShow(args);
	if (command === "prep") return cmdPrep(args);
	if (command === "export") return cmdExport(args);
	if (!command || command === "-h" || command === "--help" || command === "help") {
		process.stdout.write(HELP);
		return 0;
	}
	process.stderr.write(`unknown command: ${command}\n\n${HELP}`);
	return 1;
}

main()
	.then((code) => {
		if (code !== 0) process.exit(code);
	})
	.catch((error) => {
		process.stderr.write(
			`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
		);
		process.exit(1);
	});
