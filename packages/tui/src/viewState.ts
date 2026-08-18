import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type Chapter,
	emptyViewState,
	type RevueChaptersFile,
	RevueChaptersFileSchema,
	type RunDeltaFile,
	type RunFile,
	type ViewState,
	ViewStateSchema,
	viewStateFileId,
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
	const paths = chapterFilePaths(chapter);
	// An interlude has no files to complete vacuously; only the mark-read key finishes it.
	if (!paths.length) return { ...vs, files };
	const allReviewed = paths.every((p) => files.includes(viewStateFileId(chapter.id, p)));
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

// ── Reload carry-over ────────────────────────────────────────────────────────
type ReviewedRun = { files: RunFile[]; chapters: RevueChaptersFile | null };

/** A file's diff identity: both frozen snapshots and how they relate. */
const fileSnapshot = (file: RunFile): string =>
	[file.status, file.previousPath, file.oldBlob, file.newBlob, file.oldMode, file.newMode].join(
		"\0",
	);

const flatChapter = (files: RunFile[]): Chapter => ({
	id: ALL_FILES_CHAPTER_ID,
	order: 0,
	title: "All files",
	summary: "",
	hunkRefs: files.map((file) => ({ filePath: file.path, oldStart: 0 })),
	keyChanges: [],
	excerpts: [],
});

/** Every surface a file can be marked reviewed on: each narrated chapter, plus the flat page. */
const reviewSurfaces = (run: ReviewedRun): Chapter[] => [
	...(run.chapters?.chapters ?? []),
	flatChapter(run.files),
];

/** Paths the reviewer marked reviewed, whichever surface they marked them on. */
const reviewedPaths = (run: ReviewedRun, state: ViewState): Set<string> =>
	new Set(
		reviewSurfaces(run).flatMap((chapter) =>
			chapterFilePaths(chapter).filter(
				(path) => isChapterReviewed(state, chapter.id) || isFileReviewed(state, chapter.id, path),
			),
		),
	);

/** Paths whose diff is identical in both runs; anything added, removed, or edited is absent. */
const unchangedPaths = (previous: RunFile[], next: RunFile[]): Set<string> => {
	const before = new Map(previous.map((file) => [file.path, fileSnapshot(file)]));
	const survived = next.filter((file) => before.get(file.path) === fileSnapshot(file));
	return new Set(survived.map((file) => file.path));
};

const markChapter = (
	state: ViewState,
	chapter: Chapter,
	isCarried: (path: string) => boolean,
): ViewState => {
	const paths = chapterFilePaths(chapter);
	const reviewed = paths.filter(isCarried);
	const done = paths.length > 0 && reviewed.length === paths.length;
	return {
		...state,
		chapters: done ? [...state.chapters, chapter.id] : state.chapters,
		files: [...state.files, ...reviewed.map((path) => viewStateFileId(chapter.id, path))],
	};
};

/**
 * Review progress for the run a reload just opened, carried over from the run it replaced.
 * A file keeps its mark only where its diff is unchanged, so an edited file comes back
 * unreviewed and takes its chapter with it. Key-change ticks are dropped: they answer
 * questions about a snapshot the reviewer has moved past.
 */
export function carryReviewProgress(args: {
	previous: ReviewedRun & { state: ViewState };
	next: ReviewedRun;
}): ViewState {
	const { previous, next } = args;
	const reviewed = reviewedPaths(previous, previous.state);
	const unchanged = unchangedPaths(previous.files, next.files);
	const isCarried = (path: string) => reviewed.has(path) && unchanged.has(path);
	return reviewSurfaces(next).reduce(
		(state, chapter) => markChapter(state, chapter, isCarried),
		emptyViewState(),
	);
}

// ── Supersession carry-over ──────────────────────────────────────────────────

/**
 * Whether the reviewer would be reading exactly what they already read. The delta pre-copies a
 * carried chapter with its references re-mapped, so what proves nothing was re-narrated is the
 * chapter the agent published matching that copy field for field — both come off the one schema,
 * which is what makes comparing their JSON meaningful.
 */
