import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	loadPreparedRun,
	loadRunContext,
	type PreparedRun,
	validateReviewCoverage,
} from "@revue/prep";
import { type RevueChaptersFile, RevueChaptersFileSchema, type RunContextFile } from "@revue/types";
import { z } from "zod";

export class ChaptersFileError extends Error {}

/** `chapters` is null for a chapterless run — a prepared diff nobody has narrated. */
export type ReviewRun = PreparedRun & {
	chapters: RevueChaptersFile | null;
	context: RunContextFile | null;
};

export async function loadReviewRun(directory: string): Promise<ReviewRun> {
	const prepared = await loadPreparedRun(directory);
	const path = join(directory, "chapters.json");
	const chapters = existsSync(path) ? await loadChaptersFile(path) : null;
	const context = await loadRunContext(prepared);
	if (chapters) validateReviewCoverage(prepared, chapters, context);
	return { ...prepared, chapters, context };
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
			`${path} does not match the chapters schema:\n${z.prettifyError(parsed.error)}`,
		);
	}
	return parsed.data;
}

function describe(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
