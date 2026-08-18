import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	emptyThreadStoreFile,
	type ReviewThread,
	type ThreadStoreFile,
	threadStoreFileSchema,
} from "@revue/types";
import { z } from "zod";

// Threads are the mutable overlay on immutable runs, so the store lives beside the runs rather than
// inside them and every writer takes the same cross-process lock. The store lives here, below the
// terminal, because prep writes to it too.

export class ThreadStoreError extends Error {}

const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 5_000;
const lockWaiter = new Int32Array(new SharedArrayBuffer(4));

type LockOwner = { pid: number; token: string };

export const threadStorePath = (repositoryRoot: string): string =>
	join(repositoryRoot, ".revue", "threads.json");

export const sortThreads = (threads: readonly ReviewThread[]): ReviewThread[] =>
	[...threads].sort(
		(left, right) =>
			left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
	);

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

export const withThreadStoreLock = <Value>(path: string, action: () => Value): Value => {
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

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
