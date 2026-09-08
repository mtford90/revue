import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest, type PreparedRun, writePreparedRun } from "@revue/prep";
import { type Chapter, emptyViewState, type RevueChaptersFile } from "@revue/types";
import { carryHunkProgress, openCodeReviewStore } from "./codeProgress.ts";
import {
	isChapterReviewed,
	isFileReviewed,
	openFileStore,
	runKey,
	toggleChapter,
	toggleFile,
	toggleHunk,
	toggleKeyChange,
} from "./viewState.ts";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const workspace = async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-code-progress-"));
	roots.push(root);
	return { path: join(root, "state.json"), runsDirectory: join(root, "runs") };
};
const ref = (oldStart: number, filePath = "a.ts") => ({ filePath, oldStart });
const id = (oldStart: number, filePath = "a.ts") => JSON.stringify([filePath, oldStart]);
const chapter = (name: string, starts: number[], extra: Partial<Chapter> = {}): Chapter => ({
	id: name,
	order: 1,
	title: name,
	summary: "Review the change",
	hunkRefs: starts.map((start) => ref(start)),
	keyChanges: [],
	excerpts: [],
	...extra,
});

/** A pinned two-sided patch, with deliberately separated original review units. */
const prepare = async (
	runsDirectory: string,
	changes: [number, string, string][],
	options: { supersedes?: string; day?: number; metadata?: boolean } = {},
): Promise<PreparedRun & { chapters: RevueChaptersFile | null }> => {
	const oldLines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
	const newLines = [...oldLines];
	for (const [start, before, after] of changes) {
		oldLines[start - 1] = before;
		newLines[start - 1] = after;
	}
	const oldBytes = new TextEncoder().encode(`${oldLines.join("\n")}\n`);
	const newBytes = new TextEncoder().encode(`${newLines.join("\n")}\n`);
	const oldBlob = digest(oldBytes);
	const newBlob = digest(newBytes);
	const patch = options.metadata
		? "diff --git a/a.ts b/a.ts\nold mode 100644\nnew mode 100755\n"
		: `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n${changes.map(([start, before, after]) => `@@ -${start} +${start} @@\n-${before}\n+${after}\n`).join("")}`;
	const sha = "a".repeat(40);
	const run = await writePreparedRun({
		runsDirectory,
		patch,
		hunks: "Pinned fixture units\n",
		blobs: new Map([
			[oldBlob, oldBytes],
			[newBlob, newBytes],
		]),
		createdAt: `2026-09-${String(options.day ?? 1).padStart(2, "0")}T00:00:00.000Z`,
		supersedes: options.supersedes,
		content: {
			schemaVersion: 1,
			scope: {
				mode: "committed",
				comparison: "direct",
				base: { ref: "main", sha },
				head: { ref: "HEAD", sha },
				mergeBaseSha: sha,
				oldEndpoint: { kind: "commit", revision: sha },
				newEndpoint: { kind: "commit", revision: sha },
			},
			files: [
				{
					path: "a.ts",
					previousPath: null,
					status: options.metadata ? "mode-changed" : "modified",
					oldBlob,
					newBlob,
					oldMode: "100644",
					newMode: options.metadata ? "100755" : "100644",
					oldKind: "file",
					newKind: "file",
					isBinary: false,
					hunks: changes.length,
					referenceStarts: options.metadata ? [0] : changes.map(([start]) => start),
					additions: changes.length,
					deletions: changes.length,
				},
			],
			commits: [],
			exclusions: [],
			totals: {
				files: 1,
				hunks: changes.length,
				additions: changes.length,
				deletions: changes.length,
				excluded: 0,
				reviewUnits: options.metadata ? 1 : changes.length,
			},
		},
	});
	return { ...run, chapters: null };
};
const narrate = async (run: PreparedRun, chapters: Chapter[]) => {
	const file = { chapters };
	await writeFile(join(run.directory, "chapters.json"), JSON.stringify(file));
	return { ...run, chapters: file };
};
const changes: [number, string, string][] = [
	[10, "before alpha", "after alpha"],
	[70, "before beta", "after beta"],
];

