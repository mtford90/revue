import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
	type Chapter,
	type ReviewThread,
	type RevueChaptersFile,
	RevueChaptersFileSchema,
	type RunContextFile,
	type RunDeltaFile,
} from "@revue/types";
import { loadPreparedRun } from "../src/artifact.ts";
import { validateReviewCoverage } from "../src/coverage.ts";

const sampleDirectory = resolve(import.meta.dir, "../../../examples/sample-run");

const sample = async () => ({
	run: await loadPreparedRun(sampleDirectory),
	chapters: RevueChaptersFileSchema.parse(
		await Bun.file(resolve(sampleDirectory, "chapters.json")).json(),
	),
});

/** A delta that inherited narration, which is what makes a run owe the reviewer an epilogue. */
const continuing = (runId: string): RunDeltaFile => ({
	runId,
	supersedes: "a".repeat(64),
	carried: [],
	stale: [{ id: "chapter-1", title: "The client", reasons: ["review unit changed"] }],
	unnarrated: [],
});

const thread = (runId: string, id: string): ReviewThread => ({
	id,
	runId,
	anchor: {
		kind: "hunk",
		filePath: "src/lib/apiClient.ts",
		oldStart: 1,
		side: "additions",
		startLine: 1,
		endLine: 1,
	},
	status: "open",
	createdAt: "2024-01-01T00:00:00.000Z",
	messages: [
		{
			id: randomUUID(),
			author: { kind: "human", name: "Reviewer" },
			body: "Share the retry budget?",
			createdAt: "2024-01-01T00:00:00.000Z",
		},
	],
});

/** The narration a superseding run writes: the last chapter's hunks re-told as the epilogue. */
const withEpilogue = (chapters: RevueChaptersFile, overrides: Partial<Chapter> = {}) => {
	const replaced = chapters.chapters.at(-1);
	if (!replaced) throw new Error("Expected a sample chapter");
	return {
		...chapters,
		chapters: [
			...chapters.chapters.slice(0, -1),
			{
				id: "epilogue",
				order: replaced.order,
				title: "Changes since your review",
				summary: "The retry budget is shared now, as you asked.",
				role: "epilogue" as const,
				hunkRefs: replaced.hunkRefs,
				keyChanges: [],
				excerpts: [],
				...overrides,
			},
		],
	};
};

/** The same narration, declared as a deliberately incomplete one. */
const zoomedOut = (file: RevueChaptersFile): RevueChaptersFile => ({
	...file,
	depth: { kind: "partial", label: "10,000ft" },
});

test("coverage validation requires each prepared unit exactly once", async () => {
	const { run, chapters } = await sample();
	expect(() => validateReviewCoverage(run, chapters)).not.toThrow();
	const duplicated = {
		...chapters,
		chapters: chapters.chapters.map((chapter, index) => ({
			...chapter,
			hunkRefs: index === 0 ? [...chapter.hunkRefs, ...chapter.hunkRefs] : chapter.hunkRefs,
		})),
	};

	expect(() => validateReviewCoverage(run, duplicated)).toThrow("appears 2 times");
	expect(() => validateReviewCoverage(run, zoomedOut(duplicated))).toThrow("appears 2 times");
	const firstFile = run.manifest.files[0];
	if (!firstFile) throw new Error("Expected a sample run file");
	const duplicateManifest = {
		...run,
		manifest: { ...run.manifest, files: [...run.manifest.files, firstFile] },
	};
	expect(() => validateReviewCoverage(duplicateManifest, chapters)).toThrow(
		"duplicate run.json review unit",
	);
	expect(() => validateReviewCoverage(duplicateManifest, zoomedOut(chapters))).toThrow(
		"duplicate run.json review unit",
	);
});

test("only an explicitly partial depth may leave a prepared unit out", async () => {
	const { run, chapters } = await sample();
	const dropped = {
		...chapters,
		chapters: chapters.chapters.filter((chapter) => chapter.id !== "chapter-3"),
	};

	expect(() => validateReviewCoverage(run, dropped)).toThrow(
		'missing review unit "src/lib/apiClient.test.ts"@0',
	);
	expect(() => validateReviewCoverage(run, { ...dropped, depth: { kind: "full" } })).toThrow(
		'missing review unit "src/lib/apiClient.test.ts"@0',
	);
	expect(() => validateReviewCoverage(run, zoomedOut(dropped))).not.toThrow();
	expect(() =>
		validateReviewCoverage(run, {
			...dropped,
			depth: { kind: "partial", label: "just the API changes" },
		}),
	).not.toThrow();
});

