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
import { isBundledShikiThemeId, resolveTheme, THEME_IDS } from "@revue/theme";
import {
	type ReviewThread,
	RUN_EXCLUSION_REASON,
	THREAD_AUTHOR_KIND,
	type ThreadAnchor,
	type ThreadAuthor,
} from "@revue/types";
import { runDoctor } from "./doctor.ts";
import { ChaptersFileError, loadReviewRun } from "./load.ts";
import { defaultPreferencesPath, loadPreferences, savePreferences } from "./preferences.ts";
import { installSkill, resolveSkillRunner, stampedSkill } from "./skill.ts";
import { permalinkContextFor } from "./sourceLink.ts";
import { formatSummary } from "./summary.ts";
import {
	createThread,
	defaultThreadsPath,
	loadValidatedThreads,
	openThreadStore,
	originRemoteUrl,
	repositoryRootForRun,
	resolveHumanAuthor,
	ThreadStoreError,
	validateThreadsForRun,
} from "./threads.ts";
import { REVUE_VERSION } from "./version.ts";
import { defaultStatePath, loadViewState, runKey } from "./viewState.ts";

const HELP = `revue — narrative code review in your terminal

Usage:
  revue prep [refs] [--base <ref>] [--compare <ref>] [--ref <mode>]
             [--ignore <pattern>]... [--show-ignored]
  revue show <run-directory>           open a prepared run in the interactive TUI
  revue show <run-directory> --check   validate a prepared run and print a summary
  revue export <run-directory>         export the full ordered review as Markdown
  revue threads <operation>            create, reply to, list, or update review threads
  revue comments <operation>           compatibility alias for revue threads
  revue skill install [--user]         install the bundled revue skill via the skills CLI
  revue skill print                    write the bundled skill to stdout for manual installation
  revue doctor                         check required and optional dependencies
  revue --version                      print the CLI version

Prep modes: committed, staged, unstaged, work. Without explicit scope, prep reviews local
working-tree changes when present and otherwise compares HEAD with the detected main/master base.
The revue skill reads hunks.txt and writes chapters.json inside the printed run directory.
`;

const SHOW_HELP = `usage: revue show <run-directory> [--check]
                   [--theme <name> | --theme auto | --theme list]
                   [--transparent-bg]`;
const EXPORT_HELP = `usage: revue export <run-directory>
                     [--prologue | --chapter-id <id> | --chapter-order <number>]
                     [--output <path>]`;
const THREADS_HELP = `usage: revue threads list <run-directory> --json [--all]
       revue threads create <run-directory> --file <path> --old-start <number>
                            --side additions|deletions --start-line <number> --end-line <number>
                            --author <agent-name> (--body <text> | --body-file <path|->)
       revue threads reply <run-directory> <thread-id> --author <agent-name>
                           (--body <text> | --body-file <path|->)
       revue threads delete <run-directory> <thread-id>
       revue threads delete-message <run-directory> <thread-id> <message-id>
       revue threads mark-dealt <run-directory> <thread-id>
       revue threads reopen <run-directory> <thread-id>`;
