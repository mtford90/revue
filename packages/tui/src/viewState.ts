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
	viewStateFileId,
	viewStateKeyChangeId,
} from "@revue/types";
import { z } from "zod";

/** Distinct file paths a chapter touches, in first-seen order. */
export function chapterFilePaths(chapter: Chapter): string[] {
	return [...new Set(chapter.hunkRefs.map((h) => h.filePath))];
}

// ── Queries ─────────────────────────────────────────────────────────────────
export const isChapterReviewed = (vs: ViewState, chapterId: string) =>
	vs.chapters.includes(chapterId);

export const isFileReviewed = (vs: ViewState, chapterId: string, filePath: string) =>
	vs.files.includes(viewStateFileId(chapterId, filePath));

export const isKeyChangeChecked = (vs: ViewState, chapterId: string, index: number) =>
	vs.keyChanges.includes(viewStateKeyChangeId(chapterId, index));

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
	const ids = chapterFilePaths(chapter).map((p) => viewStateFileId(chapter.id, p));
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
	const files = toggleMember(vs.files, viewStateFileId(chapter.id, filePath));
	const allReviewed = chapterFilePaths(chapter).every((p) =>
		files.includes(viewStateFileId(chapter.id, p)),
	);
	let chapters = vs.chapters;
	if (allReviewed && !chapters.includes(chapter.id)) chapters = [...chapters, chapter.id];
	if (!allReviewed && chapters.includes(chapter.id))
		chapters = chapters.filter((c) => c !== chapter.id);
	return { ...vs, files, chapters };
}

export function toggleKeyChange(vs: ViewState, chapter: Chapter, index: number): ViewState {
	return {
		...vs,
		keyChanges: toggleMember(vs.keyChanges, viewStateKeyChangeId(chapter.id, index)),
	};
}

// ── Persistence ──────────────────────────────────────────────────────────────
/**
 * Review progress belongs to one pinned code snapshot narrated one specific way;
 * a chapterless run keys on the snapshot alone so its progress survives narration.
 */
export function runKey(runId: string, file: RevueChaptersFile | null): string {
	return createHash("sha256")
		.update(runId)
		.update("\0")
		.update(file ? JSON.stringify(file.chapters) : "chapterless")
		.digest("hex")
		.slice(0, 16);
}

export function defaultStatePath(): string {
	return join(process.cwd(), ".revue", "state.json");
}

const ReviewPageStateSchema = z.object({
	selectedFile: z.number().int().nonnegative(),
	selectedHunk: z.number().int().nonnegative(),
	selectedKeyChange: z.number().int().nonnegative(),
	collapsedFiles: z.array(z.string()),
	scrollTop: z.number().nonnegative(),
	panelScrollTop: z.number().nonnegative(),
});

const ReviewSessionStateSchema = z.object({
	pageId: z.string().optional(),
	pages: z.record(z.string(), ReviewPageStateSchema).default({}),
});

export type ReviewSessionState = z.infer<typeof ReviewSessionStateSchema>;

export const emptyReviewSessionState = (): ReviewSessionState => ({ pages: {} });

export interface ViewStateStore {
	get(): ViewState;
	set(next: ViewState): void;
	getSession(): ReviewSessionState;
	setSession(next: ReviewSessionState): void;
}

/**
 * A store backed by a single JSON file holding `{ [runKey]: ViewState }`, so one repo
 * accumulates progress for many runs. Writes are synchronous because the file is tiny and
 * keystrokes are infrequent.
 */
export async function loadViewState(path: string, key: string): Promise<ViewState> {
	const all = await readAllRuns(path);
	return all[key] ? ViewStateSchema.parse(all[key]) : emptyViewState();
}

/** A newly narrated run starts from any progress made reviewing it chapterless. */
export async function openRunStateStore(
	path: string,
	runId: string,
	file: RevueChaptersFile | null,
): Promise<ViewStateStore> {
	const store = await openFileStore(path, runKey(runId, file));
	if (!file) return store;
	const state = store.get();
	if (state.chapters.length || state.files.length || state.keyChanges.length) return store;
	const flat = await loadViewState(path, runKey(runId, null));
	if (flat.chapters.length || flat.files.length) store.set(flat);
	return store;
}

export async function openFileStore(path: string, key: string): Promise<ViewStateStore> {
	const all = await readAllRuns(path);
	const stored = all[key];
	let current = stored ? ViewStateSchema.parse(stored) : emptyViewState();
	const storedSession =
		stored && typeof stored === "object" ? (stored as { session?: unknown }).session : undefined;
	let session = ReviewSessionStateSchema.parse(storedSession ?? {});
	const save = () => {
		all[key] = { ...current, session };
		persist(path, all);
	};

	return {
		get: () => current,
		set: (next) => {
			current = next;
			save();
		},
		getSession: () => session,
		setSession: (next) => {
			session = ReviewSessionStateSchema.parse(next);
			save();
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
