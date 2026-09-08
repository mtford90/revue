import { z } from "zod";

// The shell composes original-unit code marks with narration-specific questions and no-hunk
// chapters. The legacy file/chapter arrays remain readable only for one-time store migration.
export const ViewStateSchema = z.object({
	chapters: z.array(z.string()).default([]),
	files: z.array(z.string()).default([]),
	keyChanges: z.array(z.string()).default([]),
	// Present only in the composed, original-unit view. Persisted separately by immutable runId;
	// absence identifies a legacy chapter/file record for one-time migration.
	hunks: z.array(z.string()).optional(),
});
export type ViewState = z.infer<typeof ViewStateSchema>;

/** Code progress is initialized by record existence, including an empty reviewed set. */
export const CodeProgressSchema = z.object({
	version: z.literal(1),
	hunks: z.array(z.string()),
	// Reload can continue an entirely flat review, for which prep records no narrated lineage.
	continuedFrom: z.string().optional(),
});
export type CodeProgress = z.infer<typeof CodeProgressSchema>;

/** Original pinned hunk identity within one immutable run, not a content-only identity. */
export const viewStateHunkId = (filePath: string, oldStart: number): string =>
	JSON.stringify([filePath, oldStart]);

/** Stable persisted identity for one file reviewed within a chapter. */
export const viewStateFileId = (chapterId: string, filePath: string): string =>
	`${chapterId}::${filePath}`;

/** Stable persisted identity for one key-change question within a chapter. */
export const viewStateKeyChangeId = (chapterId: string, index: number): string =>
	`${chapterId}#${index}`;

export function emptyViewState(): ViewState {
	return { chapters: [], files: [], keyChanges: [] };
}
