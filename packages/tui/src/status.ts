import {
	defaultRunsDirectory,
	findGitContext,
	GitError,
	loadRunDelta,
	PrepArgumentError,
	PrepError,
	previewRunId,
	type RunRecord,
	readRunRecords,
	rerunArgsFor,
	threadStorePath,
} from "@revue/prep";
import {
	type ReviewThread,
	type RunManifest,
	THREAD_AUTHOR_KIND,
	THREAD_STATUS,
	type ThreadAuthor,
} from "@revue/types";
import { loadReviewRun } from "./load.ts";
import { loadValidatedThreads } from "./threads.ts";

// Orientation is a cold-start problem: a fresh agent session has no memory of which run it was
// reviewing, so everything here is read back off disk rather than carried in conversation.

export type RunStatus = {
	runId: string;
	directory: string;
	createdAt: string;
	narrated: boolean;
	supersedes: string | null;
	scope: {
		mode: RunManifest["scope"]["mode"];
		comparison: RunManifest["scope"]["comparison"];
		base: string;
		head: string;
		/** The prep arguments that reproduce this scope, or null for a run that cannot re-prep. */
		prepArgs: string[] | null;
	};
};

/** A run prepped after the narrated one, still owing the narration named in its delta. */
export type PendingRunStatus = RunStatus & {
	delta: { carried: number; stale: number; unnarrated: number } | null;
};

export type ThreadStatus = {
	runId: string | null;
	open: number;
	/** Open threads whose last word came from a human: the agent owes a reply or a fix. */
	awaitingAgent: number;
	/** Open threads whose last word came from an agent: the reviewer owes a verdict. */
	awaitingHuman: number;
	dealtWith: number;
	orphaned: number;
};

/** Whether the reviewed scope has moved since it was prepped; `changed` is null when unknowable. */
export type DriftStatus = { since: string; changed: boolean | null; reason?: string };

export type StatusReport = {
	repositoryRoot: string;
	activeRun: RunStatus | null;
	pendingRun: PendingRunStatus | null;
	threads: ThreadStatus;
	drift: DriftStatus | null;
};

const EMPTY_THREADS: ThreadStatus = {
	runId: null,
	open: 0,
	awaitingAgent: 0,
	awaitingHuman: 0,
	dealtWith: 0,
	orphaned: 0,
};

const runStatus = ({ directory, manifest, narrated }: RunRecord): RunStatus => ({
	runId: manifest.runId,
	directory,
	createdAt: manifest.createdAt,
	narrated,
	supersedes: manifest.supersedes ?? null,
	scope: {
		mode: manifest.scope.mode,
		comparison: manifest.scope.comparison,
		base: manifest.scope.base.ref,
		head: manifest.scope.head.ref,
		prepArgs: rerunArgsFor(manifest.scope, manifest.ignore),
	},
});

const lastAuthorKind = (thread: ReviewThread): ThreadAuthor["kind"] | undefined =>
	thread.messages.at(-1)?.author.kind;

const threadStatus = (
	runId: string,
	threads: readonly ReviewThread[],
	orphaned: number,
): ThreadStatus => {
	const open = threads.filter((thread) => thread.status === THREAD_STATUS.OPEN);
	return {
		runId,
		open: open.length,
		awaitingAgent: open.filter((thread) => lastAuthorKind(thread) === THREAD_AUTHOR_KIND.HUMAN)
			.length,
		awaitingHuman: open.filter((thread) => lastAuthorKind(thread) === THREAD_AUTHOR_KIND.AGENT)
			.length,
		dealtWith: threads.length - open.length,
		orphaned,
	};
};

/**
 * Drift is asked of the run id rather than of Git: run ids are content addresses, so the scope has
 * moved exactly when re-prepping it now would produce a different run.
 */
