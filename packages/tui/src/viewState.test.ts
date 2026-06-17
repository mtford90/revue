import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Chapter } from "@revue/types";
import { emptyViewState } from "@revue/types";
import {
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

test("runKey is stable for the same chapters and differs when they change", () => {
	const base = { chapters: [chapter("c1", 1, ["a"])] };
	const same = { chapters: [chapter("c1", 1, ["a"])] };
	const diff = { chapters: [chapter("c1", 1, ["b"])] };
	expect(runKey(base)).toBe(runKey(same));
	expect(runKey(base)).not.toBe(runKey(diff));
});

test("file store round-trips per run key and isolates runs", async () => {
	const dir = await mkdtemp(join(tmpdir(), "revue-vs-"));
	tmpDirs.push(dir);
	const path = join(dir, "state.json");

	const store = await openFileStore(path, "runA");
	store.set({ chapters: ["c1"], files: [], keyChanges: [] });

	// a second run in the same file must not see runA's progress
	const other = await openFileStore(path, "runB");
	expect(other.get()).toEqual(emptyViewState());

	// re-opening runA reads back what we wrote
	const reopened = await openFileStore(path, "runA");
	expect(reopened.get().chapters).toContain("c1");

	const onDisk = JSON.parse(await readFile(path, "utf8"));
	expect(onDisk.runA.chapters).toContain("c1");
});
