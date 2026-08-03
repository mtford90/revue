import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Chapter } from "@revue/types";
import { emptyViewState } from "@revue/types";
import {
	emptyReviewSessionState,
	isChapterReviewed,
	isFileReviewed,
	nextUnreviewedChapter,
	openFileStore,
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
				scrollTop: 27,
				panelScrollTop: 4,
			},
		},
	});

	const onDisk = JSON.parse(await readFile(path, "utf8"));
	expect(onDisk.runA.chapters).toContain("c1");
	expect(onDisk.runA.session.pages.c1.scrollTop).toBe(27);
});
