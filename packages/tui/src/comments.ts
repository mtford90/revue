import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parsePatch } from "@revue/diff-renderer";
import {
	COMMENT_STATUS,
	type CommentAnchor,
	type CommentStoreFile,
	commentStoreFileSchema,
	emptyCommentStoreFile,
	type RevueComment,
	revueCommentSchema,
} from "@revue/types";
import { z } from "zod";
import type { ReviewRun } from "./load.ts";

export class CommentStoreError extends Error {}

export type NewCommentOptions = {
	id?: string;
	createdAt?: string;
};

export type CommentStore = {
	get(): RevueComment[];
	add(anchor: CommentAnchor, body: string, options?: NewCommentOptions): RevueComment;
	delete(id: string): RevueComment;
	markDealt(id: string): RevueComment;
	reopen(id: string): RevueComment;
};

const findRepositoryRoot = (directory: string): string | null => {
	if (existsSync(join(directory, ".git"))) return directory;
	const parent = dirname(directory);
	return parent === directory ? null : findRepositoryRoot(parent);
};

export const defaultCommentsPath = (runDirectory = process.cwd()): string => {
	const root =
		findRepositoryRoot(dirname(resolve(runDirectory))) ?? findRepositoryRoot(process.cwd());
	return join(root ?? process.cwd(), ".revue", "comments.json");
};

export const sortComments = (comments: readonly RevueComment[]): RevueComment[] =>
	[...comments].sort(
		(left, right) =>
			left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
	);

export function createComment(
	runId: string,
	anchor: CommentAnchor,
	body: string,
	options: NewCommentOptions = {},
): RevueComment {
	return revueCommentSchema.parse({
		id: options.id ?? randomUUID(),
		runId,
		anchor,
		body: body.replace(/\r\n?/g, "\n"),
		status: COMMENT_STATUS.OPEN,
		createdAt: options.createdAt ?? new Date().toISOString(),
	});
}

export const addComment = (
	comments: readonly RevueComment[],
	comment: RevueComment,
): RevueComment[] => sortComments([...comments, comment]);

const commentById = (comments: readonly RevueComment[], id: string): RevueComment => {
	const matches = comments.filter((comment) => comment.id === id);
	if (matches.length !== 1) {
		throw new CommentStoreError(
			matches.length === 0
				? `Comment ${JSON.stringify(id)} does not exist in this run`
				: `Comment ${JSON.stringify(id)} is duplicated in this run`,
		);
	}
	const comment = matches[0];
	if (!comment) throw new CommentStoreError(`Comment ${JSON.stringify(id)} does not exist`);
	return comment;
};

export const deleteComment = (
	comments: readonly RevueComment[],
	id: string,
): { comments: RevueComment[]; deleted: RevueComment } => {
	const deleted = commentById(comments, id);
	return { comments: comments.filter((comment) => comment.id !== id), deleted };
};

export const setCommentStatus = (
	comments: readonly RevueComment[],
	id: string,
	status: RevueComment["status"],
): { comments: RevueComment[]; updated: RevueComment } => {
	const existing = commentById(comments, id);
	const updated = { ...existing, status };
	return {
		comments: comments.map((comment) => (comment.id === id ? updated : comment)),
		updated,
	};
};

export function readCommentStoreFile(path: string): CommentStoreFile {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyCommentStoreFile();
		throw new CommentStoreError(`Could not read comment store at ${path}: ${describe(error)}`);
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		throw new CommentStoreError(`Comment store at ${path} is not valid JSON: ${describe(error)}`);
	}
	const parsed = commentStoreFileSchema.safeParse(value);
	if (!parsed.success) {
		throw new CommentStoreError(
			`Comment store at ${path} does not match the comments schema:\n${z.prettifyError(parsed.error)}`,
		);
	}
	return parsed.data;
}

export function persistCommentStoreFile(path: string, file: CommentStoreFile): void {
	const parsed = commentStoreFileSchema.parse(file);
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
		throw new CommentStoreError(`Could not persist comment store at ${path}: ${describe(error)}`);
	}
}

export function openCommentStore(path: string, runId: string): CommentStore {
	let current = sortComments(readCommentStoreFile(path).runs[runId] ?? []);
	const persist = (next: RevueComment[]) => {
		const latest = readCommentStoreFile(path);
		const updated = { ...latest, runs: { ...latest.runs, [runId]: next } };
		persistCommentStoreFile(path, updated);
		current = next;
	};
	return {
		get: () => current,
		add: (anchor, body, options) => {
			const comment = createComment(runId, anchor, body, options);
			persist(addComment(current, comment));
			return comment;
		},
		delete: (id) => {
			const result = deleteComment(current, id);
			persist(result.comments);
			return result.deleted;
		},
		markDealt: (id) => {
			const result = setCommentStatus(current, id, COMMENT_STATUS.DEALT_WITH);
			persist(result.comments);
			return result.updated;
		},
		reopen: (id) => {
			const result = setCommentStatus(current, id, COMMENT_STATUS.OPEN);
			persist(result.comments);
			return result.updated;
		},
	};
}

export function validateCommentsForRun(run: ReviewRun, comments: readonly RevueComment[]): void {
	const files = parsePatch(run.patch);
	for (const comment of comments) {
		if (comment.runId !== run.manifest.runId) {
			throw new CommentStoreError(
				`Comment ${comment.id} belongs to run ${comment.runId}, not verified run ${run.manifest.runId}`,
			);
		}
		const file = files.find(
			(candidate) =>
				candidate.path === comment.anchor.filePath ||
				candidate.metadata.name === comment.anchor.filePath,
		);
		if (!file) {
			throw staleAnchor(comment, `file ${JSON.stringify(comment.anchor.filePath)} is absent`);
		}
		const hunk = file.metadata.hunks.find(
			(candidate) => candidate.deletionStart === comment.anchor.oldStart,
		);
		if (!hunk) {
			throw staleAnchor(comment, `review unit oldStart ${comment.anchor.oldStart} is absent`);
		}
		const sideStart = comment.anchor.side === "additions" ? hunk.additionStart : hunk.deletionStart;
		const sideCount = comment.anchor.side === "additions" ? hunk.additionCount : hunk.deletionCount;
		const sideEnd = sideStart + sideCount - 1;
		if (
			sideCount === 0 ||
			comment.anchor.startLine < sideStart ||
			comment.anchor.endLine > sideEnd
		) {
			throw staleAnchor(
				comment,
				`${comment.anchor.side} range ${comment.anchor.startLine}-${comment.anchor.endLine} is outside that review unit`,
			);
		}
		const owners = run.chapters.chapters.filter((chapter) =>
			chapter.hunkRefs.some(
				(reference) =>
					reference.filePath === comment.anchor.filePath &&
					reference.oldStart === comment.anchor.oldStart,
			),
		);
		if (owners.length !== 1) {
			throw staleAnchor(comment, `review unit has ${owners.length} chapter owners instead of one`);
		}
	}
}

export function loadValidatedComments(path: string, run: ReviewRun): RevueComment[] {
	const comments = sortComments(readCommentStoreFile(path).runs[run.manifest.runId] ?? []);
	validateCommentsForRun(run, comments);
	return comments;
}

const staleAnchor = (comment: RevueComment, reason: string): CommentStoreError =>
	new CommentStoreError(
		`Comment ${comment.id} has a corrupt or stale anchor: ${reason}. Restore the matching pinned run state or repair the corrupt repository-local comment store before retrying.`,
	);

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
