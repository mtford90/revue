import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	chapterSchema,
	contextExcerptSchema,
	isEpilogue,
	keyChangeSchema,
	threadReferences,
} from "../src/chapters.ts";
import { RevueChaptersFileSchema } from "../src/file.ts";

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

test("an epilogue says what it is and cites the threads it answers", () => {
	const chapter = {
		id: "epilogue",
		order: 4,
		title: "Changes since your review",
		summary: "The retry budget is now shared.",
		hunkRefs: [],
		keyChanges: [],
	};
	const threadId = randomUUID();

	// A chapter written before epilogues existed is unchanged by their arrival: no role, no
	// citations, and nothing added to what its progress is keyed on.
	const ordinary = chapterSchema.parse(chapter);
	expect(isEpilogue(ordinary)).toBe(false);
	expect(threadReferences(ordinary)).toEqual([]);
	expect(Object.hasOwn(ordinary, "role")).toBe(false);
	expect(Object.hasOwn(ordinary, "threadRefs")).toBe(false);

	const epilogue = chapterSchema.parse({
		...chapter,
		role: "epilogue",
		threadRefs: [threadId],
	});
	expect(isEpilogue(epilogue)).toBe(true);
	expect(threadReferences(epilogue)).toEqual([threadId]);

	expect(chapterSchema.safeParse({ ...chapter, role: "prologue" }).success).toBe(false);
	// Revue owns thread ids, so a citation that is not one cannot name a thread.
	expect(chapterSchema.safeParse({ ...chapter, threadRefs: ["thread-1"] }).success).toBe(false);
});

test("a chapters file declares no narrative depth", () => {
	const chapters = { chapters: [] };

	expect(RevueChaptersFileSchema.safeParse(chapters).success).toBe(true);
	expect(RevueChaptersFileSchema.safeParse({ ...chapters, depth: { kind: "full" } }).success).toBe(
		false,
	);
});
