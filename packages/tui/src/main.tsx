#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	AgentOriginError,
	defaultRunsDirectory,
	findGitContext,
	freezeRunContext,
	GitError,
	handoffPath,
	loadPreparedRun,
	loadRunDelta,
	PrepArgumentError,
	type PreparedRun,
	PrepError,
	prepareRun,
	ReviewCoverageError,
	RunArtifactError,
	readHandoff,
	recordAgentOrigin,
	rerunArgsFor,
} from "@revue/prep";
import {
	followsTerminal,
	isBundledShikiThemeId,
	resolveThemeChoice,
	type Theme,
	type ThemeChoice,
} from "@revue/theme";
import {
	excerptRangeLabel,
	isEpilogue,
	type ReviewThread,
	RUN_EXCLUSION_REASON,
	type RunDeltaFile,
	THREAD_ANCHOR_KIND,
	THREAD_AUTHOR_KIND,
	type ThreadAnchor,
	type ThreadAuthor,
	type ViewState,
} from "@revue/types";
import type { ReviewUpdate } from "./app.tsx";
import { runDoctor } from "./doctor.ts";
import { splitFileLines } from "./expand.ts";
import { createFeedbackController } from "./feedback.ts";
import { waitForHandoff } from "./handoffWait.ts";
import { createHostAdapter } from "./host.ts";
import { defaultKeybindingsPath, loadEffectiveKeymap } from "./keybindings.ts";
import { formatKeybindingsListing, initKeybindingsFile } from "./keybindingsCli.ts";
import { KEYMAP } from "./keymap.ts";
import { ChaptersFileError, loadChaptersFile, loadReviewRun, type ReviewRun } from "./load.ts";
import { defaultPreferencesPath, loadPreferences, savePreferences } from "./preferences.ts";
import { installSkill, resolveSkillRunner, stampedSkill } from "./skill.ts";
import { permalinkContextFor } from "./sourceLink.ts";
import { formatStatus, readStatus } from "./status.ts";
import type { StatusNotice } from "./statusBar.tsx";
import { formatChapterlessSummary, formatSummary, omissionNotice } from "./summary.ts";
import {
	defaultThemesDir,
	loadCustomThemes,
	mergeCustomThemes,
	type ThemeIssue,
} from "./themes.ts";
import { formatThemesListing, initThemesFile, isValidThemeName } from "./themesCli.ts";
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
import {
	carryReviewProgress,
	defaultStatePath,
	epilogueSession,
	type ReviewSessionState,
	supersededProgress,
} from "./viewState.ts";
import { watchRun } from "./watch.ts";

const HELP = `revue — narrative code review in your terminal

Usage:
  revue                                review local changes as a plain diff, no narrative needed
  revue diff [refs] [prep options]     same, with an explicit review scope
  revue prep [refs] [--base <ref>] [--compare <ref>] [--ref <mode>]
             [--ignore <pattern>]... [--show-ignored]
             [--carry-from <run-id> | --no-carry]
  revue status [--json]                report the active run, its threads, and working-tree drift
  revue show <run-directory>           open a prepared run in the interactive TUI
  revue show <run-directory> --check   validate a prepared run and print a summary
  revue delta <run-directory>          print what a superseding run carried forward and still owes
  revue context freeze <run-directory> pin the code the narration quotes into context.json
  revue threads <operation>            create, reply to, list, or update review threads
  revue comments <operation>           compatibility alias for revue threads
  revue skill install [--user]         install the bundled revue skill via the skills CLI
  revue skill print                    write the bundled skill to stdout for manual installation
  revue keybindings                    list every action, its defaults, and its effective keys
  revue keybindings init [--force]     write a commented keybindings.json starter template
  revue themes                         list bundled and custom themes, marking overrides
  revue themes init <name> [--force]   write a commented themes/<name>.json starter template
  revue doctor                         check required and optional dependencies
  revue --version                      print the CLI version

Prep modes: committed, staged, unstaged, work. Without explicit scope, prep reviews local
working-tree changes when present and otherwise compares HEAD with the detected main/master base.
The revue skill reads hunks.txt and writes chapters.json inside the printed run directory;
runs without a chapters.json open as a flat file-by-file diff.
`;

