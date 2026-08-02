import { z } from "zod";

// Ported from ReviewStage/stage-cli, MIT. This is the *agent-side* schema — the strict
// shape the chapter-generating skill is required to emit (see stage-cli's
// packages/cli/src/schema.ts). revue loads this JSON directly instead of importing it
// into a database, so the agent's output IS the source of truth.

export const DIFF_SIDE = {
	ADDITIONS: "additions",
	DELETIONS: "deletions",
} as const;
export type DiffSide = (typeof DIFF_SIDE)[keyof typeof DIFF_SIDE];

/**
 * Anchors a single diff hunk by its file and pre-image start line. `(filePath, oldStart)`
 * is the stable identity the prep step prints in each hunk header; the agent copies these
 * verbatim rather than inventing them. `oldStart` is 0 for new files and metadata-only units.
 */
export const hunkReferenceSchema = z.strictObject({
	filePath: z.string().min(1),
	oldStart: z.number().int().nonnegative(),
});
export type HunkReference = z.infer<typeof hunkReferenceSchema>;

/** A tight line range a key-change question points at. */
export const lineRefSchema = z
	.strictObject({
		filePath: z.string().min(1),
		side: z.enum(DIFF_SIDE),
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
	})
	.refine((v) => v.startLine <= v.endLine, {
		message: "endLine must be greater than or equal to startLine",
		path: ["endLine"],
	});
export type LineRef = z.infer<typeof lineRefSchema>;

/** A judgment-call question for a human reviewer — not source code, not a changelog line. */
export const keyChangeSchema = z.strictObject({
	content: z.string().min(1),
	lineRefs: z.array(lineRefSchema).min(1),
});
export type KeyChange = z.infer<typeof keyChangeSchema>;

/** One narrative beat: a coherent group of hunks the reviewer can absorb as a unit. */
export const chapterSchema = z.strictObject({
	id: z.string().min(1),
	order: z.number().int().positive(),
	title: z.string().min(1),
	summary: z.string().min(1),
	hunkRefs: z.array(hunkReferenceSchema),
	keyChanges: z.array(keyChangeSchema),
});
export type Chapter = z.infer<typeof chapterSchema>;