const PREP_HELP = `usage: revue prep [main | main feature | main..feature | main...feature]
                  [--base <ref>] [--compare <ref>]
                  [--pr <number | github-pull-request-url>]
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

type ExportArguments = {
	directory: string;
	selection: MarkdownExportSelection;
	output?: string;
};

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
			if (!id || id.startsWith("--")) {
				throw new Error("--chapter-id requires a non-empty id");
			}
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
			if (!path || path.startsWith("--")) throw new Error("--output requires a path");
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

	let threads: ReviewThread[];
	try {
		threads = loadValidatedThreads(defaultThreadsPath(parsed.directory), run);
	} catch (error) {
		if (error instanceof ThreadStoreError) {
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
			{ selection: parsed.selection, viewState: state, threads },
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

const entityIdPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CommandOptions = {
	positionals: string[];
	values: Map<string, string>;
	booleans: Set<string>;
};

const parseCommandOptions = (
	args: string[],
	valueNames: readonly string[],
	booleanNames: readonly string[] = [],
): CommandOptions => {
	const positionals: string[] = [];
	const values = new Map<string, string>();
	const booleans = new Set<string>();
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (!argument?.startsWith("-")) {
			if (argument) positionals.push(argument);
			continue;
		}
		if (booleanNames.includes(argument)) {
			if (booleans.has(argument)) throw new Error(`${argument} may only be specified once`);
			booleans.add(argument);
			continue;
		}
		if (!valueNames.includes(argument)) throw new Error(`unknown option: ${argument}`);
		if (values.has(argument)) throw new Error(`${argument} may only be specified once`);
		const value = args[++index];
		if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
		values.set(argument, value);
	}
	return { positionals, values, booleans };
};

const requiredOption = (options: CommandOptions, name: string): string => {
	const value = options.values.get(name);
	if (!value) throw new Error(`${name} is required`);
	return value;
};

const integerOption = (options: CommandOptions, name: string, allowZero = false): number => {
	const raw = requiredOption(options, name);
	const pattern = allowZero ? /^\d+$/ : /^[1-9]\d*$/;
	const value = pattern.test(raw) ? Number(raw) : Number.NaN;
	if (!Number.isSafeInteger(value)) {
		throw new Error(`${name} requires ${allowZero ? "a non-negative" : "a positive"} integer`);
	}
	return value;
};

const requireEntityId = (id: string | undefined, label: string): string => {
	if (!id || !entityIdPattern.test(id)) {
		throw new Error(`${label} ID must be a UUID, received ${JSON.stringify(id)}`);
	}
	return id;
};

const agentAuthor = (options: CommandOptions): ThreadAuthor => ({
	kind: THREAD_AUTHOR_KIND.AGENT,
	name: requiredOption(options, "--author"),
});

const threadBody = async (options: CommandOptions): Promise<string> => {
	const body = options.values.get("--body");
	const bodyFile = options.values.get("--body-file");
	if (Boolean(body) === Boolean(bodyFile)) {
		throw new Error("choose exactly one of --body or --body-file");
	}
	if (body !== undefined) return body;
	if (bodyFile === "-") return Bun.stdin.text();
	return Bun.file(bodyFile ?? "").text();
};

const loadThreadCommand = async (directory: string) => {
	const run = await loadReviewRun(directory);
	const path = defaultThreadsPath(directory);
	const threads = loadValidatedThreads(path, run);
	return { run, store: openThreadStore(path, run.manifest.runId), threads };
};

async function cmdThreads(args: string[], commandName = "threads"): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		process.stdout.write(`${THREADS_HELP}\n`);
		return 0;
	}
	const [operation, ...rest] = args;
	try {
		if (operation === "list") {
			const options = parseCommandOptions(rest, [], ["--json", "--all"]);
			const directory = options.positionals[0];
			if (!directory || options.positionals.length !== 1) {
				throw new Error(`${commandName} list requires one run directory`);
			}
			if (!options.booleans.has("--json")) throw new Error(`${commandName} list requires --json`);
			const { run, threads } = await loadThreadCommand(directory);
			const selected = threads.filter(
				(thread) => options.booleans.has("--all") || thread.status === "open",
			);
			process.stdout.write(
				`${JSON.stringify({ runId: run.manifest.runId, threads: selected }, null, 2)}\n`,
			);
			return 0;
		}
		if (operation === "create") {
			const options = parseCommandOptions(rest, [
				"--file",
				"--old-start",
				"--side",
				"--start-line",
				"--end-line",
				"--author",
				"--body",
				"--body-file",
			]);
			const directory = options.positionals[0];
			if (!directory || options.positionals.length !== 1) {
				throw new Error(`${commandName} create requires one run directory`);
			}
			const side = requiredOption(options, "--side");
			if (side !== "additions" && side !== "deletions") {
				throw new Error("--side must be additions or deletions");
			}
			const anchor: ThreadAnchor = {
				filePath: requiredOption(options, "--file"),
				oldStart: integerOption(options, "--old-start", true),
				side,
				startLine: integerOption(options, "--start-line"),
				endLine: integerOption(options, "--end-line"),
			};
			const author = agentAuthor(options);
			const body = await threadBody(options);
			const { run, store } = await loadThreadCommand(directory);
			const candidate = createThread(run.manifest.runId, anchor, author, body);
			validateThreadsForRun(run, [candidate]);
			const root = candidate.messages[0];
			if (!root) throw new ThreadStoreError("A new thread requires a root message");
			const thread = store.create(anchor, author, body, {
				id: candidate.id,
				messageId: root.id,
				createdAt: candidate.createdAt,
			});
			process.stdout.write(`${JSON.stringify({ action: operation, thread }, null, 2)}\n`);
			return 0;
		}
		if (operation === "reply") {
			const options = parseCommandOptions(rest, ["--author", "--body", "--body-file"]);
			const [directory, rawThreadId] = options.positionals;
			if (!directory || options.positionals.length !== 2) {
				throw new Error(`${commandName} reply requires a run directory and thread ID`);
			}
			const threadId = requireEntityId(rawThreadId, "Thread");
			const { store } = await loadThreadCommand(directory);
			const thread = store.reply(threadId, agentAuthor(options), await threadBody(options));
			process.stdout.write(`${JSON.stringify({ action: operation, thread }, null, 2)}\n`);
			return 0;
		}
		if (operation === "delete-message") {
			const options = parseCommandOptions(rest, []);
			const [directory, rawThreadId, rawMessageId] = options.positionals;
			if (!directory || options.positionals.length !== 3) {
				throw new Error(`${commandName} delete-message requires run, thread, and message IDs`);
			}
			const threadId = requireEntityId(rawThreadId, "Thread");
			const messageId = requireEntityId(rawMessageId, "Message");
			const { store } = await loadThreadCommand(directory);
			const message = store.deleteMessage(threadId, messageId);
			process.stdout.write(`${JSON.stringify({ action: operation, message }, null, 2)}\n`);
			return 0;
		}
		if (["delete", "mark-dealt", "reopen"].includes(operation ?? "")) {
			const options = parseCommandOptions(rest, []);
			const [directory, rawThreadId] = options.positionals;
			if (!directory || options.positionals.length !== 2) {
				throw new Error(`${commandName} ${operation} requires a run directory and thread ID`);
			}
			const threadId = requireEntityId(rawThreadId, "Thread");
			const { store } = await loadThreadCommand(directory);
			const thread =
				operation === "delete"
					? store.delete(threadId)
					: operation === "mark-dealt"
						? store.markDealt(threadId)
						: store.reopen(threadId);
			process.stdout.write(`${JSON.stringify({ action: operation, thread }, null, 2)}\n`);
			return 0;
		}
		throw new Error(
			operation ? `unknown ${commandName} operation: ${operation}` : "missing operation",
		);
	} catch (error) {
		if (
			error instanceof ChaptersFileError ||
			error instanceof RunArtifactError ||
			error instanceof ReviewCoverageError ||
			error instanceof ThreadStoreError ||
			error instanceof Error
		) {
			process.stderr.write(`${error.message}\n${THREADS_HELP}\n`);
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
	let options: CommandOptions;
	try {
		options = parseCommandOptions(args, ["--theme"], ["--check", "--transparent-bg"]);
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n${SHOW_HELP}\n`,
		);
		return 1;
	}
	const requestedTheme = options.values.get("--theme");
	if (requestedTheme === "list") {
		process.stdout.write(`${THEME_IDS.join("\n")}\n`);
		return 0;
	}
	if (requestedTheme && requestedTheme !== "auto" && !isBundledShikiThemeId(requestedTheme)) {
		process.stderr.write(
			`unknown theme: ${requestedTheme}\nRun \`revue show <run-directory> --theme list\` for the available names.\n`,
		);
		return 1;
	}
	const directory = options.positionals[0];
	if (options.positionals.length !== 1 || !directory) {
		process.stderr.write(`${SHOW_HELP}\n`);
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

	let threads: ReviewThread[];
	try {
		threads = loadValidatedThreads(defaultThreadsPath(directory), run);
	} catch (error) {
		if (error instanceof ThreadStoreError) {
			process.stderr.write(`${error.message}\n`);
			return 1;
		}
		throw error;
	}

	if (options.booleans.has("--check") || !process.stdout.isTTY) {
		process.stdout.write(`${formatSummary(run.chapters)}\n`);
		return 0;
	}

	const preferencesPath = defaultPreferencesPath();
	const preferences = await loadPreferences(preferencesPath);
	const themeId = requestedTheme ?? preferences.themeId;
	const transparentSurfaces =
		options.booleans.has("--transparent-bg") || preferences.transparentBackground === true;
	// The terminal has not reported its own background yet, so highlight against the theme the
	// reviewer named; `runApp` re-prepares if detection lands somewhere else.
	const startupTheme = resolveTheme(themeId, null);

	const [{ runApp }, { preparePatch }, { generateSemanticDiff }, { openFileStore }] =
		await Promise.all([
			import("./app.tsx"),
			import("./diff.ts"),
			import("./semantic.ts"),
			import("./viewState.ts"),
		]);
	const diffFiles = await preparePatch(run.patch, startupTheme.syntaxTheme);
	const store = await openFileStore(defaultStatePath(), runKey(run.manifest.runId, run.chapters));
	const threadStore = openThreadStore(defaultThreadsPath(directory), run.manifest.runId);
	const repositoryRoot = repositoryRootForRun(directory);
	const humanAuthor = resolveHumanAuthor(repositoryRoot);
	await runApp(run.chapters, {
		diffFiles,
		loadSemanticDiff: () => generateSemanticDiff(run),
		initialViewState: store.get(),
		resolveInitialTheme: (appearance) => resolveTheme(themeId, appearance),
		initialSyntaxTheme: startupTheme.syntaxTheme,
		transparentSurfaces,
		onThemeChange: (next) => savePreferences(preferencesPath, { ...preferences, themeId: next.id }),
		initialThreads: threads,
		threadActions: threadStore,
		humanAuthor,
		permalinks: permalinkContextFor({
			scope: run.manifest.scope,
			remoteUrl: originRemoteUrl(repositoryRoot),
		}),
		onViewStateChange: (next) => store.set(next),
	});
	return 0;
}

