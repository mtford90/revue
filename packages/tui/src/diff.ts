import { readFile } from "node:fs/promises";
import {
	type DiffFile,
	type DiffFileInput,
	parsePatch,
	prepareSyntaxHighlighting,
	rangeToHunkIndex,
} from "@revue/diff-renderer";
import type { Chapter, LineRef } from "@revue/types";

// Bridges a chapters file to Revue's renderer: a chapter cites hunks by
// `(filePath, oldStart)`; Pierre parses a unified diff into files whose
// `metadata.hunks[].deletionStart` is that `oldStart`.

/** Parse and prepare a unified diff (e.g. `git diff` output) for terminal rendering. */
export async function loadPatch(path: string): Promise<DiffFile[]> {
	const text = await readFile(path, "utf8");
	const files = parsePatch(text);
	await prepareSyntaxHighlighting(files);
	return files;
}

/** A selected diff plus the exact chapter path that selected it. */
export type ChapterDiffFile = DiffFileInput & { chapterPath: string };

/**
 * The diff files for one chapter: each file the chapter references, narrowed to
 * just the hunks it cites. Files/hunks not present in the patch are skipped.
 */
export function selectChapterFiles(chapter: Chapter, files: DiffFile[]): ChapterDiffFile[] {
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

		const hunks = file.metadata.hunks.filter((hunk) => oldStarts.has(hunk.deletionStart));
		if (file.metadata.hunks.length > 0 && hunks.length === 0) continue;

		selected.push({
			...file,
			chapterPath: filePath,
			metadata: { ...file.metadata, hunks },
		});
	}
	return selected;
}

export function hunkIndexForLineRef(file: DiffFileInput, ref: LineRef): number {
	return rangeToHunkIndex(file, ref);
}

export interface FileStat {
	additions: number;
	deletions: number;
}

/** Per-path add/delete counts from a parsed patch, for the chapter file list. */
export function statsByPath(files: DiffFile[]): Map<string, FileStat> {
	const map = new Map<string, FileStat>();
	for (const f of files) {
		const path = f.path ?? f.metadata.name;
		map.set(path, { additions: f.stats.additions, deletions: f.stats.deletions });
	}
	return map;
}
