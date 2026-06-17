import { readFile } from "node:fs/promises";
import { type RevueChaptersFile, RevueChaptersFileSchema } from "@revue/types";
import { z } from "zod";

export class ChaptersFileError extends Error {}

/** Read, JSON-parse and validate a chapters file written by the revue-chapters skill. */
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
