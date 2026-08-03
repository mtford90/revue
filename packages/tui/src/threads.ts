import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parsePatch } from "@revue/diff-renderer";
import {
	emptyThreadStoreFile,
	type ReviewThread,
	reviewThreadSchema,
	THREAD_AUTHOR_KIND,
	THREAD_STATUS,
	type ThreadAnchor,
	type ThreadAuthor,
	type ThreadMessage,
	type ThreadStoreFile,
	threadAuthorSchema,
	threadMessageSchema,
	threadStoreFileSchema,
} from "@revue/types";
import { z } from "zod";
import type { ReviewRun } from "./load.ts";

export class ThreadStoreError extends Error {}

const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 5_000;
const lockWaiter = new Int32Array(new SharedArrayBuffer(4));

type LockOwner = { pid: number; token: string };

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
	join(repositoryRootForRun(runDirectory) ?? process.cwd(), ".revue", "threads.json");

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

export const sortThreads = (threads: readonly ReviewThread[]): ReviewThread[] =>
	[...threads].sort(
		(left, right) =>
			left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
	);

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

export function readThreadStoreFile(path: string): ThreadStoreFile {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyThreadStoreFile();
		throw new ThreadStoreError(`Could not read thread store at ${path}: ${describe(error)}`);
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		throw new ThreadStoreError(`Thread store at ${path} is not valid JSON: ${describe(error)}`);
	}
	const parsed = threadStoreFileSchema.safeParse(value);
	if (!parsed.success) {
		throw new ThreadStoreError(
			`Thread store at ${path} does not match the threads schema:\n${z.prettifyError(parsed.error)}`,
		);
	}
	return parsed.data;
}

const lockOwner = (path: string): Partial<LockOwner> | null => {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Partial<LockOwner>;
	} catch {
		return null;
	}
};

const processIsAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
};

const acquireLock = (path: string, token: string, startedAt: number): void => {
	const owner: LockOwner = { pid: process.pid, token };
	try {
		writeFileSync(path, JSON.stringify(owner), { encoding: "utf8", flag: "wx", mode: 0o600 });
		return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
			throw new ThreadStoreError(
				`Could not acquire thread store lock at ${path}: ${describe(error)}`,
			);
		}
	}
	const existing = lockOwner(path);
	if (typeof existing?.pid === "number" && !processIsAlive(existing.pid)) {
		throw new ThreadStoreError(
			`Thread store has an abandoned lock from process ${existing.pid} at ${path}; remove that lock file before retrying`,
		);
	}
	if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
		throw new ThreadStoreError(`Thread store is busy: timed out waiting for lock at ${path}`);
	}
	Atomics.wait(lockWaiter, 0, 0, LOCK_RETRY_MS);
	acquireLock(path, token, startedAt);
};

const releaseLock = (path: string, token: string): void => {
	try {
		const owner = JSON.parse(readFileSync(path, "utf8")) as Partial<LockOwner>;
		if (owner.pid === process.pid && owner.token === token) rmSync(path, { force: true });
	} catch {}
};

const withThreadStoreLock = <Value>(path: string, action: () => Value): Value => {
	mkdirSync(dirname(path), { recursive: true });
	const lockPath = `${path}.lock`;
	const token = randomUUID();
	acquireLock(lockPath, token, Date.now());
	try {
		return action();
	} finally {
		releaseLock(lockPath, token);
	}
};

export function persistThreadStoreFile(path: string, file: ThreadStoreFile): void {
	const parsed = threadStoreFileSchema.parse(file);
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(temporary, path);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw new ThreadStoreError(`Could not persist thread store at ${path}: ${describe(error)}`);
	}
}

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

export function validateThreadsForRun(run: ReviewRun, threads: readonly ReviewThread[]): void {
	const files = parsePatch(run.patch);
	for (const thread of threads) {
		if (thread.runId !== run.manifest.runId) {
			throw new ThreadStoreError(
				`Thread ${thread.id} belongs to run ${thread.runId}, not verified run ${run.manifest.runId}`,
			);
		}
		const file = files.find(
			(candidate) =>
				candidate.path === thread.anchor.filePath ||
				candidate.metadata.name === thread.anchor.filePath,
		);
		if (!file) {
			throw staleAnchor(thread, `file ${JSON.stringify(thread.anchor.filePath)} is absent`);
		}
		const hunk = file.metadata.hunks.find(
			(candidate) => candidate.deletionStart === thread.anchor.oldStart,
		);
		if (!hunk) {
			throw staleAnchor(thread, `review unit oldStart ${thread.anchor.oldStart} is absent`);
		}
		const sideStart = thread.anchor.side === "additions" ? hunk.additionStart : hunk.deletionStart;
		const sideCount = thread.anchor.side === "additions" ? hunk.additionCount : hunk.deletionCount;
		const sideEnd = sideStart + sideCount - 1;
		if (sideCount === 0 || thread.anchor.startLine < sideStart || thread.anchor.endLine > sideEnd) {
			throw staleAnchor(
				thread,
				`${thread.anchor.side} range ${thread.anchor.startLine}-${thread.anchor.endLine} is outside that review unit`,
			);
		}
		if (run.chapters) {
			const owners = run.chapters.chapters.filter((chapter) =>
				chapter.hunkRefs.some(
					(reference) =>
						reference.filePath === thread.anchor.filePath &&
						reference.oldStart === thread.anchor.oldStart,
				),
			);
			if (owners.length !== 1) {
				throw staleAnchor(thread, `review unit has ${owners.length} chapter owners instead of one`);
			}
		}
	}
}

export function loadValidatedThreads(path: string, run: ReviewRun): ReviewThread[] {
	const threads = sortThreads(readThreadStoreFile(path).runs[run.manifest.runId] ?? []);
	validateThreadsForRun(run, threads);
	return threads;
}

const staleAnchor = (thread: ReviewThread, reason: string): ThreadStoreError =>
	new ThreadStoreError(
		`Thread ${thread.id} has a corrupt or stale anchor: ${reason}. Restore the matching pinned run state or repair the corrupt repository-local thread store before retrying.`,
	);

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
