import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type Chapter,
	emptyViewState,
	type RevueChaptersFile,
	type ViewState,
	ViewStateSchema,
} from "@revue/types";

// ── Ids ─────────────────────────────────────────────────────────────────────
const fileId = (chapterId: string, filePath: string) => `${chapterId}::${filePath}`;
const keyChangeId = (chapterId: string, index: number) => `${chapterId}#${index}`;

/** Distinct file paths a chapter touches, in first-seen order. */
export function chapterFilePaths(chapter: Chapter): string[] {
	return [...new Set(chapter.hunkRefs.map((h) => h.filePath))];
}

// ── Queries ─────────────────────────────────────────────────────────────────
export const isChapterReviewed = (vs: ViewState, chapterId: string) =>
	vs.chapters.includes(chapterId);

export const isFileReviewed = (vs: ViewState, chapterId: string, filePath: string) =>
	vs.files.includes(fileId(chapterId, filePath));

export const isKeyChangeChecked = (vs: ViewState, chapterId: string, index: number) =>
	vs.keyChanges.includes(keyChangeId(chapterId, index));

export function reviewedChapterCount(vs: ViewState, chapters: Chapter[]): number {
	return chapters.filter((c) => isChapterReviewed(vs, c.id)).length;
}

/** The next chapter at or after `fromOrder` that isn't reviewed yet, wrapping once. */
export function nextUnreviewedChapter(
	chapters: Chapter[],
	vs: ViewState,
	fromOrder: number,
): Chapter | undefined {
	const ordered = [...chapters].sort((a, b) => a.order - b.order);
	const after = ordered.find((c) => c.order > fromOrder && !isChapterReviewed(vs, c.id));
	return after ?? ordered.find((c) => !isChapterReviewed(vs, c.id));
}

// ── Mutations (pure — return a new ViewState) ────────────────────────────────
function toggleMember(arr: string[], value: string): string[] {
	return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

/** Toggle a whole chapter. Marking it reviewed marks all its files too (and vice-versa). */
export function toggleChapter(vs: ViewState, chapter: Chapter): ViewState {
	const willReview = !isChapterReviewed(vs, chapter.id);
	const ids = chapterFilePaths(chapter).map((p) => fileId(chapter.id, p));
	return {
		...vs,
		chapters: toggleMember(vs.chapters, chapter.id),
		files: willReview
			? [...new Set([...vs.files, ...ids])]
			: vs.files.filter((f) => !ids.includes(f)),
	};
}

/** Toggle one file within a chapter; a chapter auto-(un)marks when all/not-all its files are reviewed. */
export function toggleFile(vs: ViewState, chapter: Chapter, filePath: string): ViewState {
	const files = toggleMember(vs.files, fileId(chapter.id, filePath));
	const allReviewed = chapterFilePaths(chapter).every((p) => files.includes(fileId(chapter.id, p)));
	let chapters = vs.chapters;
	if (allReviewed && !chapters.includes(chapter.id)) chapters = [...chapters, chapter.id];
	if (!allReviewed && chapters.includes(chapter.id))
		chapters = chapters.filter((c) => c !== chapter.id);
	return { ...vs, files, chapters };
}

export function toggleKeyChange(vs: ViewState, chapter: Chapter, index: number): ViewState {
	return { ...vs, keyChanges: toggleMember(vs.keyChanges, keyChangeId(chapter.id, index)) };
}

// ── Persistence ──────────────────────────────────────────────────────────────
/** Review progress belongs to one pinned code snapshot narrated one specific way. */
export function runKey(runId: string, file: RevueChaptersFile): string {
	return createHash("sha256")
		.update(runId)
		.update("\0")
		.update(JSON.stringify(file.chapters))
		.digest("hex")
		.slice(0, 16);
}

export function defaultStatePath(): string {
	return join(process.cwd(), ".revue", "state.json");
}

export interface ViewStateStore {
	get(): ViewState;
	set(next: ViewState): void;
}

/**
 * A store backed by a single JSON file holding `{ [runKey]: ViewState }`, so one repo
 * accumulates progress for many runs. Writes are synchronous because the file is tiny and
 * keystrokes are infrequent.
 */
export async function openFileStore(path: string, key: string): Promise<ViewStateStore> {
	const all = await readAllRuns(path);
	let current = all[key] ? ViewStateSchema.parse(all[key]) : emptyViewState();

	return {
		get: () => current,
		set: (next) => {
			current = next;
			all[key] = next;
			persist(path, all);
		},
	};
}

async function readAllRuns(path: string): Promise<Record<string, unknown>> {
	try {
		const parsed = JSON.parse(await readFile(path, "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function persist(path: string, all: Record<string, unknown>): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`, "utf8");
}