const SHOW_HELP = `usage: revue show <run-directory> [--check]
                   [--theme <name> | --theme auto | --theme list]
                   [--theme-light <name>] [--theme-dark <name>]
                   [--transparent-bg]

By default Revue follows the terminal's own background, painting the
--theme-light or --theme-dark theme. --theme <name> pins one regardless.`;
const DIFF_HELP = `usage: revue diff [main | main feature | main..feature | main...feature]
                  [--base <ref>] [--compare <ref>]
                  [--pr <number | github-pull-request-url>]
                  [--ref committed|staged|unstaged|work]
                  [--ignore <gitignore-pattern>]...
                  [--theme <name> | --theme auto] [--transparent-bg]
                  [--theme-light <name>] [--theme-dark <name>]

Preps the requested scope and opens it immediately as a flat diff — no chapters required.
The run directory is printed to stderr so agents can target it with revue threads.`;
const THREADS_HELP = `usage: revue threads list <run-directory> --json [--all]
       revue threads create <run-directory> [--kind hunk] --file <path> --old-start <number>
                            --side additions|deletions --start-line <number> --end-line <number>
                            --author <agent-name> (--body <text> | --body-file <path|->)
       revue threads create <run-directory> --kind excerpt --file <path>
                            --start-line <number> --end-line <number>
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
                  [--ignore <gitignore-pattern>]... [--show-ignored]
                  [--carry-from <run-id> | --no-carry]

A new run records the most recent narrated run of the same scope in supersedes,
carries forward every chapter the change did not touch, and writes the worklist
for the rest to delta.json. --carry-from names that predecessor explicitly;
--no-carry starts a fresh review.`;

const DELTA_HELP = `usage: revue delta <run-directory>

Prints, as JSON, the worklist prep recorded when this run superseded a narrated one:

carried     chapters the change left alone, hunk references and key-change line
            ranges already re-mapped to this run — copy them into chapters.json
            verbatim and narrate around them
stale       chapters whose narration no longer describes the code, each with the
            reason it went stale; re-narrate them from this run's hunks.txt
unnarrated  every review unit no carried chapter covers, marked unchanged,
            modified, or new relative to the superseded run

Narration is complete once every unnarrated unit sits in a chapter; run
revue context freeze and then revue show <run-directory> --check to confirm it.`;

/** Distinct from every other exit code the CLI uses, so a caller can tell "timed out" apart. */
const STATUS_WAIT_TIMEOUT_EXIT_CODE = 3;
const STATUS_WAIT_DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

const STATUS_HELP = `usage: revue status [--json] [--wait [--since <handoffId>] [--timeout-ms <n>]]

Reads the repository's own review state off disk — nothing depends on an earlier session:

activeRun   the newest narrated run of the lineage, its directory, and the prep
            arguments that reproduce its scope
pendingRun  a newer run that supersedes it and is not narrated yet, with a count
            of what its delta carried, marked stale, and left to narrate
threads     the run's threads, open ones split into those awaiting the agent (a
            human spoke last) and those awaiting the reviewer (an agent did),
            plus the carried anchors this run orphaned
drift       whether re-prepping the active run's scope would capture different
            code than the run pinned

A repository with no prepared runs reports that and exits 0.

--wait          block until a handoff whose id differs from --since exists, then print the
                report as usual and exit 0. Without --since, waits for a handoff that differs
                from whichever one is on disk when the wait starts (or for any handoff at all
                if none is). Requires --wait; using it alone is a usage error.
--timeout-ms    how long to wait before giving up, default 900000 (15 minutes). A timeout
                prints a message to stderr and exits ${STATUS_WAIT_TIMEOUT_EXIT_CODE}.`;

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

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** What a superseding run inherited, so a prep that continues a review says so on the spot. */
const deltaSummary = (directory: string, delta: RunDeltaFile): string =>
	[
		`supersedes ${delta.supersedes.slice(0, 12)}`,
		`${plural(delta.carried.length, "chapter")} carried, ${plural(delta.stale.length, "chapter")} stale`,
		`${plural(delta.unnarrated.length, "review unit")} to narrate — revue delta ${directory}`,
	].join("\n");

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

/**
 * Records the agent's pane in `.revue/agent.json` once a top-level command has succeeded. Never
 * called from the prep library itself, so the TUI's reload path never records the reviewer's pane.
 * A write failure is a warning, not a command failure.
 */
