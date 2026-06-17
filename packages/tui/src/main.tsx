#!/usr/bin/env bun
import { ChaptersFileError, loadChaptersFile } from "./load.ts";
import { formatSummary } from "./summary.ts";

const HELP = `revue — narrative code review in your terminal

Usage:
  revue show <chapters.json>        render a chapters file in the interactive TUI
  revue show --check <chapters.json>  validate a chapters file and print a summary
  revue prep [git refs]             (planned) dump hunks for the chapter-generating skill

The chapters file is written by the revue-chapters skill. See examples/sample-chapters.json
for the shape, and skills/revue-chapters/SKILL.md for how an agent produces one.
`;

async function cmdShow(args: string[]): Promise<number> {
	const check = args.includes("--check");
	const diffPath = flagValue(args, "--diff");
	const positional = args.filter((a) => !a.startsWith("-"));
	const path = positional[0];
	if (!path) {
		process.stderr.write("usage: revue show <chapters.json> [--diff <patch>] [--check]\n");
		return 1;
	}

	let file: Awaited<ReturnType<typeof loadChaptersFile>>;
	try {
		file = await loadChaptersFile(path);
	} catch (err) {
		if (err instanceof ChaptersFileError) {
			process.stderr.write(`${err.message}\n`);
			return 1;
		}
		throw err;
	}

	// Non-interactive (CI, pipes) or --check: print a summary instead of booting the TUI.
	if (check || !process.stdout.isTTY) {
		process.stdout.write(`${formatSummary(file)}\n`);
		return 0;
	}

	const { runApp } = await import("./app.tsx");
	const diffFiles = diffPath ? await (await import("./diff.ts")).loadPatch(diffPath) : null;
	await runApp(file, diffFiles);
	return 0;
}

/** Read the value after a `--flag value` pair from argv, or undefined. */
function flagValue(args: string[], flag: string): string | undefined {
	const i = args.indexOf(flag);
	return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<number> {
	const [cmd, ...args] = process.argv.slice(2);
	switch (cmd) {
		case "show":
			return cmdShow(args);
		case "prep":
			process.stderr.write(
				"revue prep is not implemented yet.\n" +
					"For now, have the revue-chapters skill write a chapters file by hand and run\n" +
					"`revue show <file>`. See examples/sample-chapters.json.\n",
			);
			return 2;
		case undefined:
		case "-h":
		case "--help":
		case "help":
			process.stdout.write(HELP);
			return 0;
		default:
			process.stderr.write(`unknown command: ${cmd}\n\n${HELP}`);
			return 1;
	}
}

main()
	.then((code) => {
		if (code !== 0) process.exit(code);
	})
	.catch((err) => {
		process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
		process.exit(1);
	});
