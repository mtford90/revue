import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type Chapter,
	emptyViewState,
	type HunkReference,
	isEpilogue,
	type RevueChaptersFile,
	type ViewState,
	ViewStateSchema,
	viewStateHunkId,
	viewStateKeyChangeId,
} from "@revue/types";
import { z } from "zod";

/** The synthetic chapter the flat "All files" page reviews under, narrated run or not. */
export const ALL_FILES_CHAPTER_ID = "__files__";

/** Distinct file paths a chapter touches, in first-seen order. */
export function chapterFilePaths(chapter: Chapter): string[] {
	return [...new Set(chapter.hunkRefs.map((h) => h.filePath))];
}

// ── Queries ─────────────────────────────────────────────────────────────────
export const isHunkReviewed = (vs: ViewState, reference: HunkReference): boolean =>
	vs.hunks?.includes(viewStateHunkId(reference.filePath, reference.oldStart)) ?? false;

export const isChapterReviewed = (vs: ViewState, chapter: Chapter): boolean =>
	chapter.hunkRefs.length
		? chapter.hunkRefs.every((reference) => isHunkReviewed(vs, reference))
		: vs.chapters.includes(chapter.id);

export const isFileReviewed = (vs: ViewState, chapter: Chapter, filePath: string): boolean => {
	const references = chapter.hunkRefs.filter((reference) => reference.filePath === filePath);
	return references.length > 0 && references.every((reference) => isHunkReviewed(vs, reference));
};

export const isKeyChangeChecked = (vs: ViewState, chapterId: string, index: number) =>
	vs.keyChanges.includes(viewStateKeyChangeId(chapterId, index));

export function reviewedChapterCount(vs: ViewState, chapters: Chapter[]): number {
	return chapters.filter((c) => isChapterReviewed(vs, c)).length;
}

/** The next chapter at or after `fromOrder` that isn't reviewed yet, wrapping once. */
export function nextUnreviewedChapter(
	chapters: Chapter[],
	vs: ViewState,
	fromOrder: number,
): Chapter | undefined {
	const ordered = [...chapters].sort((a, b) => a.order - b.order);
	const after = ordered.find((c) => c.order > fromOrder && !isChapterReviewed(vs, c));
	return after ?? ordered.find((c) => !isChapterReviewed(vs, c));
}

// ── Mutations (pure — return a new ViewState) ────────────────────────────────
function toggleMember(arr: string[], value: string): string[] {
	return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

const setHunksReviewed = (
	vs: ViewState,
	references: HunkReference[],
	reviewed: boolean,
): ViewState => {
	const ids = references.map((reference) =>
		viewStateHunkId(reference.filePath, reference.oldStart),
	);
	return {
		...vs,
		hunks: reviewed
			? [...new Set([...(vs.hunks ?? []), ...ids])]
			: (vs.hunks ?? []).filter((id) => !ids.includes(id)),
	};
};

/** Bulk-toggle exactly this chapter's original units; no-hunk narration remains explicit. */
export function toggleChapter(vs: ViewState, chapter: Chapter): ViewState {
	return chapter.hunkRefs.length
		? setHunksReviewed(vs, chapter.hunkRefs, !isChapterReviewed(vs, chapter))
		: { ...vs, chapters: toggleMember(vs.chapters, chapter.id) };
}

/** Bulk-toggle only the original units this chapter cites in the selected file. */
export function toggleFile(vs: ViewState, chapter: Chapter, filePath: string): ViewState {
	return setHunksReviewed(
		vs,
		chapter.hunkRefs.filter((reference) => reference.filePath === filePath),
		!isFileReviewed(vs, chapter, filePath),
	);
}

/** Toggle an original pinned review unit in place, independently of narrative questions. */
export function toggleHunk(vs: ViewState, reference: HunkReference): ViewState {
	return {
		...vs,
		hunks: toggleMember(vs.hunks ?? [], viewStateHunkId(reference.filePath, reference.oldStart)),
	};
}

export function toggleKeyChange(vs: ViewState, chapter: Chapter, index: number): ViewState {
	return {
		...vs,
		keyChanges: toggleMember(vs.keyChanges, viewStateKeyChangeId(chapter.id, index)),
	};
}

// ── Persistence ──────────────────────────────────────────────────────────────
/**
 * Narration-sensitive questions, explicit no-hunk marks and session position.
 * Code progress lives separately under the full immutable runId.
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
	// Excerpts are scenery, so their default is folded and the session records only the ones
	// the reviewer opened. An older saved page simply restores every excerpt folded.
	openExcerpts: z.array(z.string()).default([]),
	// A figure is usually the point of the prose beside it, so diagrams default open and the
	// session records only the ones the reviewer folded away.
	foldedDiagrams: z.array(z.string()).default([]),
	scrollTop: z.number().nonnegative(),
	panelScrollTop: z.number().nonnegative(),
});

export const ReviewSessionStateSchema = z.object({
	pageId: z.string().optional(),
	pages: z.record(z.string(), ReviewPageStateSchema).default({}),
});

export type ReviewSessionState = z.infer<typeof ReviewSessionStateSchema>;

export const emptyReviewSessionState = (): ReviewSessionState => ({ pages: {} });

/**
 * Where the reviewer lands when they follow the banner onto the run that continues their review.
 * The epilogue is the account of what changed since their last pass, so it is the re-entry point
 * rather than wherever they happened to be standing in the run it replaces.
 */
export const epilogueSession = (
	chapters: RevueChaptersFile | null,
): ReviewSessionState | undefined => {
	const epilogue = chapters?.chapters.find(isEpilogue);
	return epilogue ? { pageId: epilogue.id, pages: {} } : undefined;
};

export interface ViewStateStore {
	get(): ViewState;
	set(next: ViewState): void;
	getSession(): ReviewSessionState;
	setSession(next: ReviewSessionState): void;
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