test("partial original-hunk marks derive chapter-local and whole-file completion without checking questions", async () => {
	const workspaceOptions = await workspace();
	const run = await prepare(workspaceOptions.runsDirectory, changes);
	const first = chapter("first", [10]);
	const second = chapter("second", [70]);
	const whole = chapter("__files__", [10, 70]);
	const store = await openCodeReviewStore({ ...workspaceOptions, run });
	let state = toggleHunk(store.get(), ref(10));
	expect(isChapterReviewed(state, first)).toBe(true);
	expect(isFileReviewed(state, second, "a.ts")).toBe(false);
	expect(isFileReviewed(state, whole, "a.ts")).toBe(false);
	state = toggleFile(state, second, "a.ts");
	expect(isChapterReviewed(state, whole)).toBe(true);
	state = toggleFile(state, first, "a.ts");
	expect(state.hunks).toEqual([id(70)]);
	state = toggleChapter(state, whole);
	expect(state.hunks).toEqual([id(70), id(10)]);
	expect(state.keyChanges).toEqual([]);
	const epilogue = { ...whole, role: "epilogue" as const };
	expect(isChapterReviewed(state, epilogue)).toBe(true);
	const interlude = chapter("interlude", [], {
		excerpts: [{ filePath: "caller.ts", startLine: 1, endLine: 2 }],
	});
	expect(isChapterReviewed(state, interlude)).toBe(false);
	expect(isChapterReviewed(toggleChapter(state, interlude), interlude)).toBe(true);
	expect(toggleFile(state, interlude, "caller.ts").hunks).toEqual(state.hunks);
});

test("rewording, reordering, regrouping and flat/narrated switches share code but not question ticks or position", async () => {
	const options = await workspace();
	const prepared = await prepare(options.runsDirectory, changes);
	const beat = chapter("first", [10, 70]);
	const run = await narrate(prepared, [beat]);
	const store = await openCodeReviewStore({ ...options, run });
	store.set(toggleKeyChange(toggleHunk(store.get(), ref(10)), beat, 0));
	store.setSession({ pageId: beat.id, pages: {} });
	const rewritten = await narrate(prepared, [
		chapter("new-beta", [70]),
		chapter("new-alpha", [10], { order: 2, summary: "Reworded" }),
	]);
	expect(runKey(run.manifest.runId, run.chapters)).not.toBe(
		runKey(run.manifest.runId, rewritten.chapters),
	);
	const reopened = await openCodeReviewStore({ ...options, run: rewritten });
	expect(reopened.get().hunks).toEqual([id(10)]);
	expect(reopened.get().keyChanges).toEqual([]);
	expect(reopened.getSession().pageId).toBeUndefined();
	const flat = await openCodeReviewStore({ ...options, run: prepared });
	expect(flat.get().hunks).toEqual([id(10)]);
	flat.set(toggleHunk(flat.get(), ref(70)));
	const original = await openCodeReviewStore({ ...options, run });
	expect(original.get().hunks).toEqual([id(10), id(70)]);
	expect(original.get().keyChanges).toEqual(["first#0"]);
	expect(original.getSession().pageId).toBe("first");
});

test("carry keeps only uniquely identical units, including moved hunks in a partly changed file", async () => {
	const { runsDirectory } = await workspace();
	const previous = await prepare(runsDirectory, changes);
	const next = await prepare(runsDirectory, [
		[15, "before alpha", "after alpha"],
		[75, "before beta", "fixed beta"],
	]);
	expect(carryHunkProgress(previous, next, [id(10), id(70)])).toEqual([id(15)]);
	const duplicates = await prepare(runsDirectory, [
		[10, "same", "edit"],
		[70, "same", "edit"],
	]);
	const one = await prepare(runsDirectory, [[20, "same", "edit"]]);
	expect(carryHunkProgress(duplicates, one, [id(10)])).toEqual([]);
	expect(carryHunkProgress(one, duplicates, [id(20)])).toEqual([]);
	expect(carryHunkProgress(duplicates, duplicates, [id(10)])).toEqual([id(10)]);
	// A modified earlier unit cannot greedily consume the later unit's exact match.
	const displaced = await prepare(runsDirectory, [
		[10, "before alpha", "different"],
		[80, "before alpha", "after alpha"],
	]);
	expect(carryHunkProgress(previous, displaced, [id(10)])).toEqual([id(80)]);
});