const carriedVerbatim = (carried: Chapter | undefined, published: Chapter): boolean =>
	carried !== undefined && JSON.stringify(carried) === JSON.stringify(published);

const keepChapterMarks = (state: ViewState, previous: ViewState, chapter: Chapter): ViewState => ({
	chapters: isChapterReviewed(previous, chapter.id)
		? [...state.chapters, chapter.id]
		: state.chapters,
	files: [
		...state.files,
		...chapterFilePaths(chapter)
			.filter((path) => isFileReviewed(previous, chapter.id, path))
			.map((path) => viewStateFileId(chapter.id, path)),
	],
	keyChanges: [
		...state.keyChanges,
		...chapter.keyChanges.flatMap((_, index) =>
			isKeyChangeChecked(previous, chapter.id, index)
				? [viewStateKeyChangeId(chapter.id, index)]
				: [],
		),
	],
});

/**
 * Review progress for a run that supersedes another. A chapter carried through the change verbatim
 * keeps every mark it had — including its answered questions, which are about code that came
 * through unchanged — while a stale, re-narrated or newly written chapter presents unread. The
 * epilogue is new by definition, so it is always the reviewer's next unread page.
 */
export function carrySupersededProgress(args: {
	previous: ViewState;
	carried: readonly Chapter[];
	chapters: RevueChaptersFile;
}): ViewState {
	const carried = new Map(args.carried.map((chapter) => [chapter.id, chapter]));
	return args.chapters.chapters
		.filter((chapter) => carriedVerbatim(carried.get(chapter.id), chapter))
		.reduce((state, chapter) => keepChapterMarks(state, args.previous, chapter), emptyViewState());
}

/**
 * The narration of the run this one supersedes, or null when it is not on disk. Progress keys on
 * the exact chapters a run was reviewed under, so only the predecessor's own file can name it.
 */
const supersededNarration = async (
	runsDirectory: string,
	runId: string,
): Promise<RevueChaptersFile | null> => {
	try {
		const raw = await readFile(join(runsDirectory, runId, "chapters.json"), "utf8");
		const parsed = RevueChaptersFileSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
};

/**
 * What the reviewer keeps when they move onto the run that continues their review, or undefined
 * when there is nothing to carry and the run should seed itself however it otherwise would.
 */
export async function supersededProgress(args: {
	statePath: string;
	runsDirectory: string;
	delta: RunDeltaFile;
	chapters: RevueChaptersFile;
}): Promise<ViewState | undefined> {
	if (!args.delta.carried.length) return undefined;
	const narration = await supersededNarration(args.runsDirectory, args.delta.supersedes);
	if (!narration) return undefined;
	const previous = await loadViewState(args.statePath, runKey(args.delta.supersedes, narration));
	const carried = carrySupersededProgress({
		previous,
		carried: args.delta.carried,
		chapters: args.chapters,
	});
	return hasProgress(carried) ? carried : undefined;
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
	// Excerpts are scenery, so their default is folded and the session records only the ones
	// the reviewer opened. An older saved page simply restores every excerpt folded.
	openExcerpts: z.array(z.string()).default([]),
	// A figure is usually the point of the prose beside it, so diagrams default open and the
	// session records only the ones the reviewer folded away.
	foldedDiagrams: z.array(z.string()).default([]),
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

const hasProgress = (state: ViewState): boolean =>
	state.chapters.length > 0 || state.files.length > 0 || state.keyChanges.length > 0;

/**
 * A newly narrated run starts from any progress made reviewing it chapterless; a run a reload
 * opened starts from the `carried` progress of the run it replaced. Either seed applies only to
 * a run nobody has reviewed yet, so returning to a started review never loses it.
 */
export async function openRunStateStore(
	path: string,
	runId: string,
	file: RevueChaptersFile | null,
	carried?: ViewState,
): Promise<ViewStateStore> {
	const store = await openFileStore(path, runKey(runId, file));
	if (hasProgress(store.get())) return store;
	const seed =
		carried ?? (file ? await loadViewState(path, runKey(runId, null)) : emptyViewState());
	if (hasProgress(seed)) store.set(seed);
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
