import { z } from "zod";
import { chapterSchema } from "./chapters.ts";
import { PrologueSchema } from "./prologue.ts";

export const RevueChaptersFileSchema = z.strictObject({
	chapters: z.array(chapterSchema),
	prologue: PrologueSchema.optional(),
});
export type RevueChaptersFile = z.infer<typeof RevueChaptersFileSchema>;
