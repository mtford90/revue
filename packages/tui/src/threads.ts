import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { canonicalizeDiffSelection, type DiffFile, parsePatch } from "@revue/diff";
import {
	persistThreadStoreFile,
	readThreadStoreFile,
	sortThreads,
	ThreadStoreError,
	threadStorePath,
	withThreadStoreLock,
} from "@revue/prep";
import {
	type ExcerptThreadAnchor,
	frozenExcerptContaining,
	type HunkThreadAnchor,
	isExcerptAnchor,
	isPatchAnchor,
	type PatchThreadRange,
	type ReviewThread,
	reviewThreadSchema,
	THREAD_AUTHOR_KIND,
	THREAD_STATUS,
	type ThreadAnchor,
	type ThreadAuthor,
	type ThreadMessage,
	threadAuthorSchema,
	threadMessageSchema,
} from "@revue/types";
import type { ReviewRun } from "./load.ts";

export {
	persistThreadStoreFile,
	readThreadStoreFile,
	sortThreads,
	ThreadStoreError,
} from "@revue/prep";

/** What the last handoff carried, which is all the unsent rule asks of a handoff record. */
export type SentBatch = { threadIds: readonly string[]; requestedAt: string };

/**
 * The threads Send would carry: open, with a human's word last, and either never named by the last
 * handoff or spoken to again since it. The batch names its threads, so a second review in the same
 * repository never reads as sent on the strength of another review's Send. Nothing about sending is
 * stored on a thread, so this is derived at each Send and each render.
 */
export const unsentThreads = (
	threads: readonly ReviewThread[],
	sent: SentBatch | null,
): ReviewThread[] => threads.filter((thread) => isUnsent(thread, sent));

const isUnsent = (thread: ReviewThread, sent: SentBatch | null): boolean => {
	if (thread.status !== THREAD_STATUS.OPEN) return false;
	const last = thread.messages.at(-1);
	if (last?.author.kind !== THREAD_AUTHOR_KIND.HUMAN) return false;
	if (!sent) return true;
	if (!sent.threadIds.includes(thread.id)) return true;
	return Date.parse(last.createdAt) > Date.parse(sent.requestedAt);
};

export type NewThreadOptions = {
	id?: string;
	messageId?: string;
	createdAt?: string;
};

export type NewMessageOptions = {
	id?: string;
	createdAt?: string;
};

export type ThreadStore = {
	get(): ReviewThread[];
	/** The run's threads as they are on disk now, including whatever another process wrote. */
	reload(): ReviewThread[];
	create(
		anchor: ThreadAnchor,
		author: ThreadAuthor,
		body: string,
		options?: NewThreadOptions,
	): ReviewThread;
	reply(
		threadId: string,
		author: ThreadAuthor,
		body: string,
		options?: NewMessageOptions,
	): ReviewThread;
	delete(threadId: string): ReviewThread;
	deleteMessage(threadId: string, messageId: string): ThreadMessage;
	markDealt(threadId: string): ReviewThread;
	reopen(threadId: string): ReviewThread;
};

const findRepositoryRoot = (directory: string): string | null => {
	if (existsSync(join(directory, ".git"))) return directory;
	const parent = dirname(directory);
	return parent === directory ? null : findRepositoryRoot(parent);
};

export const repositoryRootForRun = (runDirectory = process.cwd()): string | null =>
	findRepositoryRoot(dirname(resolve(runDirectory))) ?? findRepositoryRoot(process.cwd());

export const defaultThreadsPath = (runDirectory = process.cwd()): string =>
	threadStorePath(repositoryRootForRun(runDirectory) ?? process.cwd());

