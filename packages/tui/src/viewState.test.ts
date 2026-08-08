import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Chapter, RunFile } from "@revue/types";
import { emptyViewState, viewStateFileId } from "@revue/types";
import {
	ALL_FILES_CHAPTER_ID,
	carryReviewProgress,
	emptyReviewSessionState,
	isChapterReviewed,
	isFileReviewed,
	nextUnreviewedChapter,
	openFileStore,
	openRunStateStore,
	runKey,
	toggleChapter,
	toggleFile,
} from "./viewState.ts";

const chapter = (id: string, order: number, paths: string[]): Chapter => ({
	id,
	order,
	title: `Chapter ${order}`,
	summary: "s",
	hunkRefs: paths.map((filePath) => ({ filePath, oldStart: 0 })),
	keyChanges: [],
	excerpts: [],
});

const blob = (seed: string) => seed.repeat(64).slice(0, 64);

const runFile = (path: string, newBlobSeed: string): RunFile => ({
	path,
	previousPath: null,
	status: "modified",
	oldBlob: blob("0"),
	newBlob: blob(newBlobSeed),
	oldMode: "100644",
	newMode: "100644",
	oldKind: "file",
	newKind: "file",
	isBinary: false,
	hunks: 1,
	referenceStarts: [1],
	additions: 1,
	deletions: 0,
});

