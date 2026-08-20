import { z } from "zod";
import { chapterSchema } from "./chapters.ts";
import { PrologueSchema } from "./prologue.ts";

export const RevueChaptersFileSchema = z.strictObject({
	chapters: z.array(chapterSchema),
	prologue: PrologueSchema.optional(),
});
export type RevueChaptersFile = z.infer<typeof RevueChaptersFileSchema>;

/** How many prepared review units the narration actually cites. */
export const narratedUnitCount = (file: RevueChaptersFile): number =>
	file.chapters.reduce((total, chapter) => total + chapter.hunkRefs.length, 0);