const recordOrigin = (runDirectory: string, runId: string): void => {
	const repositoryRoot = repositoryRootForRun(runDirectory);
	if (!repositoryRoot) return;
	try {
		recordAgentOrigin({ repositoryRoot, runId });
	} catch (error) {
		if (error instanceof AgentOriginError) {
			process.stderr.write(`warning: ${error.message}\n`);
			return;
		}
		throw error;
	}
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
		recordOrigin(run.directory, run.manifest.runId);
		process.stderr.write(`${prepSummary(run)}\n`);
		const delta = await loadRunDelta(run);
		if (delta) process.stderr.write(`${deltaSummary(run.directory, delta)}\n`);
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

const CONTEXT_HELP = `usage: revue context freeze <run-directory>

freeze  resolve every excerpt citation in the run's chapters.json against the run's own
        recorded endpoint and pin the quoted lines into context.json beside it, so the
        reviewer reads code that came off disk rather than a transcription`;

async function cmdContext(args: string[]): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		process.stdout.write(`${CONTEXT_HELP}\n`);
		return 0;
	}
	const [operation, ...rest] = args;
	let directory: string | undefined;
	try {
		if (operation !== "freeze") {
			throw new Error(operation ? `unknown context operation: ${operation}` : "missing operation");
		}
		const options = parseCommandOptions(rest, []);
		directory = options.positionals[0];
		if (!directory || options.positionals.length !== 1) {
			throw new Error("context freeze requires one run directory");
		}
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n${CONTEXT_HELP}\n`,
		);
		return 1;
	}
	try {
		return await freezeContext(directory);
	} catch (error) {
		if (
			error instanceof ChaptersFileError ||
			error instanceof RunArtifactError ||
			error instanceof GitError
		) {
			process.stderr.write(`${error.message}\n`);
			return 1;
		}
		throw error;
	}
}

async function freezeContext(directory: string): Promise<number> {
	const run = await loadPreparedRun(directory);
	const chaptersPath = join(directory, "chapters.json");
	if (!existsSync(chaptersPath)) {
		throw new ChaptersFileError(
			`${chaptersPath} does not exist; narrate the run before freezing its context`,
		);
	}
	const { path, context, unverifiable } = await freezeRunContext(
		run,
		await loadChaptersFile(chaptersPath),
	);
	for (const cited of unverifiable) {
		process.stderr.write(
			`warning: ${JSON.stringify(cited)} is not part of this run, so its worktree content could not be checked against what prep captured\n`,
		);
	}
	if (context.unresolved.length) {
		for (const entry of context.unresolved) {
			process.stderr.write(
				`Could not freeze excerpt ${excerptRangeLabel(entry)}: ${entry.reason}\n`,
			);
		}
		return 1;
	}
	const { kind, revision } = context.source;
	const count = context.excerpts.length;
	process.stderr.write(
		`Froze ${count} excerpt${count === 1 ? "" : "s"} from ${kind}:${revision.slice(0, 12)}\n`,
	);
	process.stdout.write(`${path}\n`);
	return 0;
}

const missingDeltaReason = (run: PreparedRun): string =>
	run.manifest.supersedes
		? `This run supersedes ${run.manifest.supersedes.slice(0, 12)} but no delta was recorded for it.`
		: "This run starts a fresh review — it supersedes nothing, so there is nothing to carry forward.";

async function cmdDelta(args: string[]): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		process.stdout.write(`${DELTA_HELP}\n`);
		return 0;
	}
	let directory: string | undefined;
	try {
		const options = parseCommandOptions(args, []);
		directory = options.positionals[0];
		if (!directory || options.positionals.length !== 1) {
			throw new Error("delta requires one run directory");
		}
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n${DELTA_HELP}\n`,
		);
		return 1;
	}
	try {
		const run = await loadPreparedRun(directory);
		const delta = await loadRunDelta(run);
		if (!delta) {
			process.stderr.write(`${missingDeltaReason(run)}\n`);
			return 1;
		}
		process.stdout.write(`${JSON.stringify(delta, null, 2)}\n`);
		return 0;
	} catch (error) {
		if (error instanceof RunArtifactError) {
			process.stderr.write(`${error.message}\n`);
			return 1;
		}
		throw error;
	}
}