test("metadata-only units are actionable and changed metadata is unread", async () => {
	const options = await workspace();
	const run = await prepare(options.runsDirectory, [], { metadata: true });
	const store = await openCodeReviewStore({ ...options, run });
	const metadata = chapter("mode", [0]);
	store.set(toggleHunk(store.get(), ref(0)));
	expect(isFileReviewed(store.get(), metadata, "a.ts")).toBe(true);
	const changed = {
		...run,
		manifest: {
			...run.manifest,
			runId: "f".repeat(64),
			files: run.manifest.files.map((file) => ({ ...file, newMode: "100744" })),
		},
	};
	expect(carryHunkProgress(run, changed, store.get().hunks ?? [])).toEqual([]);
});

test("legacy chapter-local file migration never marks a different chapter's hunk and cannot reseed a manual clear", async () => {
	const options = await workspace();
	const prepared = await prepare(options.runsDirectory, changes);
	const first = chapter("first", [10]);
	const interlude = chapter("note", []);
	const run = await narrate(prepared, [first, chapter("second", [70]), interlude]);
	const legacy = await openFileStore(options.path, runKey(run.manifest.runId, run.chapters));
	legacy.set({
		chapters: ["note"],
		files: ["first::a.ts", "unknown::a.ts"],
		keyChanges: ["first#0"],
	});
	const migrated = await openCodeReviewStore({ ...options, run });
	expect(migrated.get()).toEqual({
		chapters: ["note"],
		files: [],
		keyChanges: ["first#0"],
		hunks: [id(10)],
	});
	migrated.set({ ...migrated.get(), hunks: [] });
	const reopened = await openCodeReviewStore({ ...options, run });
	expect(reopened.get().hunks).toEqual([]);
	expect(reopened.get().keyChanges).toEqual(["first#0"]);
	const disk = JSON.parse(await readFile(options.path, "utf8"));
	expect(disk[runKey(run.manifest.runId, run.chapters)].hunks).toBeUndefined();
});

test("legacy flat marks migrate once, but a saved empty narration destination is authoritative", async () => {
	const options = await workspace();
	const prepared = await prepare(options.runsDirectory, changes);
	const flat = await openFileStore(options.path, runKey(prepared.manifest.runId, null));
	flat.set({ ...emptyViewState(), files: ["__files__::a.ts"] });
	const run = await narrate(prepared, [chapter("all", [10, 70])]);
	const migrated = await openCodeReviewStore({ ...options, run });
	expect(migrated.get().hunks).toEqual([id(10), id(70)]);
	const other = await workspace();
	await writeFile(
		other.path,
		JSON.stringify({
			[runKey(run.manifest.runId, null)]: { ...emptyViewState(), chapters: ["__files__"] },
			[runKey(run.manifest.runId, run.chapters)]: emptyViewState(),
		}),
	);
	expect((await openCodeReviewStore({ ...other, run })).get().hunks).toEqual([]);
});

test("narrated A to pending flat B to narrated C uses B's initialized progress, including manual unread, after reopen", async () => {
	for (const clearAll of [false, true]) {
		const options = await workspace();
		const a = await narrate(await prepare(options.runsDirectory, changes), [
			chapter("original", [10, 70]),
		]);
		const aStore = await openCodeReviewStore({ ...options, run: a });
		aStore.set(toggleChapter(aStore.get(), a.chapters.chapters[0] as Chapter));
		const b = await prepare(options.runsDirectory, [...changes, [90, "new before", "new after"]], {
			supersedes: a.manifest.runId,
			day: 2,
		});
		const bStore = await openCodeReviewStore({ ...options, run: b });
		expect(bStore.get().hunks).toEqual([id(10), id(70)]);
		bStore.set({ ...bStore.get(), hunks: clearAll ? [] : [id(70), id(90)] });
		expect((await openCodeReviewStore({ ...options, run: b })).get().hunks).toEqual(
			clearAll ? [] : [id(70), id(90)],
		);
		const c = await narrate(
			await prepare(
				options.runsDirectory,
				[
					[15, "before alpha", "after alpha"],
					[75, "before beta", "after beta"],
					[95, "new before", "new after"],
				],
				{ supersedes: a.manifest.runId, day: 3 },
			),
			[chapter("regrouped", [15, 75, 95])],
		);
		const cStore = await openCodeReviewStore({ ...options, run: c, previous: a });
		expect(cStore.get().hunks).toEqual(clearAll ? [] : [id(75), id(95)]);
		cStore.set({ ...cStore.get(), hunks: [] });
		expect((await openCodeReviewStore({ ...options, run: c })).get().hunks).toEqual([]);
	}
});

