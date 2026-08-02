import { expect, test } from "bun:test";
import {
	type RevueChaptersFile,
	RUN_FILE_STATUS,
	RUN_OBJECT_KIND,
	type RunFile,
	viewStateFileId,
	viewStateKeyChangeId,
} from "@revue/types";
import { formatMarkdownReview, MarkdownExportError, type MarkdownReview } from "../src/index.ts";

const runFile = (path: string, additions: number, deletions: number): RunFile => ({
	path,
	previousPath: null,
	status: RUN_FILE_STATUS.MODIFIED,
	oldBlob: "1".repeat(64),
	newBlob: "2".repeat(64),
	oldMode: "100644",
	newMode: "100644",
	oldKind: RUN_OBJECT_KIND.FILE,
	newKind: RUN_OBJECT_KIND.FILE,
	isBinary: false,
	hunks: 1,
	referenceStarts: [1],
	additions,
	deletions,
});

const chapters: RevueChaptersFile = {
	chapters: [
		{
			id: "later",
			order: 2,
			title: "Finish the workflow",
			summary: "Uses the foundation.",
			hunkRefs: [{ filePath: "src/later.ts", oldStart: 1 }],
			keyChanges: [],
		},
		{
			id: "foundation",
			order: 1,
			title: "Build the foundation",
			summary: "Makes the **core** behavior reusable.",
			hunkRefs: [{ filePath: "src/core.ts", oldStart: 1 }],
			keyChanges: [
				{
					content: "Is this the right public boundary?",
					lineRefs: [
						{
							filePath: "src/core.ts",
							side: "additions",
							startLine: 4,
							endLine: 6,
						},
					],
				},
			],
		},
	],
};

const review: MarkdownReview = {
	runId: "a".repeat(64),
	files: [runFile("src/core.ts", 8, 2), runFile("src/later.ts", 3, 0)],
	chapters,
};

test("full export is ordered and renders pinned counts with persisted review state", () => {
	const markdown = formatMarkdownReview(review, {
		viewState: {
			chapters: ["foundation"],
			files: [viewStateFileId("foundation", "src/core.ts")],
			keyChanges: [viewStateKeyChangeId("foundation", 0)],
		},
	});

	expect(markdown.indexOf("## Chapter 1: Build the foundation")).toBeLessThan(
		markdown.indexOf("## Chapter 2: Finish the workflow"),
	);
	expect(markdown).toContain(
		[
			"## Chapter 1: Build the foundation",
			"",
			"Chapter ID: `foundation`",
			"",
			"- [x] Chapter reviewed",
			"",
			"Makes the **core** behavior reusable.",
			"",
			"### Files",
			"",
			"- [x] `src/core.ts` — status: modified; file total: +8 / -2",
			"",
			"### Review questions",
			"",
			"1. [x] Is this the right public boundary?",
			"   - `src/core.ts` — additions lines 4-6",
		].join("\n"),
	);
	expect(formatMarkdownReview(review)).toContain("- [ ] Chapter reviewed");
	expect(formatMarkdownReview(review)).toBe(formatMarkdownReview(review));
});

test("prologue and chapter selections remain self-contained", () => {
	const withPrologue: MarkdownReview = {
		...review,
		chapters: {
			...chapters,
			prologue: {
				motivation: "Review context was hard to share.",
				outcome: "A portable review can be shared now.",
				diagram: null,
				keyChanges: [
					{ summary: "Export review context", description: "Preserves the pinned narrative." },
					{ summary: "Carry review progress", description: "Shows completed review work." },
				],
				focusAreas: [
					{
						type: "new-pattern",
						severity: "info",
						title: "Portable review",
						description: "Confirm the document reads well outside Revue.",
						locations: ["src/core.ts"],
					},
				],
				complexity: { level: "low", reasoning: "Formatting is isolated." },
			},
		},
	};

	const prologue = formatMarkdownReview(withPrologue, { selection: { kind: "prologue" } });
	expect(prologue).toContain("# Prologue\n");
	expect(prologue).toContain("## Overview");
	expect(prologue).toContain("## Focus areas");
	expect(prologue).not.toContain("Chapter 1");

	const chapter = formatMarkdownReview(withPrologue, {
		selection: { kind: "chapter-order", order: 2 },
	});
	expect(chapter).toContain("# Chapter 2: Finish the workflow");
	expect(chapter).not.toContain("# Prologue");
	expect(chapter).not.toContain("Build the foundation");

	expect(() =>
		formatMarkdownReview(withPrologue, { selection: { kind: "chapter-id", id: "missing" } }),
	).toThrow(MarkdownExportError);
});
