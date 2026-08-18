import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parsePatch } from "@revue/diff";
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
	isExcerptAnchor,
	partialDepthLabel,
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

/**
 * Reject every anchor that does not belong to exactly one pinned review unit, and report — rather
 * than reject — excerpt anchors the frozen context no longer covers.
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
		const anchor = thread.anchor;
		const file = files.find(
			(candidate) =>
				candidate.path === anchor.filePath || candidate.metadata.name === anchor.filePath,
		);
		if (!file) {
			throw staleAnchor(thread, `file ${JSON.stringify(anchor.filePath)} is absent`);
		}
		const hunk = file.metadata.hunks.find(
			(candidate) => candidate.deletionStart === anchor.oldStart,
		);
		if (!hunk) {
			throw staleAnchor(thread, `review unit oldStart ${anchor.oldStart} is absent`);
		}
		const sideStart = anchor.side === "additions" ? hunk.additionStart : hunk.deletionStart;
		const sideCount = anchor.side === "additions" ? hunk.additionCount : hunk.deletionCount;
		const sideEnd = sideStart + sideCount - 1;
		if (sideCount === 0 || anchor.startLine < sideStart || anchor.endLine > sideEnd) {
			throw staleAnchor(
				thread,
				`${anchor.side} range ${anchor.startLine}-${anchor.endLine} is outside that review unit`,
			);
		}
		if (run.chapters) {
			const owners = run.chapters.chapters.filter((chapter) =>
				chapter.hunkRefs.some(
					(reference) =>
						reference.filePath === anchor.filePath && reference.oldStart === anchor.oldStart,
				),
			);
			// A partial narrative leaves units out of the story on purpose and Files still reaches
			// them, so feedback on an unnarrated unit is a narration choice rather than corruption.
			// Two owners is a broken narrative at any depth.
			const leftOutDeliberately = owners.length === 0 && partialDepthLabel(run.chapters) !== null;
			if (owners.length !== 1 && !leftOutDeliberately) {
				throw staleAnchor(thread, `review unit has ${owners.length} chapter owners instead of one`);
			}
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
