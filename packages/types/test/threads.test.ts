import { expect, test } from "bun:test";
import {
	reviewThreadSchema,
	THREAD_ANCHOR_KIND,
	THREAD_AUTHOR_KIND,
	THREAD_STATUS,
	threadAnchorSchema,
} from "@revue/types/threads";

const thread = {
	id: "00000000-0000-4000-8000-000000000001",
	runId: "a".repeat(64),
	anchor: {
		filePath: "src/value.ts",
		oldStart: 4,
		side: "additions" as const,
		startLine: 8,
		endLine: 10,
	},
	status: THREAD_STATUS.OPEN,
	createdAt: "2026-08-02T10:00:00.000Z",
	messages: [
		{
			id: "00000000-0000-4000-8000-000000000002",
			author: { kind: THREAD_AUTHOR_KIND.AGENT, name: "Review agent" },
			body: "Review this range",
			createdAt: "2026-08-02T10:00:00.000Z",
		},
	],
};

test("thread bodies allow prose while author names remain terminal-safe single lines", () => {
	expect(() =>
		reviewThreadSchema.parse({
			...thread,
			messages: [{ ...thread.messages[0], body: "unsafe\u001b[31mred" }],
		}),
	).toThrow("terminal control");
	for (const name of ["unsafe\u001b[31magent", "Review agent\nHuman · Ada", "Review\tagent"]) {
		expect(() =>
			reviewThreadSchema.parse({
				...thread,
				messages: [
					{
						...thread.messages[0],
						author: { kind: THREAD_AUTHOR_KIND.AGENT, name },
					},
				],
			}),
		).toThrow("single line");
	}
	expect(
		reviewThreadSchema.parse({
			...thread,
			messages: [{ ...thread.messages[0], body: "First line\nSecond line\tindented" }],
		}).messages[0]?.body,
	).toBe("First line\nSecond line\tindented");
	expect(() =>
		reviewThreadSchema.parse({ ...thread, createdAt: "2026-08-02T10:00:01.000Z" }),
	).toThrow("root message");
});

test("an anchor states its kind, and a stored hunk anchor keeps parsing without one", () => {
	// The migration: anchors written before excerpt threads existed carry no discriminator.
	expect(threadAnchorSchema.parse(thread.anchor)).toEqual({
		kind: THREAD_ANCHOR_KIND.HUNK,
		...thread.anchor,
	});
	expect(reviewThreadSchema.parse(thread).anchor.kind).toBe(THREAD_ANCHOR_KIND.HUNK);

	const excerpt = {
		kind: THREAD_ANCHOR_KIND.EXCERPT,
		filePath: "src/api/client.ts",
		startLine: 118,
		endLine: 140,
	};
	expect(threadAnchorSchema.parse(excerpt)).toEqual(excerpt);
	// The hazard this discriminator exists for: an excerpt anchor must never be expressible as a
	// metadata review unit, whose sentinel is oldStart 0 on the very same path.
	expect(() => threadAnchorSchema.parse({ ...excerpt, oldStart: 0, side: "additions" })).toThrow();
	expect(() => threadAnchorSchema.parse({ ...excerpt, endLine: 117 })).toThrow();
	expect(() => threadAnchorSchema.parse({ ...excerpt, startLine: 0, endLine: 0 })).toThrow();
	expect(() => threadAnchorSchema.parse({ ...thread.anchor, kind: "narration" })).toThrow();
});

test("patch anchors are non-empty, file-scoped multi-ranges without changing old anchors", () => {
	const patch = {
		kind: THREAD_ANCHOR_KIND.PATCH,
		filePath: "src/value.ts",
		ranges: [
			{ oldStart: 4, side: "deletions", startLine: 8, endLine: 9 },
			{ oldStart: 20, side: "additions", startLine: 24, endLine: 24 },
		],
	};
	expect(threadAnchorSchema.parse(patch)).toEqual(patch);
	expect(() => threadAnchorSchema.parse({ ...patch, ranges: [] })).toThrow();
	expect(() =>
		threadAnchorSchema.parse({
			...patch,
			ranges: [{ oldStart: 4, side: "additions", startLine: 10, endLine: 9 }],
		}),
	).toThrow("must not exceed");

	// Backward compatibility is parse compatibility, not reinterpretation as a patch selection.
	expect(reviewThreadSchema.parse(thread).anchor).toMatchObject({
		kind: THREAD_ANCHOR_KIND.HUNK,
		oldStart: 4,
	});
});
