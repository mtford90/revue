import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { RevueChaptersFileSchema } from "@revue/types";
import { loadPreparedRun } from "../src/artifact.ts";
import { validateReviewCoverage } from "../src/coverage.ts";

const sampleDirectory = resolve(import.meta.dir, "../../../examples/sample-run");

const sample = async () => ({
	run: await loadPreparedRun(sampleDirectory),
	chapters: RevueChaptersFileSchema.parse(
		await Bun.file(resolve(sampleDirectory, "chapters.json")).json(),
	),
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
	const firstFile = run.manifest.files[0];
	if (!firstFile) throw new Error("Expected a sample run file");
	const duplicateManifest = {
		...run,
		manifest: { ...run.manifest, files: [...run.manifest.files, firstFile] },
	};
	expect(() => validateReviewCoverage(duplicateManifest, chapters)).toThrow(
		"duplicate run.json review unit",
	);
});

test("coverage validation rejects chapter identities that would corrupt review state", async () => {
	const { run, chapters } = await sample();
	const first = chapters.chapters[0];
	if (!first) throw new Error("Expected a sample chapter");
	const duplicated = { ...chapters, chapters: [...chapters.chapters, { ...first, hunkRefs: [] }] };

	expect(() => validateReviewCoverage(run, duplicated)).toThrow("duplicate chapter id");
	expect(() => validateReviewCoverage(run, duplicated)).toThrow("duplicate chapter order");
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
});
