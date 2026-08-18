import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	loadPreparedRun,
	loadRunContext,
	loadRunDelta,
	type PreparedRun,
	readThreadStoreFile,
	validateReviewCoverage,
} from "@revue/prep";
import {
	type ReviewThread,
	type RevueChaptersFile,
	RevueChaptersFileSchema,
	type RunContextFile,
	type RunDeltaFile,
} from "@revue/types";
import { z } from "zod";
import { defaultThreadsPath } from "./threads.ts";

export class ChaptersFileError extends Error {}

/** `chapters` is null for a chapterless run — a prepared diff nobody has narrated. */
export type ReviewRun = PreparedRun & {
	chapters: RevueChaptersFile | null;
	context: RunContextFile | null;
	/** What this run inherited from the run it supersedes, or null when it starts a lineage. */
	delta: RunDeltaFile | null;
};

/**
 * The feedback this run holds, or null when the store cannot be read. Narration citing threads is
 * checked against it, and an unreadable store means "unknown" rather than "no such thread": it
 * already fails loudly, with its own message, everywhere the threads themselves are used.
 */
const runThreads = (run: PreparedRun): ReviewThread[] | null => {
	try {
		return readThreadStoreFile(defaultThreadsPath(run.directory)).runs[run.manifest.runId] ?? [];
	} catch {
		return null;
	}
};

export async function loadReviewRun(directory: string): Promise<ReviewRun> {
	const prepared = await loadPreparedRun(directory);
	const path = join(directory, "chapters.json");
	const chapters = existsSync(path) ? await loadChaptersFile(path) : null;
	const context = await loadRunContext(prepared);
	const delta = await loadRunDelta(prepared);
	if (chapters) {
		validateReviewCoverage(prepared, chapters, context, { delta, threads: runThreads(prepared) });
	}
	return { ...prepared, chapters, context, delta };
}

/** Read, JSON-parse and validate a chapters file written by the revue skill. */
export async function loadChaptersFile(path: string): Promise<RevueChaptersFile> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (err) {
		throw new ChaptersFileError(`Could not read chapters file at ${path}: ${describe(err)}`);
	}

	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch (err) {
		throw new ChaptersFileError(`${path} is not valid JSON: ${describe(err)}`);
	}

	const parsed = RevueChaptersFileSchema.safeParse(json);
	if (!parsed.success) {
		throw new ChaptersFileError(
			`${path} does not match the chapters schema:\n${z.prettifyError(parsed.error)}` +
				driftHint(unknownKeys(parsed.error)),
		);
	}
	return parsed.data;
}

/**
 * The chapters schema is strict, so a file written by a newer skill than the installed CLI fails
 * on fields the CLI has simply never heard of. That is a version mismatch, not a mistake in the
 * narration, and it is worth saying so — but only alongside the real errors, never instead of them.
 */
const unknownKeys = (error: z.ZodError): string[] => [
	...new Set(
		error.issues.flatMap((issue) => (issue.code === "unrecognized_keys" ? issue.keys : [])),
	),
];

const driftHint = (keys: string[]): string => {
	if (!keys.length) return "";
	const named = keys.map((key) => JSON.stringify(key)).join(", ");
	return `\n\nThis revue CLI does not recognise ${named}, which usually means the skill that wrote this file is newer than the installed CLI. Reinstall the matching skill with \`revue skill install\` and regenerate chapters.json; \`revue doctor\` reports the version drift.`;
};

function describe(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