const tmpDirs: string[] = [];
afterAll(async () => {
	await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

test("marking all files in a chapter auto-completes the chapter; unmarking one reverts it", () => {
	const c = chapter("c1", 1, ["a.ts", "b.ts"]);
	let vs = emptyViewState();

	vs = toggleFile(vs, c, "a.ts");
	expect(isChapterReviewed(vs, "c1")).toBe(false); // only one of two files

	vs = toggleFile(vs, c, "b.ts");
	expect(isChapterReviewed(vs, "c1")).toBe(true); // both files -> chapter done

	vs = toggleFile(vs, c, "a.ts"); // un-review a file
	expect(isChapterReviewed(vs, "c1")).toBe(false); // chapter reverts
});

test("an interlude completes only on the explicit mark, never vacuously", () => {
	const c = chapter("interlude", 1, []);

	// No file of its own can complete it, and a stray file id must not either.
	expect(isChapterReviewed(toggleFile(emptyViewState(), c, "a.ts"), "interlude")).toBe(false);

	const marked = toggleChapter(emptyViewState(), c);
	expect(isChapterReviewed(marked, "interlude")).toBe(true);
	expect(isChapterReviewed(toggleChapter(marked, c), "interlude")).toBe(false);
});

test("toggling a chapter cascades to its files", () => {
	const c = chapter("c1", 1, ["a.ts", "b.ts"]);
	const vs = toggleChapter(emptyViewState(), c);
	expect(isFileReviewed(vs, "c1", "a.ts")).toBe(true);
	expect(isFileReviewed(vs, "c1", "b.ts")).toBe(true);
});

test("nextUnreviewedChapter skips reviewed ones and wraps", () => {
	const c1 = chapter("c1", 1, ["a"]);
	const c2 = chapter("c2", 2, ["b"]);
	const c3 = chapter("c3", 3, ["c"]);
	const chapters = [c1, c2, c3];
	const vs = toggleChapter(emptyViewState(), c2); // c2 reviewed

	expect(nextUnreviewedChapter(chapters, vs, 1)?.id).toBe("c3"); // after order 1, skip c2
	expect(nextUnreviewedChapter(chapters, vs, 3)?.id).toBe("c1"); // wraps past the end
});

test("runKey changes when either the pinned code or its narration changes", () => {
	const base = { chapters: [chapter("c1", 1, ["a"])] };
	const same = { chapters: [chapter("c1", 1, ["a"])] };
	const changedNarration = { chapters: [chapter("c1", 1, ["b"])] };
	expect(runKey("run-a", base)).toBe(runKey("run-a", same));
	expect(runKey("run-a", base)).not.toBe(runKey("run-a", changedNarration));
	expect(runKey("run-a", base)).not.toBe(runKey("run-b", base));
});

test("file store round-trips review progress and session position per run key", async () => {
	const dir = await mkdtemp(join(tmpdir(), "revue-vs-"));
	tmpDirs.push(dir);
	const path = join(dir, "state.json");

	const store = await openFileStore(path, "runA");
	store.set({ chapters: ["c1"], files: [], keyChanges: [] });
	store.setSession({
		pageId: "c1",
		pages: {
			c1: {
				selectedFile: 2,
				selectedHunk: 1,
				selectedKeyChange: 3,
				collapsedFiles: ["src/a.ts"],
				openExcerpts: ['["src/api/client.ts",118,140]'],
				foldedDiagrams: [],
				scrollTop: 27,
				panelScrollTop: 4,
			},
		},
	});

	// a second run in the same file must not see runA's progress
	const other = await openFileStore(path, "runB");
	expect(other.get()).toEqual(emptyViewState());
	expect(other.getSession()).toEqual(emptyReviewSessionState());

	const reopened = await openFileStore(path, "runA");
	expect(reopened.get().chapters).toContain("c1");
	expect(reopened.getSession()).toEqual({
		pageId: "c1",
		pages: {
			c1: {
				selectedFile: 2,
				selectedHunk: 1,
				selectedKeyChange: 3,
				collapsedFiles: ["src/a.ts"],
				openExcerpts: ['["src/api/client.ts",118,140]'],
				foldedDiagrams: [],
				scrollTop: 27,
				panelScrollTop: 4,
			},
		},
	});

	const onDisk = JSON.parse(await readFile(path, "utf8"));
	expect(onDisk.runA.chapters).toContain("c1");
	expect(onDisk.runA.session.pages.c1.scrollTop).toBe(27);
});

test("a chapterless run keys on the snapshot alone and seeds its later narration", async () => {
	const dir = await mkdtemp(join(tmpdir(), "revue-vs-flat-"));
	tmpDirs.push(dir);
	const path = join(dir, "state.json");
	const narrated = { chapters: [chapter("c1", 1, ["a.ts"])] };

	expect(runKey("run-a", null)).toBe(runKey("run-a", null));
	expect(runKey("run-a", null)).not.toBe(runKey("run-a", narrated));

	const flat = await openRunStateStore(path, "run-a", null);
	flat.set({ chapters: [], files: ["__files__::a.ts"], keyChanges: [] });

	// Narrating the same snapshot inherits the flat progress once, into its own slot.
	const upgraded = await openRunStateStore(path, "run-a", narrated);
	expect(upgraded.get().files).toContain("__files__::a.ts");

	// An already-started narrated review is left alone.
	upgraded.set({ chapters: ["c1"], files: [], keyChanges: [] });
	const reopened = await openRunStateStore(path, "run-a", narrated);
	expect(reopened.get()).toEqual({ chapters: ["c1"], files: [], keyChanges: [] });
});

test("a session saved before excerpts existed restores every excerpt folded", async () => {
	const dir = await mkdtemp(join(tmpdir(), "revue-vs-"));
	tmpDirs.push(dir);
	const path = join(dir, "state.json");
	await writeFile(
		path,
		JSON.stringify({
			runA: {
				chapters: [],
				files: [],
				keyChanges: [],
				session: {
					pageId: "c1",
					pages: {
						c1: {
							selectedFile: 0,
							selectedHunk: 0,
							selectedKeyChange: 0,
							collapsedFiles: [],
							scrollTop: 0,
							panelScrollTop: 0,
						},
					},
				},
			},
		}),
	);

	const store = await openFileStore(path, "runA");

	expect(store.getSession().pages.c1?.openExcerpts).toEqual([]);
	// Nothing was folded away either, so every figure draws.
	expect(store.getSession().pages.c1?.foldedDiagrams).toEqual([]);
});

test("a reload keeps marks on files whose diff is unchanged and drops the edited ones", () => {
	const previousFiles = [runFile("a.ts", "a"), runFile("b.ts", "b")];
	const state = {
		chapters: [ALL_FILES_CHAPTER_ID],
		files: [
			viewStateFileId(ALL_FILES_CHAPTER_ID, "a.ts"),
			viewStateFileId(ALL_FILES_CHAPTER_ID, "b.ts"),
		],
		keyChanges: [],
	};

	const carried = carryReviewProgress({
		previous: { files: previousFiles, chapters: null, state },
		next: { files: [runFile("a.ts", "a"), runFile("b.ts", "edited")], chapters: null },
	});

	expect(carried.files).toEqual([viewStateFileId(ALL_FILES_CHAPTER_ID, "a.ts")]);
	expect(carried.chapters).toEqual([]); // b.ts is unreviewed again, so the page isn't done
});

test("a reload carries narrated marks onto the flat page and drops stale key changes", () => {
	const c1 = chapter("c1", 1, ["a.ts", "b.ts"]);
	const state = { ...toggleChapter(emptyViewState(), c1), keyChanges: ["c1#0"] };

	const carried = carryReviewProgress({
		previous: {
			files: [runFile("a.ts", "a"), runFile("b.ts", "b")],
			chapters: { chapters: [c1] },
			state,
		},
		next: { files: [runFile("a.ts", "a"), runFile("b.ts", "edited")], chapters: null },
	});

	expect(carried).toEqual({
		chapters: [],
		files: [viewStateFileId(ALL_FILES_CHAPTER_ID, "a.ts")],
		keyChanges: [],
	});
});

test("a reload leaves a run the reviewer has already made progress on alone", async () => {
	const dir = await mkdtemp(join(tmpdir(), "revue-vs-carry-"));
	tmpDirs.push(dir);
	const path = join(dir, "state.json");
	const carried = {
		chapters: [],
		files: [viewStateFileId(ALL_FILES_CHAPTER_ID, "a.ts")],
		keyChanges: [],
	};

	const seeded = await openRunStateStore(path, "run-b", null, carried);
	expect(seeded.get()).toEqual(carried);

	// Reloading back onto a run reviewed earlier keeps that run's own progress.
	seeded.set({
		chapters: [],
		files: [viewStateFileId(ALL_FILES_CHAPTER_ID, "z.ts")],
		keyChanges: [],
	});
	const reopened = await openRunStateStore(path, "run-b", null, carried);
	expect(reopened.get().files).toEqual([viewStateFileId(ALL_FILES_CHAPTER_ID, "z.ts")]);
});
