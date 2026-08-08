import { expect, test } from "bun:test";
import { chapterSchema, contextExcerptSchema, keyChangeSchema } from "../src/chapters.ts";
import { partialDepthLabel, RevueChaptersFileSchema } from "../src/file.ts";

const keyChange = {
	content: "Should this retry budget be shared?",
	lineRefs: [
		{
			filePath: "src/retry.ts",
			side: "additions" as const,
			startLine: 4,
			endLine: 6,
		},
	],
};

test("key changes carry explicit severity while old runs default to info", () => {
	expect(keyChangeSchema.parse(keyChange).severity).toBe("info");
	expect(keyChangeSchema.parse({ ...keyChange, severity: "high" }).severity).toBe("high");
});

test("an excerpt citation quotes a forward line range and carries no code", () => {
	const excerpt = { filePath: "src/api/client.ts", startLine: 118, endLine: 140 };

	expect(contextExcerptSchema.parse(excerpt)).toEqual(excerpt);
	expect(
		contextExcerptSchema.parse({ ...excerpt, caption: "the caller this must satisfy" }),
	).toEqual({ ...excerpt, caption: "the caller this must satisfy" });
	expect(contextExcerptSchema.safeParse({ ...excerpt, endLine: 117 }).success).toBe(false);
	expect(contextExcerptSchema.safeParse({ ...excerpt, startLine: 0 }).success).toBe(false);
	expect(contextExcerptSchema.safeParse({ ...excerpt, startLine: 1.5 }).success).toBe(false);
	// Quoting is the CLI's job, so a citation carrying its own text is not a citation.
	expect(contextExcerptSchema.safeParse({ ...excerpt, lines: ["const x = 1;"] }).success).toBe(
		false,
	);
});

test("a chapter that cites nothing still has an excerpt list", () => {
	const chapter = {
		id: "chapter-1",
		order: 1,
		title: "Wire org ID through the API layer",
		summary: "The handlers thread it through to the client.",
		hunkRefs: [],
		keyChanges: [],
	};

	expect(chapterSchema.parse(chapter).excerpts).toEqual([]);
});

test("a narrative declares its depth, and an undeclared one is full", () => {
	const chapters = { chapters: [] };

	expect(partialDepthLabel(RevueChaptersFileSchema.parse(chapters))).toBeNull();
	expect(
		partialDepthLabel(RevueChaptersFileSchema.parse({ ...chapters, depth: { kind: "full" } })),
	).toBeNull();
	expect(
		partialDepthLabel(
			RevueChaptersFileSchema.parse({
				...chapters,
				depth: { kind: "partial", label: "10,000ft" },
			}),
		),
	).toBe("10,000ft");
	expect(
		partialDepthLabel(
			RevueChaptersFileSchema.parse({
				...chapters,
				depth: { kind: "partial", label: "just the API changes" },
			}),
		),
	).toBe("just the API changes");
	// A partial narrative that will not say what it left out is not a declaration.
	expect(
		RevueChaptersFileSchema.safeParse({ ...chapters, depth: { kind: "partial" } }).success,
	).toBe(false);
	expect(RevueChaptersFileSchema.safeParse({ ...chapters, depth: "10,000ft" }).success).toBe(false);
});