test("coverage validation accepts an interlude, a chapter that cites no review units", async () => {
	const { run, chapters } = await sample();
	const withInterlude = {
		...chapters,
		chapters: [
			...chapters.chapters,
			{
				id: "interlude",
				order: chapters.chapters.length + 1,
				title: "Why the migration is staged",
				summary: "Prose only; the work it explains lands in the chapters around it.",
				hunkRefs: [],
				keyChanges: [],
				excerpts: [],
			},
		],
	};

	expect(() => validateReviewCoverage(run, withInterlude)).not.toThrow();
});

test("an excerpt citation is only valid once the CLI has frozen its content", async () => {
	const { run, chapters } = await sample();
	const excerpt = { filePath: "src/lib/untouched.ts", startLine: 10, endLine: 12 };
	const citing = {
		...chapters,
		chapters: chapters.chapters.map((chapter, index) =>
			index === 0 ? { ...chapter, excerpts: [excerpt] } : chapter,
		),
	};
	const context = (overrides: Partial<RunContextFile>): RunContextFile => ({
		runId: run.manifest.runId,
		source: { kind: "commit", revision: "f".repeat(40) },
		excerpts: [],
		unresolved: [],
		...overrides,
	});

	expect(() => validateReviewCoverage(run, citing)).toThrow(
		`excerpt "src/lib/untouched.ts" 10-12 has no frozen content; run \`revue context freeze ${run.directory}\``,
	);
	expect(() => validateReviewCoverage(run, citing, context({}))).toThrow("has no frozen content");
	expect(() =>
		validateReviewCoverage(
			run,
			citing,
			context({ excerpts: [{ ...excerpt, lines: ["a", "b", "c"], fileSha256: "0".repeat(64) }] }),
		),
	).not.toThrow();
});

test("coverage validation reports an excerpt citation that could not be resolved at all", async () => {
	const { run, chapters } = await sample();
	const excerpt = { filePath: "src/lib/untouched.ts", startLine: 400, endLine: 402 };
	const citing = {
		...chapters,
		chapters: chapters.chapters.map((chapter, index) =>
			index === 0 ? { ...chapter, excerpts: [excerpt] } : chapter,
		),
	};
	const frozen: RunContextFile = {
		runId: run.manifest.runId,
		source: { kind: "commit", revision: "f".repeat(40) },
		excerpts: [],
		unresolved: [{ ...excerpt, reason: "the file has 120 lines" }],
	};

	expect(() => validateReviewCoverage(run, citing, frozen)).toThrow(
		'excerpt "src/lib/untouched.ts" 400-402 could not be frozen: the file has 120 lines',
	);
});

test("coverage validation explains references to paths omitted during prep", async () => {
	const { run, chapters } = await sample();
	const first = chapters.chapters[0];
	if (!first) throw new Error("Expected a sample chapter");
	const omittedPath = "fixtures/generated.ts";
	const withOmittedReference = {
		...chapters,
		chapters: chapters.chapters.map((chapter, index) =>
			index === 0
				? {
						...chapter,
						hunkRefs: [...chapter.hunkRefs, { filePath: omittedPath, oldStart: 1 }],
					}
				: chapter,
		),
	};
	const withExclusion = {
		...run,
		manifest: {
			...run.manifest,
			exclusions: [
				...run.manifest.exclusions,
				{
					path: omittedPath,
					matchedPath: omittedPath,
					reason: "session-ignore" as const,
					pattern: "fixtures/**",
				},
			],
		},
	};

	expect(() => validateReviewCoverage(withExclusion, withOmittedReference)).toThrow(
		`prep omitted via --ignore pattern "fixtures/**"; regenerate chapters.json from this run's hunks.txt`,
	);
	expect(() => validateReviewCoverage(withExclusion, zoomedOut(withOmittedReference))).toThrow(
		`prep omitted via --ignore pattern "fixtures/**"`,
	);
});

