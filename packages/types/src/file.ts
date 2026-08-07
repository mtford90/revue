import { z } from "zod";
import { chapterSchema, narrativeDepthSchema } from "./chapters.ts";
import { PrologueSchema } from "./prologue.ts";

export const RevueChaptersFileSchema = z.strictObject({
	chapters: z.array(chapterSchema),
	prologue: PrologueSchema.optional(),
	depth: narrativeDepthSchema.optional(),
});
export type RevueChaptersFile = z.infer<typeof RevueChaptersFileSchema>;

/**
 * The words a partial narrative describes itself with, or null when it covers the whole diff.
 * An absent declaration is full depth, so every chapters file written before depth existed still
 * promises complete coverage — this is the one place that decision is made.
 */
export const partialDepthLabel = (file: RevueChaptersFile): string | null =>
	file.depth?.kind === "partial" ? file.depth.label : null;

/** How many prepared review units the narration actually cites. */
export const narratedUnitCount = (file: RevueChaptersFile): number =>
	file.chapters.reduce((total, chapter) => total + chapter.hunkRefs.length, 0);