async function cmdStatus(args: string[]): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		process.stdout.write(`${STATUS_HELP}\n`);
		return 0;
	}
	let json = false;
	let wait = false;
	let since: string | undefined;
	let timeoutMs = STATUS_WAIT_DEFAULT_TIMEOUT_MS;
	try {
		const options = parseCommandOptions(args, ["--since", "--timeout-ms"], ["--json", "--wait"]);
		if (options.positionals.length) throw new Error("status takes no positional arguments");
		json = options.booleans.has("--json");
		wait = options.booleans.has("--wait");
		since = options.values.get("--since");
		if (options.values.has("--timeout-ms")) timeoutMs = integerOption(options, "--timeout-ms");
		if (since !== undefined && !wait) throw new Error("--since requires --wait");
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n${STATUS_HELP}\n`,
		);
		return 1;
	}
	try {
		if (wait) {
			const { root } = await findGitContext();
			const seen = since ?? readHandoff(root).record?.handoffId ?? null;
			const outcome = await waitForHandoff({ repositoryRoot: root, since: seen, timeoutMs });
			if (outcome.kind === "timeout") {
				process.stderr.write(`revue status --wait timed out after ${timeoutMs}ms\n`);
				return STATUS_WAIT_TIMEOUT_EXIT_CODE;
			}
		}
		const report = await readStatus();
		process.stdout.write(
			json ? `${JSON.stringify(report, null, 2)}\n` : `${formatStatus(report)}\n`,
		);
		return 0;
	} catch (error) {
		if (
			error instanceof ChaptersFileError ||
			error instanceof RunArtifactError ||
			error instanceof ReviewCoverageError ||
			error instanceof ThreadStoreError ||
			error instanceof GitError
		) {
			process.stderr.write(`${error.message}\n`);
			return 1;
		}
		throw error;
	}
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
	const { threads, orphaned } = loadValidatedThreads(path, run);
	return { run, store: openThreadStore(path, run.manifest.runId), threads, orphaned };
};

/**
 * The anchor a `threads create` invocation names. A hunk anchor pins a review unit and a side; an
 * excerpt anchor names quoted code, which has neither, so the two option sets are disjoint.
 */
const threadAnchorFrom = (options: CommandOptions): ThreadAnchor => {
	const kind = options.values.get("--kind") ?? THREAD_ANCHOR_KIND.HUNK;
	if (kind !== THREAD_ANCHOR_KIND.HUNK && kind !== THREAD_ANCHOR_KIND.EXCERPT) {
		throw new Error("--kind must be hunk or excerpt");
	}
	if (kind === THREAD_ANCHOR_KIND.EXCERPT) {
		for (const rejected of ["--old-start", "--side"]) {
			if (options.values.has(rejected)) {
				throw new Error(`${rejected} does not apply to an excerpt anchor`);
			}
		}
		return {
			kind,
			filePath: requiredOption(options, "--file"),
			startLine: integerOption(options, "--start-line"),
			endLine: integerOption(options, "--end-line"),
		};
	}
	const side = requiredOption(options, "--side");
	if (side !== "additions" && side !== "deletions") {
		throw new Error("--side must be additions or deletions");
	}
	return {
		kind,
		filePath: requiredOption(options, "--file"),
		oldStart: integerOption(options, "--old-start", true),
		side,
		startLine: integerOption(options, "--start-line"),
		endLine: integerOption(options, "--end-line"),
	};
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
			const { run, threads, orphaned } = await loadThreadCommand(directory);
			const selected = threads.filter(
				(thread) => options.booleans.has("--all") || thread.status === "open",
			);
			process.stdout.write(
				`${JSON.stringify(
					{
						runId: run.manifest.runId,
						threads: selected,
						orphaned: orphaned.map((entry) => ({ id: entry.thread.id, reason: entry.reason })),
					},
					null,
					2,
				)}\n`,
			);
			return 0;
		}
		if (operation === "create") {
			const options = parseCommandOptions(rest, [
				"--kind",
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
			const anchor = threadAnchorFrom(options);
			const author = agentAuthor(options);
			const body = await threadBody(options);
			const { run, store } = await loadThreadCommand(directory);
			const candidate = createThread(run.manifest.runId, anchor, author, body);
			const unanchored = validateThreadsForRun(run, [candidate])[0];
			if (unanchored) {
				throw new ThreadStoreError(`Cannot anchor a thread there: ${unanchored.reason}`);
			}
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
			const { run, store } = await loadThreadCommand(directory);
			const thread = store.reply(threadId, agentAuthor(options), await threadBody(options));
			recordOrigin(directory, run.manifest.runId);
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

type ThemeLoad = { customThemes: Theme[]; issues: ThemeIssue[] };

const UNKNOWN_THEME_HINT =
	"Run `revue show <run-directory> --theme list` or `revue themes` for details.";

/** The theme ids one invocation named, before they are known to exist. */
type RequestedThemes = {
	/** `--theme`: a pinned id, or `auto` to follow the terminal. */
	themeId?: string;
	/** `--theme-light` / `--theme-dark`: the halves the terminal chooses between. */
	lightThemeId?: string;
	darkThemeId?: string;
};

/** Which half of a theme choice each command-line option fills. */
const THEME_OPTION_SLOTS: Record<string, keyof RequestedThemes | undefined> = {
	"--theme": "themeId",
	"--theme-light": "lightThemeId",
	"--theme-dark": "darkThemeId",
};

/** The first requested id that names no theme. Only `--theme` may say `auto`; a half may not. */
const unknownThemeId = (requested: RequestedThemes, customThemes: readonly Theme[]) => {
	const known = (themeId: string) =>
		isBundledShikiThemeId(themeId) || customThemes.some((theme) => theme.id === themeId);
	const pinned = followsTerminal(requested.themeId) ? undefined : requested.themeId;
	return [pinned, requested.lightThemeId, requested.darkThemeId].find(
		(themeId) => themeId !== undefined && !known(themeId),
	);
};

/**
 * Loads custom themes (a cheap directory read) and validates every requested id against the
 * merged bundled/custom set before any run loading or git prep — so an unknown theme fails fast
 * rather than after paying for work whose result is about to be discarded.
 */
async function loadAndValidateTheme(
	requested: RequestedThemes,
): Promise<{ theme: ThemeLoad } | { error: string }> {
	const { themes: customThemes, issues } = await loadCustomThemes(defaultThemesDir());
	const unknown = unknownThemeId(requested, customThemes);
	if (unknown) return { error: `unknown theme: ${unknown}\n${UNKNOWN_THEME_HINT}\n` };
	return { theme: { customThemes, issues } };
}

async function cmdShow(args: string[]): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		process.stdout.write(`${SHOW_HELP}\n`);
		return 0;
	}
	let options: CommandOptions;
	try {
		options = parseCommandOptions(
			args,
			["--theme", "--theme-light", "--theme-dark"],
			["--check", "--transparent-bg"],
		);
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n${SHOW_HELP}\n`,
		);
		return 1;
	}
	const requestedTheme = options.values.get("--theme");
	if (requestedTheme === "list") {
		const { themes: customThemes } = await loadCustomThemes(defaultThemesDir());
		const ids = mergeCustomThemes(customThemes).themes.map((theme) => theme.id);
		process.stdout.write(`${ids.join("\n")}\n`);
		return 0;
	}
	const directory = options.positionals[0];
	if (options.positionals.length !== 1 || !directory) {
		process.stderr.write(`${SHOW_HELP}\n`);
		return 1;
	}
	const requestedThemes: RequestedThemes = {
		themeId: requestedTheme,
		lightThemeId: options.values.get("--theme-light"),
		darkThemeId: options.values.get("--theme-dark"),
	};
	const themeLoad = await loadAndValidateTheme(requestedThemes);
	if ("error" in themeLoad) {
		process.stderr.write(themeLoad.error);
		return 1;
	}
	return showRun(directory, {
		requestedThemes,
		check: options.booleans.has("--check"),
		transparentBg: options.booleans.has("--transparent-bg"),
		theme: themeLoad.theme,
	});
}