const driftStatus = async (record: RunRecord, repositoryRoot: string): Promise<DriftStatus> => {
	const since = record.manifest.runId;
	const args = rerunArgsFor(record.manifest.scope, record.manifest.ignore);
	if (!args) {
		return { since, changed: null, reason: "this run's scope cannot be re-prepped" };
	}
	try {
		return { since, changed: (await previewRunId(args, repositoryRoot)) !== since };
	} catch (error) {
		if (error instanceof PrepError) return { since, changed: true, reason: error.message };
		if (error instanceof GitError || error instanceof PrepArgumentError) {
			return { since, changed: null, reason: error.message };
		}
		throw error;
	}
};

export async function readStatus(directory?: string): Promise<StatusReport> {
	const { root } = await findGitContext(directory);
	const records = await readRunRecords(defaultRunsDirectory(root));
	const newest = records[0];
	const active = records.find((record) => record.narrated) ?? null;
	const pending = newest && !newest.narrated ? newest : null;
	const reference = pending ?? active;
	const empty = { repositoryRoot: root, activeRun: null, pendingRun: null };
	if (!reference) return { ...empty, threads: EMPTY_THREADS, drift: null };

	const run = await loadReviewRun(reference.directory);
	const { threads, orphaned } = loadValidatedThreads(threadStorePath(root), run);
	const delta = pending ? await loadRunDelta(run) : null;
	return {
		repositoryRoot: root,
		activeRun: active ? runStatus(active) : null,
		pendingRun: pending
			? {
					...runStatus(pending),
					delta: delta
						? {
								carried: delta.carried.length,
								stale: delta.stale.length,
								unnarrated: delta.unnarrated.length,
							}
						: null,
				}
			: null,
		threads: threadStatus(run.manifest.runId, threads, orphaned.length),
		drift: await driftStatus(active ?? reference, root),
	};
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

const scopeLine = (status: RunStatus): string =>
	`${status.scope.mode} ${status.scope.comparison} ${status.scope.base}…${status.scope.head}` +
	`${status.scope.prepArgs ? ` — revue prep ${status.scope.prepArgs.join(" ")}` : ""}`;

const deltaLine = (pending: PendingRunStatus): string =>
	pending.delta
		? `${plural(pending.delta.carried, "chapter")} carried, ${plural(pending.delta.stale, "chapter")} stale, ${plural(pending.delta.unnarrated, "review unit")} to narrate`
		: "no delta recorded";

const threadsLine = (threads: ThreadStatus): string =>
	`${plural(threads.open, "open thread")} (${threads.awaitingAgent} awaiting the agent, ${threads.awaitingHuman} awaiting the reviewer), ${threads.dealtWith} dealt with, ${threads.orphaned} orphaned`;

const driftLine = (drift: DriftStatus): string => {
	const detail = drift.reason ? ` (${drift.reason})` : "";
	if (drift.changed === null) return `Drift      unknown${detail}`;
	if (drift.changed) return `Drift      the scope has changed since this run was prepped${detail}`;
	return "Drift      none — the working tree still matches this run";
};

export function formatStatus(report: StatusReport): string {
	if (!report.activeRun && !report.pendingRun) {
		return `No prepared runs in ${report.repositoryRoot} — run revue prep to start a review.`;
	}
	const lines: string[] = [];
	if (report.activeRun) {
		lines.push(
			`Active run ${report.activeRun.runId.slice(0, 12)} — ${scopeLine(report.activeRun)}`,
			`           ${report.activeRun.directory}`,
		);
	} else {
		lines.push("Active run none — nothing narrated yet");
	}
	if (report.pendingRun) {
		lines.push(
			`Pending    ${report.pendingRun.runId.slice(0, 12)} not narrated — ${deltaLine(report.pendingRun)}`,
			`           ${report.pendingRun.directory}`,
		);
	}
	lines.push(`Threads    ${threadsLine(report.threads)}`);
	if (report.drift) lines.push(driftLine(report.drift));
	return lines.join("\n");
}