const gitAuthorName = (repositoryRoot: string | null): string | null => {
	if (!repositoryRoot) return null;
	try {
		const name = execFileSync("git", ["-C", repositoryRoot, "config", "user.name"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return name || null;
	} catch {
		return null;
	}
};

export const originRemoteUrl = (repositoryRoot: string | null): string | null => {
	if (!repositoryRoot) return null;
	try {
		const url = execFileSync("git", ["-C", repositoryRoot, "remote", "get-url", "origin"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return url || null;
	} catch {
		return null;
	}
};

export const resolveHumanAuthor = (repositoryRoot: string | null): ThreadAuthor => {
	const candidates = [gitAuthorName(repositoryRoot), userInfo().username];
	for (const name of candidates) {
		const parsed = threadAuthorSchema.safeParse({ kind: THREAD_AUTHOR_KIND.HUMAN, name });
		if (parsed.success) return parsed.data;
	}
	throw new ThreadStoreError(
		"Could not resolve a terminal-safe reviewer name from Git or the system login",
	);
};

export const createThreadMessage = (
	author: ThreadAuthor,
	body: string,
	options: NewMessageOptions = {},
): ThreadMessage =>
	threadMessageSchema.parse({
		id: options.id ?? randomUUID(),
		author,
		body: body.replace(/\r\n?/g, "\n"),
		createdAt: options.createdAt ?? new Date().toISOString(),
	});

export function createThread(
	runId: string,
	anchor: ThreadAnchor,
	author: ThreadAuthor,
	body: string,
	options: NewThreadOptions = {},
): ReviewThread {
	const message = createThreadMessage(author, body, {
		id: options.messageId,
		createdAt: options.createdAt,
	});
	return reviewThreadSchema.parse({
		id: options.id ?? randomUUID(),
		runId,
		anchor,
		status: THREAD_STATUS.OPEN,
		createdAt: message.createdAt,
		messages: [message],
	});
}

export const addThread = (threads: readonly ReviewThread[], thread: ReviewThread): ReviewThread[] =>
	sortThreads([...threads, thread]);

const threadById = (threads: readonly ReviewThread[], id: string): ReviewThread => {
	const matches = threads.filter((thread) => thread.id === id);
	if (matches.length !== 1) {
		throw new ThreadStoreError(
			matches.length === 0
				? `Thread ${JSON.stringify(id)} does not exist in this run`
				: `Thread ${JSON.stringify(id)} is duplicated in this run`,
		);
	}
	const thread = matches[0];
	if (!thread) throw new ThreadStoreError(`Thread ${JSON.stringify(id)} does not exist`);
	return thread;
};

export const addThreadReply = (
	threads: readonly ReviewThread[],
	threadId: string,
	message: ThreadMessage,
): { threads: ReviewThread[]; updated: ReviewThread } => {
	const existing = threadById(threads, threadId);
	const updated = {
		...existing,
		messages: [...existing.messages, message],
	};
	return {
		threads: threads.map((thread) => (thread.id === threadId ? updated : thread)),
		updated,
	};
};

export const deleteThread = (
	threads: readonly ReviewThread[],
	id: string,
): { threads: ReviewThread[]; deleted: ReviewThread } => {
	const deleted = threadById(threads, id);
	return { threads: threads.filter((thread) => thread.id !== id), deleted };
};

export const deleteThreadMessage = (
	threads: readonly ReviewThread[],
	threadId: string,
	messageId: string,
): { threads: ReviewThread[]; deleted: ThreadMessage; updated: ReviewThread } => {
	const existing = threadById(threads, threadId);
	const index = existing.messages.findIndex((message) => message.id === messageId);
	if (index < 0) {
		throw new ThreadStoreError(
			`Message ${JSON.stringify(messageId)} does not exist in thread ${JSON.stringify(threadId)}`,
		);
	}
	if (index === 0) {
		throw new ThreadStoreError("The root message cannot be deleted separately; delete its thread");
	}
	const deleted = existing.messages[index];
	if (!deleted) throw new ThreadStoreError(`Message ${JSON.stringify(messageId)} does not exist`);
	const updated = {
		...existing,
		messages: existing.messages.filter((message) => message.id !== messageId),
	};
	return {
		threads: threads.map((thread) => (thread.id === threadId ? updated : thread)),
		deleted,
		updated,
	};
};

export const setThreadStatus = (
	threads: readonly ReviewThread[],
	id: string,
	status: ReviewThread["status"],
): { threads: ReviewThread[]; updated: ReviewThread } => {
	const existing = threadById(threads, id);
	const updated = { ...existing, status };
	return {
		threads: threads.map((thread) => (thread.id === id ? updated : thread)),
		updated,
	};
};

export function openThreadStore(path: string, runId: string): ThreadStore {
	let current = sortThreads(readThreadStoreFile(path).runs[runId] ?? []);
	const mutate = <Value>(
		transform: (threads: ReviewThread[]) => { threads: ReviewThread[]; value: Value },
	): Value =>
		withThreadStoreLock(path, () => {
			const latest = readThreadStoreFile(path);
			const result = transform(sortThreads(latest.runs[runId] ?? []));
			current = sortThreads(result.threads);
			persistThreadStoreFile(path, {
				...latest,
				runs: { ...latest.runs, [runId]: current },
			});
			return result.value;
		});
	return {
		get: () => current,
		reload: () => {
			current = sortThreads(readThreadStoreFile(path).runs[runId] ?? []);
			return current;
		},
		create: (anchor, author, body, options) => {
			const thread = createThread(runId, anchor, author, body, options);
			return mutate((threads) => ({ threads: addThread(threads, thread), value: thread }));
		},
		reply: (threadId, author, body, options) => {
			const message = createThreadMessage(author, body, options);
			return mutate((threads) => {
				const result = addThreadReply(threads, threadId, message);
				return { threads: result.threads, value: result.updated };
			});
		},
		delete: (id) =>
			mutate((threads) => {
				const result = deleteThread(threads, id);
				return { threads: result.threads, value: result.deleted };
			}),
		deleteMessage: (threadId, messageId) =>
			mutate((threads) => {
				const result = deleteThreadMessage(threads, threadId, messageId);
				return { threads: result.threads, value: result.deleted };
			}),
		markDealt: (id) =>
			mutate((threads) => {
				const result = setThreadStatus(threads, id, THREAD_STATUS.DEALT_WITH);
				return { threads: result.threads, value: result.updated };
			}),
		reopen: (id) =>
			mutate((threads) => {
				const result = setThreadStatus(threads, id, THREAD_STATUS.OPEN);
				return { threads: result.threads, value: result.updated };
			}),
	};
}

/** A thread the narration stopped quoting: kept, listed, and never rendered inline. */
export type OrphanedThread = { thread: ReviewThread; reason: string };

export const excerptAnchorLabel = (anchor: ExcerptThreadAnchor): string =>
	`${JSON.stringify(anchor.filePath)} ${anchor.startLine}-${anchor.endLine}`;

/**
 * Quoted code belongs to the narration, not the patch, so a regenerated narrative may honestly
 * stop covering a commented range. That is not corruption and must never fail a load: the thread
 * is reported as orphaned so callers can keep it, show it, and leave it in the store.
 */
const excerptOrphan = (run: ReviewRun, thread: ReviewThread): OrphanedThread | null => {
	if (!isExcerptAnchor(thread.anchor)) return null;
	if (frozenExcerptContaining(run.context, thread.anchor)) return null;
	return {
		thread,
		reason: `no frozen excerpt of this run still quotes ${excerptAnchorLabel(thread.anchor)}`,
	};
};

/** Why this anchor names no pinned review unit of the run, or null when it names exactly one. */
const hunkAnchorIssue = (files: readonly DiffFile[], anchor: HunkThreadAnchor): string | null => {
	const file = files.find(
		(candidate) =>
			candidate.path === anchor.filePath || candidate.metadata.name === anchor.filePath,
	);
	if (!file) return `file ${JSON.stringify(anchor.filePath)} is absent`;
	const hunk = file.metadata.hunks.find((candidate) => candidate.deletionStart === anchor.oldStart);
	if (!hunk) return `review unit oldStart ${anchor.oldStart} is absent`;
	const start = anchor.side === "additions" ? hunk.additionStart : hunk.deletionStart;
	const count = anchor.side === "additions" ? hunk.additionCount : hunk.deletionCount;
	if (count > 0 && anchor.startLine >= start && anchor.endLine <= start + count - 1) return null;
	return `${anchor.side} range ${anchor.startLine}-${anchor.endLine} is outside that review unit`;
};

/** Why the narration does not own one review unit exactly once, if it does not. */
const chapterRangeOwnershipIssue = (
	run: ReviewRun,
	filePath: string,
	oldStart: number,
): string | null => {
	if (!run.chapters) return null;
	const owners = run.chapters.chapters.filter((chapter) =>
		chapter.hunkRefs.some(
			(reference) => reference.filePath === filePath && reference.oldStart === oldStart,
		),
	);
	if (owners.length === 1) return null;
	return `review unit has ${owners.length} chapter owners instead of one`;
};

const patchRangeAsHunk = (filePath: string, range: PatchThreadRange): HunkThreadAnchor => ({
	kind: "hunk",
	filePath,
	oldStart: range.oldStart,
	side: range.side,
	startLine: range.startLine,
	endLine: range.endLine,
});

/**
 * Reject every anchor that does not belong to exactly one pinned review unit, and report — rather
 * than reject — anchors that legitimately stopped resolving: excerpt anchors the frozen context no
 * longer covers, and hunk anchors carried here from a superseded run whose code this one no longer
 * has. Only a carried anchor earns that leniency, because supersession deletes code as a matter of
 * course while an anchor written against this run can only stop resolving through corruption.
 */
export function validateThreadsForRun(
	run: ReviewRun,
	threads: readonly ReviewThread[],
): OrphanedThread[] {
	const files = parsePatch(run.patch);
	const orphaned: OrphanedThread[] = [];
	for (const thread of threads) {
		if (thread.runId !== run.manifest.runId) {
			throw new ThreadStoreError(
				`Thread ${thread.id} belongs to run ${thread.runId}, not verified run ${run.manifest.runId}`,
			);
		}
		if (isExcerptAnchor(thread.anchor)) {
			const orphan = excerptOrphan(run, thread);
			if (orphan) orphaned.push(orphan);
			continue;
		}
		if (thread.migrationOrphaned) {
			if (!isPatchAnchor(thread.anchor) || !thread.migratedFrom) {
				throw staleAnchor(thread, "migrationOrphaned requires a migrated patch anchor");
			}
			orphaned.push({
				thread,
				reason: "this atomic patch selection could not be fully remapped from a superseded run",
			});
			continue;
		}
		const anchors = isPatchAnchor(thread.anchor)
			? thread.anchor.ranges.map((range) => patchRangeAsHunk(thread.anchor.filePath, range))
			: [thread.anchor];
		const issue = anchors
			.map((anchor, index) => ({ index, issue: hunkAnchorIssue(files, anchor) }))
			.find((entry) => entry.issue !== null);
		if (issue?.issue) {
			const patch = isPatchAnchor(thread.anchor);
			const detail = patch ? `patch range ${issue.index + 1}: ${issue.issue}` : issue.issue;
			// Prep marks a failed atomic patch migration explicitly. A merely migrated patch that no
			// longer resolves is corrupt; generic migratedFrom leniency remains only for historical hunks.
			if (patch || !thread.migratedFrom) throw staleAnchor(thread, detail);
			orphaned.push({
				thread,
				reason: `this thread was carried from a superseded run and ${detail}`,
			});
			continue;
		}
		if (isPatchAnchor(thread.anchor)) {
			const authoritative = files.find(
				(file) =>
					file.path === thread.anchor.filePath || file.metadata.name === thread.anchor.filePath,
			);
			if (!authoritative) throw staleAnchor(thread, "patch file authority is absent");
			const canonical = canonicalizeDiffSelection(
				{ filePath: thread.anchor.filePath, ranges: thread.anchor.ranges },
				authoritative,
			);
			if (JSON.stringify(canonical.ranges) !== JSON.stringify(thread.anchor.ranges)) {
				throw staleAnchor(
					thread,
					"patch ranges are not canonical (ordered, non-overlapping, and adjacent-merged)",
				);
			}
		}
		for (const anchor of anchors) {
			const ownership = chapterRangeOwnershipIssue(run, anchor.filePath, anchor.oldStart);
			if (ownership) throw staleAnchor(thread, ownership);
		}
	}
	return orphaned;
}

export type LoadedThreads = { threads: ReviewThread[]; orphaned: OrphanedThread[] };

export function loadValidatedThreads(path: string, run: ReviewRun): LoadedThreads {
	const threads = sortThreads(readThreadStoreFile(path).runs[run.manifest.runId] ?? []);
	return { threads, orphaned: validateThreadsForRun(run, threads) };
}

const staleAnchor = (thread: ReviewThread, reason: string): ThreadStoreError =>
	new ThreadStoreError(
		`Thread ${thread.id} has a corrupt or stale anchor: ${reason}. Restore the matching pinned run state or repair the corrupt repository-local thread store before retrying.`,
	);
