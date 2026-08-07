import { expect, test } from "bun:test";
import { keyChangeSchema } from "../src/chapters.ts";
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
