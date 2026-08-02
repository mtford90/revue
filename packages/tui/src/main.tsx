#!/usr/bin/env bun
import {
	GitError,
	PrepArgumentError,
	type PreparedRun,
	PrepError,
	prepareRun,
	ReviewCoverageError,
	RunArtifactError,
} from "@revue/prep";
import { ChaptersFileError, loadReviewRun } from "./load.ts";
import { formatSummary } from "./summary.ts";

const HELP = `revue — narrative code review in your terminal

Usage:
  revue prep [refs] [--base <ref>] [--compare <ref>] [--ref <mode>]
  revue show <run-directory>           open a prepared run in the interactive TUI
  revue show <run-directory> --check   validate a prepared run and print a summary

Prep modes: committed, staged, unstaged, work. Without explicit scope, prep reviews local
working-tree changes when present and otherwise compares HEAD with the detected main/master base.
The revue-chapters skill reads hunks.txt and writes chapters.json inside the printed run directory.
`;

const SHOW_HELP = `usage: revue show <run-directory> [--check]`;
const PREP_HELP = `usage: revue prep [main | main feature | main..feature | main...feature]
                  [--base <ref>] [--compare <ref>]
                  [--ref committed|staged|unstaged|work]`;

const prepSummary = (run: PreparedRun): string => {
	const { manifest } = run;
	const scope = manifest.scope;
	return [
		`Prepared ${scope.mode} run ${manifest.runId.slice(0, 12)}`,
		`base  ${scope.base.ref} ${scope.base.sha}`,
		`head  ${scope.head.ref} ${scope.head.sha}`,
		`scope ${scope.comparison} ${scope.oldEndpoint.kind}:${scope.oldEndpoint.revision} → ${scope.newEndpoint.kind}:${scope.newEndpoint.revision}`,
		`${manifest.totals.files} files, ${manifest.totals.reviewUnits} review units, +${manifest.totals.additions} -${manifest.totals.deletions}, ${manifest.totals.excluded} excluded`,
	].join("\n");
};

async function cmdPrep(args: string[]): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		process.stdout.write(`${PREP_HELP}\n`);
		return 0;
	}
	try {
		const run = await prepareRun(args);
		process.stderr.write(`${prepSummary(run)}\n`);
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

	const [{ runApp }, { preparePatch }, { defaultStatePath, openFileStore, runKey }] =
		await Promise.all([import("./app.tsx"), import("./diff.ts"), import("./viewState.ts")]);
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