const SKILL_HELP = `usage: revue skill install [--user]
       revue skill print

install  hand the bundled revue skill, stamped with this CLI's version, to the
         open skills CLI (vercel-labs/skills), which detects the coding agents on this
         machine and installs it for each; --user targets user-level skill directories
print    write the stamped skill to stdout for manual installation`;

const NO_RUNNER_INSTRUCTIONS = `No package runner found for the skills CLI (looked for npx, pnpm, bunx, and yarn).
Either install one and re-run \`revue skill install\`, or place the skill manually:
  mkdir -p .claude/skills/revue
  revue skill print > .claude/skills/revue/SKILL.md
That path serves Claude Code at project scope; other agents read different skill
directories — see https://github.com/vercel-labs/skills for the full list.`;

async function cmdSkill(args: string[]): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		process.stdout.write(`${SKILL_HELP}\n`);
		return 0;
	}
	const [operation, ...rest] = args;
	try {
		if (operation === "print") {
			if (rest.length > 0) throw new Error("skill print takes no arguments");
			process.stdout.write(stampedSkill());
			return 0;
		}
		if (operation !== "install") {
			throw new Error(operation ? `unknown skill operation: ${operation}` : "missing operation");
		}
		const options = parseCommandOptions(rest, [], ["--user"]);
		if (options.positionals.length > 0) {
			throw new Error("skill install takes no positional arguments");
		}
		const runner = resolveSkillRunner();
		if (!runner) {
			process.stderr.write(`${NO_RUNNER_INSTRUCTIONS}\n`);
			return 1;
		}
		process.stderr.write(
			`Handing the revue skill (${REVUE_VERSION}) to the skills CLI via ${runner.label}…\n`,
		);
		return await installSkill(options.booleans.has("--user") ? "user" : "project", runner);
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n${SKILL_HELP}\n`,
		);
		return 1;
	}
}

function cmdDoctor(): number {
	const report = runDoctor();
	process.stdout.write(`${report.lines.join("\n")}\n`);
	return report.healthy ? 0 : 1;
}

async function main(): Promise<number> {
	const [command, ...args] = process.argv.slice(2);
	if (command === "--version" || command === "-v") {
		process.stdout.write(`revue ${REVUE_VERSION}\n`);
		return 0;
	}
	if (command === "show") return cmdShow(args);
	if (command === "prep") return cmdPrep(args);
	if (command === "export") return cmdExport(args);
	if (command === "threads") return cmdThreads(args);
	if (command === "comments") return cmdThreads(args, "comments");
	if (command === "skill") return cmdSkill(args);
	if (command === "doctor") return cmdDoctor();
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
