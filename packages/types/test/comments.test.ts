import { expect, test } from "bun:test";
import { COMMENT_STATUS, revueCommentSchema } from "../src/comments.ts";

const comment = {
	id: "00000000-0000-4000-8000-000000000001",
	runId: "a".repeat(64),
	anchor: {
		filePath: "src/value.ts",
		oldStart: 4,
		side: "additions" as const,
		startLine: 8,
		endLine: 10,
	},
	body: "Review this range",
	status: COMMENT_STATUS.OPEN,
	createdAt: "2026-08-02T10:00:00.000Z",
};

test("comment bodies reject terminal control sequences", () => {
	expect(() => revueCommentSchema.parse({ ...comment, body: "unsafe\u001b[31mred" })).toThrow(
		"terminal control",
	);
});