/** Re-preps the scope that produced `run`, or (a chapterless-only refresh, or a `--pr` run) just re-reads its directory. */
async function reprepForReload(
	run: Awaited<ReturnType<typeof loadReviewRun>>,
	currentDirectory: string,
	prepArgs: string[] | undefined,
): Promise<{ directory: string } | { notice: StatusNotice }> {
	const args = prepArgs ?? rerunArgsFor(run.manifest.scope, run.manifest.ignore);
	if (!args) return { directory: currentDirectory };
	try {
		const prepared = await prepareRun(args, repositoryRootForRun(currentDirectory) ?? undefined);
		return { directory: prepared.directory };
	} catch (error) {
		if (
			error instanceof PrepError ||
			error instanceof GitError ||
			error instanceof RunArtifactError
		) {
			return { notice: { text: error.message, tone: "error" } };
		}
		throw error;
	}
}

/**
 * The marks the reviewer keeps when they open the run that continues their review. The delta names
 * what came through the change untouched, so it decides this in place of the reload's file-snapshot
 * rule, which knows what code moved but not which narration was read.
 */
const supersededSeed = async (
	directory: string,
	run: Awaited<ReturnType<typeof loadReviewRun>>,
): Promise<ViewState | undefined> => {
	const root = repositoryRootForRun(directory);
	if (!run.delta || !run.chapters || !root) return undefined;
	return supersededProgress({
		statePath: defaultStatePath(),
		runsDirectory: defaultRunsDirectory(root),
		delta: run.delta,
		chapters: run.chapters,
	});
};

/** What the banner says the agent did: the chapters it had to re-narrate, and the account of why. */
const supersedeSummary = (run: ReviewRun): string => {
	const revised = run.delta?.stale.length ?? 0;
	return [
		`${revised} ${revised === 1 ? "chapter" : "chapters"} revised`,
		...(run.chapters?.chapters.some(isEpilogue) ? ["epilogue added"] : []),
	].join(", ");
};

/**
 * The bridge between the filesystem watcher and the open review: the watcher reports what changed,
 * this reads what it means. A superseding run is offered only once it loads cleanly — reload must
 * never land on a half-written run, and one still being written simply reports again on its next
 * event. Nothing here switches runs; that stays the reviewer's keypress.
 */
