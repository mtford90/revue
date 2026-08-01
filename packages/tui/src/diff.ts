import { readFile } from "node:fs/promises";
import type { Chapter, LineRef } from "@revue/types";
import {
	createHunkDiffFilesFromPatch,
	type FileDiffMetadata,
	type HunkDiffFile,
	type HunkDiffFileInput,
} from "hunkdiff/opentui";

// Bridges a chapters file to hunk's renderer: a chapter cites hunks by
// `(filePath, oldStart)`; hunk parses a unified diff into files whose
// `metadata.hunks[].deletionStart` IS that `oldStart`. So selecting a chapter's
// diff is: find each referenced file, keep only the hunks it cites.

/** Parse a unified diff (e.g. `git diff` output) into hunk's OpenTUI file model. */
export async function loadPatch(path: string): Promise<HunkDiffFile[]> {
	const text = await readFile(path, "utf8");
	return createHunkDiffFilesFromPatch(text);
}

// `hunks` isn't on the published FileDiffMetadata type surface, but it's the
// array the renderer reads. Each hunk carries its own indices into the file's
// line arrays, so narrowing this list (while leaving the arrays intact) renders
// just those hunks correctly.
type MetadataWithHunks = FileDiffMetadata & { hunks?: Array<{ deletionStart: number }> };

/** A selected diff plus the exact chapter path that selected it. */
export type ChapterDiffFile = HunkDiffFileInput & { chapterPath: string };

/**
 * The diff files for one chapter: each file the chapter references, narrowed to
 * just the hunks it cites. Files/hunks not present in the patch are skipped.
 */
export function selectChapterFiles(chapter: Chapter, files: HunkDiffFile[]): ChapterDiffFile[] {
	const oldStartsByPath = new Map<string, Set<number>>();
	for (const ref of chapter.hunkRefs) {
		const set = oldStartsByPath.get(ref.filePath) ?? new Set<number>();
		set.add(ref.oldStart);
		oldStartsByPath.set(ref.filePath, set);
	}

	const selected: ChapterDiffFile[] = [];
	for (const [filePath, oldStarts] of oldStartsByPath) {
		const file = files.find((f) => f.path === filePath || f.metadata.name === filePath);
		if (!file) continue;

		const meta = file.metadata as MetadataWithHunks;
		const hunks = (meta.hunks ?? []).filter((h) => oldStarts.has(h.deletionStart));
		if (hunks.length === 0) continue;

		selected.push({
			...file,
			chapterPath: filePath,
			metadata: { ...meta, hunks } as FileDiffMetadata,
		});
	}
	return selected;
}

export function hunkIndexForLineRef(file: HunkDiffFileInput, ref: LineRef): number {
	return file.metadata.hunks.findIndex((hunk) => {
		const start = ref.side === "additions" ? hunk.additionStart : hunk.deletionStart;
		const count = ref.side === "additions" ? hunk.additionCount : hunk.deletionCount;
		if (count === 0) return false;
		const end = start + count - 1;
		return ref.startLine <= end && ref.endLine >= start;
	});
}

export interface FileStat {
	additions: number;
	deletions: number;
}

/** Per-path add/delete counts from a parsed patch, for the chapter file list. */
export function statsByPath(files: HunkDiffFile[]): Map<string, FileStat> {
	const map = new Map<string, FileStat>();
	for (const f of files) {
		const path = f.path ?? f.metadata.name;
		map.set(path, { additions: f.stats.additions, deletions: f.stats.deletions });
	}
	return map;
}
