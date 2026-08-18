import { z } from "zod";
import { chapterSchema } from "./chapters.ts";
import { sha256Schema } from "./run.ts";

// The worklist prep records when a run supersedes a narrated one. Like chapters.json and
// context.json it sits inside the run directory and outside the run ID, because it describes the
// narration a run inherits rather than the code it pins. It is written once, at creation.

export const REVIEW_UNIT_STATUS = {
	/** The same content as a review unit of the predecessor, wherever its lines now sit. */
	UNCHANGED: "unchanged",
	/** The predecessor changed the same pre-image lines, but differently. */
	MODIFIED: "modified",
	/** No review unit of the predecessor touched this code. */
	NEW: "new",
} as const;
export type ReviewUnitStatus = (typeof REVIEW_UNIT_STATUS)[keyof typeof REVIEW_UNIT_STATUS];

/** A review unit of the superseding run that no carried chapter covers. */
export const unnarratedUnitSchema = z.strictObject({
	filePath: z.string().min(1),
	oldStart: z.number().int().nonnegative(),
	status: z.enum(REVIEW_UNIT_STATUS),
});
export type UnnarratedUnit = z.infer<typeof unnarratedUnitSchema>;

/** A predecessor chapter the change invalidated, named with why it cannot be carried. */
export const staleChapterSchema = z.strictObject({
	id: z.string().min(1),
	title: z.string().min(1),
	reasons: z.array(z.string().min(1)).min(1),
});
export type StaleChapter = z.infer<typeof staleChapterSchema>;

export const runDeltaFileSchema = z.strictObject({
	runId: sha256Schema,
	supersedes: sha256Schema,
	/** Predecessor chapters the change left alone, with every reference re-mapped to this run. */
	carried: z.array(chapterSchema),
	stale: z.array(staleChapterSchema),
	unnarrated: z.array(unnarratedUnitSchema),
});
export type RunDeltaFile = z.infer<typeof runDeltaFileSchema>;