const watchForUpdates = (run: ReviewRun, directory: string) => {
	const threadsPath = defaultThreadsPath(directory);
	const root = repositoryRootForRun(directory);
	let listener: ((update: ReviewUpdate) => void) | null = null;
	let announced: ReviewUpdate | null = null;
	let superseding: { directory: string; run: ReviewRun } | null = null;

	const publish = (update: ReviewUpdate) => {
		if (listener) listener(update);
		else if (update.kind === "superseded") announced = update;
	};

	const publishThreads = () => {
		try {
			const { threads, orphaned } = loadValidatedThreads(threadsPath, run);
			publish({ kind: "threads", threads, orphaned: orphaned.map((entry) => entry.thread.id) });
		} catch {
			// A store caught mid-write, or one this run cannot answer for, leaves the review as it is.
		}
	};

	const adopt = async (candidate: string) => {
		if (superseding) return;
		const next = await loadReviewRun(candidate).catch(() => null);
		if (!next?.chapters) return;
		superseding = { directory: candidate, run: next };
		publish({ kind: "superseded", summary: supersedeSummary(next) });
	};

	const dispose = watchRun({
		threadsPath,
		runsDirectory: defaultRunsDirectory(root ?? process.cwd()),
		runId: run.manifest.runId,
		handoffPath: root ? handoffPath(root) : undefined,
		onEvent: (event) => {
			if (event.kind === "threads-changed") publishThreads();
			else if (event.kind === "handoff-changed") publish({ kind: "handoff" });
			else void adopt(event.directory);
		},
	});

	return {
		dispose,
		superseding: () => superseding,
		subscribe: (next: (update: ReviewUpdate) => void) => {
			listener = next;
			// The watcher's opening sweep can beat the render, so a banner raised then still lands.
			if (announced) next(announced);
			announced = null;
			return () => {
				listener = null;
			};
		},
	};
};

const reloadNotice = (
	previous: Awaited<ReturnType<typeof loadReviewRun>>,
	next: Awaited<ReturnType<typeof loadReviewRun>>,
): StatusNotice => {
	if (next.manifest.runId === previous.manifest.runId) {
		return { text: "Reloaded — no changes", tone: "success" };
	}
	if (previous.chapters && !next.chapters) {
		return { text: "Reloaded — diff changed, narration is stale", tone: "error" };
	}
	return { text: "Reloaded", tone: "success" };
};

