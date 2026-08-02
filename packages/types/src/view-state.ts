import { z } from "zod";

// Per-run review progress, persisted locally. Mirrors stage-cli's three-level model
// (chapter / file / key-change "viewed" sets) but flattened into id arrays we can
// serialise to a JSON file. Ids are opaque strings built by the tui layer:
//   chapter   -> chapter.id
//   file      -> `${chapterId}::${filePath}`   (a file is reviewed within a chapter)
//   keyChange -> `${chapterId}#${index}`
export const ViewStateSchema = z.object({
	chapters: z.array(z.string()).default([]),
	files: z.array(z.string()).default([]),
	keyChanges: z.array(z.string()).default([]),
});
export type ViewState = z.infer<typeof ViewStateSchema>;

/** Stable persisted identity for one file reviewed within a chapter. */
export const viewStateFileId = (chapterId: string, filePath: string): string =>
	`${chapterId}::${filePath}`;

/** Stable persisted identity for one key-change question within a chapter. */
export const viewStateKeyChangeId = (chapterId: string, index: number): string =>
	`${chapterId}#${index}`;

export function emptyViewState(): ViewState {
	return { chapters: [], files: [], keyChanges: [] };
}