test("coverage validation rejects a unit no prepared run has, at any depth", async () => {
	const { run, chapters } = await sample();
	const invented = {
		...chapters,
		chapters: chapters.chapters.map((chapter, index) =>
			index === 0
				? {
						...chapter,
						hunkRefs: [...chapter.hunkRefs, { filePath: "src/lib/ghost.ts", oldStart: 3 }],
					}
				: chapter,
		),
	};

	expect(() => validateReviewCoverage(run, invented)).toThrow("unknown review unit");
	expect(() => validateReviewCoverage(run, zoomedOut(invented))).toThrow("unknown review unit");
});

test("coverage validation rejects chapter identities that would corrupt review state", async () => {
	const { run, chapters } = await sample();
	const first = chapters.chapters[0];
	if (!first) throw new Error("Expected a sample chapter");
	const duplicated = { ...chapters, chapters: [...chapters.chapters, { ...first, hunkRefs: [] }] };

	expect(() => validateReviewCoverage(run, duplicated)).toThrow("duplicate chapter id");
	expect(() => validateReviewCoverage(run, duplicated)).toThrow("duplicate chapter order");
	expect(() => validateReviewCoverage(run, zoomedOut(duplicated))).toThrow("duplicate chapter id");
});

test("a narration continuing a narrated review has to end with an epilogue", async () => {
	const { run, chapters } = await sample();
	const delta = continuing(run.manifest.runId);

	expect(() => validateReviewCoverage(run, chapters, null, { delta, threads: [] })).toThrow(
		`supersedes narrated run ${delta.supersedes.slice(0, 12)} but no chapter has "role": "epilogue"`,
	);
	expect(() =>
		validateReviewCoverage(run, withEpilogue(chapters), null, { delta, threads: [] }),
	).not.toThrow();

	// A run that starts a lineage, and one continuing a predecessor nobody narrated, owe nothing.
	expect(() => validateReviewCoverage(run, chapters)).not.toThrow();
	expect(() =>
		validateReviewCoverage(run, chapters, null, {
			delta: { ...delta, stale: [] },
			threads: [],
		}),
	).not.toThrow();
});

test("the epilogue is one chapter and it ends the story", async () => {
	const { run, chapters } = await sample();
	const delta = continuing(run.manifest.runId);
	const narrated = withEpilogue(chapters);
	const twice = {
		...narrated,
		chapters: narrated.chapters.map((chapter, index) =>
			index === 0 ? { ...chapter, role: "epilogue" as const } : chapter,
		),
	};
	const outOfOrder = {
		...narrated,
		chapters: narrated.chapters.map((chapter) => ({
			...chapter,
			order: chapter.id === "epilogue" ? 1 : chapter.order + 1,
		})),
	};

	expect(() => validateReviewCoverage(run, twice, null, { delta, threads: [] })).toThrow(
		"2 chapters claim the epilogue role",
	);
	expect(() => validateReviewCoverage(run, outOfOrder, null, { delta, threads: [] })).toThrow(
		'epilogue "epilogue" is not the last chapter',
	);
});

test("narration may only cite threads the run actually holds", async () => {
	const { run, chapters } = await sample();
	const delta = continuing(run.manifest.runId);
	const threadId = randomUUID();
	const narrated = withEpilogue(chapters, { threadRefs: [threadId] });

	expect(() =>
		validateReviewCoverage(run, narrated, null, {
			delta,
			threads: [thread(run.manifest.runId, threadId)],
		}),
	).not.toThrow();
	expect(() => validateReviewCoverage(run, narrated, null, { delta, threads: [] })).toThrow(
		`chapter "epilogue" references thread ${threadId}, which this run does not have`,
	);
	// An unreadable thread store says nothing about the citation either way.
	expect(() => validateReviewCoverage(run, narrated, null, { delta, threads: null })).not.toThrow();
});

test("coverage validation keeps key-change ranges inside their chapter units", async () => {
	const { run, chapters } = await sample();
	const outside = {
		...chapters,
		chapters: chapters.chapters.map((chapter, chapterIndex) => ({
			...chapter,
			keyChanges: chapter.keyChanges.map((keyChange) => ({
				...keyChange,
				lineRefs:
					chapterIndex === 0
						? keyChange.lineRefs.map((reference) => ({
								...reference,
								startLine: 999,
								endLine: 999,
							}))
						: keyChange.lineRefs,
			})),
		})),
	};

	expect(() => validateReviewCoverage(run, outside)).toThrow("is outside the pinned hunks");
	expect(() => validateReviewCoverage(run, zoomedOut(outside))).toThrow(
		"is outside the pinned hunks",
	);
});