async function showRun(
	directory: string,
	options: {
		requestedThemes?: RequestedThemes;
		check?: boolean;
		transparentBg?: boolean;
		theme: ThemeLoad;
		/** The prep args `cmdDiff` parsed to launch this review, reused verbatim on every reload. */
		prepArgs?: string[];
	},
): Promise<number> {
	const { customThemes, issues: themeIssues } = options.theme;

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

	if (options.check || !process.stdout.isTTY) {
		process.stdout.write(
			`${run.chapters ? formatSummary(run.chapters, run.manifest) : formatChapterlessSummary(run.manifest)}\n`,
		);
		return 0;
	}

	const preferencesPath = defaultPreferencesPath();
	const preferences = await loadPreferences(preferencesPath);
	const { keymap, issues: keymapIssues } = await loadEffectiveKeymap(defaultKeybindingsPath());
	const themeChoice: ThemeChoice = {
		themeId: options.requestedThemes?.themeId ?? preferences.themeId,
		lightThemeId: options.requestedThemes?.lightThemeId ?? preferences.lightThemeId,
		darkThemeId: options.requestedThemes?.darkThemeId ?? preferences.darkThemeId,
	};
	const transparentSurfaces = options.transparentBg || preferences.transparentBackground === true;
	// The terminal has not reported its own background yet, so highlight against the theme the
	// reviewer named; `runApp` re-prepares if detection lands somewhere else.
	const startupTheme = resolveThemeChoice(themeChoice, null, customThemes);

	const [{ runApp }, { preparePatch, prepareContextQuotations }, { openRunStateStore }] =
		await Promise.all([import("./app.tsx"), import("./diff.ts"), import("./viewState.ts")]);

	let currentDirectory = directory;
	let carriedSessionState: ReviewSessionState | undefined;
	let carriedProgress: ViewState | undefined;
	let notice: StatusNotice | undefined;

	for (;;) {
		let threads: ReviewThread[];
		let orphaned: string[];
		try {
			const loaded = loadValidatedThreads(defaultThreadsPath(currentDirectory), run);
			threads = loaded.threads;
			orphaned = loaded.orphaned.map((entry) => entry.thread.id);
		} catch (error) {
			if (error instanceof ThreadStoreError) {
				process.stderr.write(`${error.message}\n`);
				return 1;
			}
			throw error;
		}

		let syntaxWarning: string | undefined;
		const diffFiles = await preparePatch(run.patch, startupTheme.syntaxTheme, (warning) => {
			syntaxWarning = warning;
		});
		await prepareContextQuotations(run.context, startupTheme.syntaxTheme);
		const store = await openRunStateStore(
			defaultStatePath(),
			run.manifest.runId,
			run.chapters,
			(await supersededSeed(currentDirectory, run)) ?? carriedProgress,
		);
		carriedProgress = undefined;
		const threadStore = openThreadStore(defaultThreadsPath(currentDirectory), run.manifest.runId);
		const repositoryRoot = repositoryRootForRun(currentDirectory);
		const humanAuthor = resolveHumanAuthor(repositoryRoot);
		// The handoff is repository-local, so a run opened outside a checkout has nowhere to record
		// one and the Send action reports that there is nothing to send.
		const feedback = repositoryRoot
			? createFeedbackController({
					repositoryRoot,
					runId: run.manifest.runId,
					threads: () => threadStore.get(),
					host: createHostAdapter(),
				})
			: undefined;
		const readHandoffRecord = repositoryRoot ? () => readHandoff(repositoryRoot).record : undefined;
		const fileLineCache = new Map<string, Promise<string[] | null>>();
		const loadFileLines = (path: string): Promise<string[] | null> => {
			const cached = fileLineCache.get(path);
			if (cached) return cached;
			const entry = run.manifest.files.find((candidate) => candidate.path === path);
			const promise =
				entry?.newBlob && !entry.isBinary
					? readFile(join(currentDirectory, "blobs", entry.newBlob), "utf8")
							.then(splitFileLines)
							.catch(() => null)
					: Promise.resolve(null);
			fileLineCache.set(path, promise);
			return promise;
		};
		const storedSession = store.getSession();
		const hasSavedPosition = Object.keys(storedSession.pages).length > 0;
		const watched = watchForUpdates(run, currentDirectory);

		const outcome = await runApp(run.chapters, {
			context: run.context,
			omittedNotice: omissionNotice(run.manifest),
			diffFiles,
			syntaxWarning,
			initialNotice: notice,
			loadFileLines,
			repositoryRoot,
			initialViewState: store.get(),
			initialSessionState: hasSavedPosition ? storedSession : carriedSessionState,
			initialPreferences: preferences,
			keymap,
			keymapIssues,
			customThemes,
			themeIssues,
			initialThemeChoice: themeChoice,
			initialSyntaxTheme: startupTheme.syntaxTheme,
			transparentSurfaces,
			onPreferencesChange: (next) => savePreferences(preferencesPath, next),
			initialThreads: threads,
			initialOrphanedThreads: orphaned,
			subscribeUpdates: watched.subscribe,
			threadActions: threadStore,
			feedback,
			readHandoff: readHandoffRecord,
			humanAuthor,
			permalinks: permalinkContextFor({
				scope: run.manifest.scope,
				remoteUrl: originRemoteUrl(repositoryRoot),
			}),
			onViewStateChange: (next) => store.set(next),
			onSessionStateChange: (next) => {
				store.setSession(next);
				carriedSessionState = next;
			},
		});

		watched.dispose();
		if (outcome === "quit") return 0;

		// Reload follows the banner when one is up: the reviewer asked for the run that continues
		// their review, not for another prep of the scope it already replaced.
		const superseding = watched.superseding();
		if (superseding) {
			const supersededRun = run;
			currentDirectory = superseding.directory;
			run = superseding.run;
			carriedSessionState = epilogueSession(run.chapters) ?? carriedSessionState;
			notice = reloadNotice(supersededRun, run);
			continue;
		}

		const previous = { files: run.manifest.files, chapters: run.chapters, state: store.get() };
		const repreped = await reprepForReload(run, currentDirectory, options.prepArgs);
		if ("notice" in repreped) {
			notice = repreped.notice;
			continue;
		}
		currentDirectory = repreped.directory;

		const previousRun = run;
		try {
			run = await loadReviewRun(currentDirectory);
		} catch (error) {
			if (
				error instanceof ChaptersFileError ||
				error instanceof RunArtifactError ||
				error instanceof ReviewCoverageError
			) {
				notice = { text: error.message, tone: "error" };
				continue;
			}
			throw error;
		}
		if (run.manifest.runId !== previousRun.manifest.runId) {
			carriedProgress = carryReviewProgress({
				previous,
				next: { files: run.manifest.files, chapters: run.chapters },
			});
		}
		notice = reloadNotice(previousRun, run);
	}
}

