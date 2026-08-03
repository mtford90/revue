import { expect, test } from "bun:test";
import { reviewThreadSchema, THREAD_AUTHOR_KIND, THREAD_STATUS } from "@revue/types/threads";

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