test("flat-only reload carries persist across reopen without a narrated lineage", async () => {
	const options = await workspace();
	const a = await prepare(options.runsDirectory, changes);
	const aStore = await openCodeReviewStore({ ...options, run: a });
	aStore.set(toggleHunk(aStore.get(), ref(10)));
	const b = await prepare(
		options.runsDirectory,
		[
			[15, "before alpha", "after alpha"],
			[75, "before beta", "fixed beta"],
		],
		{ day: 2 },
	);
	const bStore = await openCodeReviewStore({ ...options, run: b, previous: a });
	expect(bStore.get().hunks).toEqual([id(15)]);
	const reopened = await openCodeReviewStore({ ...options, run: b });
	expect(reopened.get().hunks).toEqual([id(15)]);
	reopened.set({ ...reopened.get(), hunks: [] });
	expect((await openCodeReviewStore({ ...options, run: b, previous: a })).get().hunks).toEqual([]);
});

test("pending progress does not cross a different narrated branch of the selected ancestor", async () => {
	const options = await workspace();
	const a = await narrate(await prepare(options.runsDirectory, changes), [chapter("a", [10, 70])]);
	const aStore = await openCodeReviewStore({ ...options, run: a });
	aStore.set(toggleHunk(aStore.get(), ref(10)));
	// D is narrated but never opened: E's persisted flat continuation must not skip this
	// immutable branch boundary when C later continues A.
	const d = await narrate(
		await prepare(options.runsDirectory, [...changes, [80, "d", "D"]], {
			supersedes: a.manifest.runId,
			day: 2,
		}),
		[chapter("d", [10, 70, 80])],
	);
	const e = await prepare(options.runsDirectory, [...changes, [90, "e", "E"]], {
		supersedes: d.manifest.runId,
		day: 3,
	});
	const eStore = await openCodeReviewStore({ ...options, run: e });
	eStore.set({ ...eStore.get(), hunks: [id(90)] });
	const selected = await prepare(
		options.runsDirectory,
		[...changes, [90, "e", "E"], [95, "c", "C"]],
		{
			supersedes: a.manifest.runId,
			day: 4,
		},
	);
	expect((await openCodeReviewStore({ ...options, run: selected })).get().hunks).toEqual([id(10)]);
});

test("a later flat reload discovers reopened pending progress only through persisted continuation", async () => {
	for (const marks of [[id(70)], []]) {
		const options = await workspace();
		const a = await prepare(options.runsDirectory, changes);
		const aStore = await openCodeReviewStore({ ...options, run: a });
		aStore.set(toggleHunk(aStore.get(), ref(10)));
		const b = await prepare(options.runsDirectory, [...changes, [90, "b", "B"]], { day: 2 });
		await openCodeReviewStore({ ...options, run: b, previous: a });
		const reopened = await openCodeReviewStore({ ...options, run: b });
		reopened.set({ ...reopened.get(), hunks: marks });
		const c = await prepare(options.runsDirectory, [...changes, [95, "c", "C"]], { day: 3 });
		// Neither immutable manifest links B to A. No live B is passed to this fresh opening.
		expect(b.manifest.supersedes).toBeUndefined();
		expect(c.manifest.supersedes).toBeUndefined();
		expect((await openCodeReviewStore({ ...options, run: c, previous: a })).get().hunks).toEqual(
			marks,
		);
	}
});