async function cmdDiff(args: string[]): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		process.stdout.write(`${DIFF_HELP}\n`);
		return 0;
	}
	const prepArgs: string[] = [];
	const requestedThemes: RequestedThemes = {};
	let transparentBg = false;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		const slot = THEME_OPTION_SLOTS[argument ?? ""];
		if (slot) {
			const value = args[++index];
			if (!value || value.startsWith("--")) {
				process.stderr.write(`${argument} requires a value\n${DIFF_HELP}\n`);
				return 1;
			}
			requestedThemes[slot] = value;
		} else if (argument === "--transparent-bg") {
			transparentBg = true;
		} else if (argument !== undefined) {
			prepArgs.push(argument);
		}
	}
	const themeLoad = await loadAndValidateTheme(requestedThemes);
	if ("error" in themeLoad) {
		process.stderr.write(themeLoad.error);
		return 1;
	}
	let run: PreparedRun;
	try {
		run = await prepareRun(prepArgs);
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
	process.stderr.write(`${prepSummary(run)}\n${run.directory}\n`);
	return showRun(run.directory, {
		requestedThemes,
		transparentBg,
		theme: themeLoad.theme,
		prepArgs,
	});
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

const KEYBINDINGS_HELP = `usage: revue keybindings
       revue keybindings init [--force]

(no args)  list every action, its description, its default keys, and its
           effective keys — overrides and validation issues are flagged
init       write a commented ~/.revue/keybindings.json starter template;
           --force overwrites an existing file`;

async function cmdKeybindings(args: string[]): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		process.stdout.write(`${KEYBINDINGS_HELP}\n`);
		return 0;
	}
	const [operation, ...rest] = args;
	if (!operation) {
		const { keymap, issues } = await loadEffectiveKeymap(defaultKeybindingsPath());
		process.stdout.write(`${formatKeybindingsListing(KEYMAP, keymap, issues)}\n`);
		return 0;
	}
	if (operation !== "init") {
		process.stderr.write(`unknown keybindings operation: ${operation}\n${KEYBINDINGS_HELP}\n`);
		return 1;
	}
	let options: CommandOptions;
	try {
		options = parseCommandOptions(rest, [], ["--force"]);
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n${KEYBINDINGS_HELP}\n`,
		);
		return 1;
	}
	if (options.positionals.length > 0) {
		process.stderr.write(`keybindings init takes no positional arguments\n${KEYBINDINGS_HELP}\n`);
		return 1;
	}
	const path = defaultKeybindingsPath();
	try {
		const result = initKeybindingsFile(path, KEYMAP, options.booleans.has("--force"));
		if (!result.wrote) {
			process.stderr.write(`${path} already exists; pass --force to overwrite\n`);
			return 1;
		}
		process.stdout.write(`Wrote ${path}\n`);
		return 0;
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		process.stderr.write(`Could not write ${path}: ${detail}\n`);
		return 1;
	}
}

const THEMES_HELP = `usage: revue themes
       revue themes init <name> [--force]

(no args)  list bundled and custom themes grouped by appearance, marking
           custom and customised (shadowed bundled) ids, followed by any
           validation issues
init       write a commented ~/.revue/themes/<name>.json starter template;
           --force overwrites an existing file`;

async function cmdThemes(args: string[]): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		process.stdout.write(`${THEMES_HELP}\n`);
		return 0;
	}
	const [operation, ...rest] = args;
	if (!operation) {
		const { themes: customThemes, issues } = await loadCustomThemes(defaultThemesDir());
		process.stdout.write(`${formatThemesListing({ customThemes, issues })}\n`);
		return 0;
	}
	if (operation !== "init") {
		process.stderr.write(`unknown themes operation: ${operation}\n${THEMES_HELP}\n`);
		return 1;
	}
	let options: CommandOptions;
	try {
		options = parseCommandOptions(rest, [], ["--force"]);
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n${THEMES_HELP}\n`,
		);
		return 1;
	}
	const [name, ...extra] = options.positionals;
	if (!name || extra.length > 0) {
		process.stderr.write(`themes init takes exactly one <name> argument\n${THEMES_HELP}\n`);
		return 1;
	}
	if (!isValidThemeName(name)) {
		process.stderr.write(
			`invalid theme name "${name}": must not contain a path separator or start with a dot\n${THEMES_HELP}\n`,
		);
		return 1;
	}
	const path = join(defaultThemesDir(), `${name}.json`);
	try {
		const result = initThemesFile(path, name, options.booleans.has("--force"));
		if (!result.wrote) {
			process.stderr.write(`${path} already exists; pass --force to overwrite\n`);
			return 1;
		}
		process.stdout.write(`Wrote ${path}\n`);
		return 0;
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		process.stderr.write(`Could not write ${path}: ${detail}\n`);
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
	if (command === "diff") return cmdDiff(args);
	if (command === "prep") return cmdPrep(args);
	if (command === "context") return cmdContext(args);
	if (command === "delta") return cmdDelta(args);
	if (command === "status") return cmdStatus(args);
	if (command === "threads") return cmdThreads(args);
	if (command === "comments") return cmdThreads(args, "comments");
	if (command === "skill") return cmdSkill(args);
	if (command === "keybindings") return cmdKeybindings(args);
	if (command === "themes") return cmdThemes(args);
	if (command === "doctor") return cmdDoctor();
	if (!command) return cmdDiff([]);
	if (command === "-h" || command === "--help" || command === "help") {
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
