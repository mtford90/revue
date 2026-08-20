import { z } from "zod";
import { RUN_ENDPOINT_KIND, sha256Schema } from "./run.ts";

// The narration-side companion to chapters.json. `revue context freeze` resolves every excerpt
// citation against the run's own recorded new endpoint and pins the resulting lines here, so the
// reviewer reads bytes that came off disk rather than an agent's transcription. Like chapters.json
// it sits inside the run directory and is deliberately outside the run ID: freezing a narrative
// must never invalidate the prepared code it narrates.

/** The identity of one cited range: a file and the inclusive line span quoted from it. */
export type ExcerptRange = {
	filePath: string;
	startLine: number;
	endLine: number;
};

export const excerptKey = (range: ExcerptRange): string =>
	JSON.stringify([range.filePath, range.startLine, range.endLine]);

export const excerptRangeLabel = (range: ExcerptRange): string =>
	`${JSON.stringify(range.filePath)} ${range.startLine}-${range.endLine}`;

const excerptRangeShape = {
	filePath: z.string().min(1),
	startLine: z.number().int().positive(),
	endLine: z.number().int().positive(),
};

/** A cited range whose text has been read off disk, with the digest of the file it came from. */
export const frozenExcerptSchema = z.strictObject({
	...excerptRangeShape,
	lines: z.array(z.string()),
	fileSha256: sha256Schema,
});
export type FrozenExcerpt = z.infer<typeof frozenExcerptSchema>;

/** A cited range no content could be found for, kept so validation can name the bad citation. */
export const unresolvedExcerptSchema = z.strictObject({
	...excerptRangeShape,
	reason: z.string().min(1),
});
export type UnresolvedExcerpt = z.infer<typeof unresolvedExcerptSchema>;

export const runContextFileSchema = z.strictObject({
	runId: sha256Schema,
	source: z.strictObject({
		kind: z.enum(RUN_ENDPOINT_KIND),
		revision: z.string().min(1),
	}),
	excerpts: z.array(frozenExcerptSchema),
	unresolved: z.array(unresolvedExcerptSchema).default([]),
});
export type RunContextFile = z.infer<typeof runContextFileSchema>;

export const frozenExcerptFor = (
	context: RunContextFile | null,
	range: ExcerptRange,
): FrozenExcerpt | undefined =>
	context?.excerpts.find((entry) => excerptKey(entry) === excerptKey(range));

/**
 * The frozen excerpt whose quoted lines contain this range. Thread anchors on quoted code
 * resolve through here: a range is only anchorable while some pinned excerpt still covers it,
 * and a re-narrated run can legitimately stop covering it.
 */
export const frozenExcerptContaining = (
	context: RunContextFile | null,
	range: ExcerptRange,
): FrozenExcerpt | undefined =>
	context?.excerpts.find(
		(entry) =>
			entry.filePath === range.filePath &&
			entry.startLine <= range.startLine &&
			range.endLine <= entry.endLine,
	);
