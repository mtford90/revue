import { expect, test } from "bun:test";
import {
	reviewThreadSchema,
	THREAD_ANCHOR_KIND,
	THREAD_AUTHOR_KIND,
	THREAD_STATUS,
	THREAD_STORE_SCHEMA_VERSION,
	threadAnchorSchema,
	threadDisposition,
	threadStoreFileSchema,
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

test("agent reply intent is explicit and drives reviewer disposition", () => {
	const proposal = reviewThreadSchema.parse({
		...thread,
		messages: [{ ...thread.messages[0], intent: "proposal" }],
	});
	expect(threadDisposition(proposal)).toBe("awaiting-approval");
	const completed = reviewThreadSchema.parse({
		...proposal,
		messages: [{ ...proposal.messages[0], intent: "completed" }],
	});
	expect(threadDisposition(completed)).toBe("ready-to-verify");
	expect(threadDisposition(reviewThreadSchema.parse(thread))).toBe("awaiting-reviewer-legacy");
	expect(() =>
		reviewThreadSchema.parse({
			...thread,
			messages: [
				{ ...thread.messages[0], author: { kind: "human", name: "Ada" }, intent: "proposal" },
			],
		}),
	).toThrow("Only an agent reply");
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

	// Revealed context is the same shape as a quotation, resolved against the pinned file instead.
	const context = { ...excerpt, kind: THREAD_ANCHOR_KIND.CONTEXT };
	expect(threadAnchorSchema.parse(context)).toEqual(context);
	expect(() => threadAnchorSchema.parse({ ...context, oldStart: 0, side: "additions" })).toThrow();
	expect(() => threadAnchorSchema.parse({ ...context, endLine: 117 })).toThrow();
});

test("migrationOrphaned is a migration marker, never a general corruption escape hatch", () => {
	const patchAnchor = {
		kind: THREAD_ANCHOR_KIND.PATCH,
		filePath: "src/value.ts",
		ranges: [{ oldStart: 4, side: "additions", startLine: 8, endLine: 8 }],
	};
	const migratedFrom = "b".repeat(64);
	const migrated = { ...thread, anchor: patchAnchor, migratedFrom };
	expect(reviewThreadSchema.parse({ ...migrated, migrationOrphaned: true }).migrationOrphaned).toBe(
		true,
	);
	// A carried hunk anchor orphans the same way: supersession can delete the code either was on.
	expect(
		reviewThreadSchema.parse({ ...thread, migratedFrom, migrationOrphaned: true })
			.migrationOrphaned,
	).toBe(true);
	// So does a context anchor, whose pinned file the superseding run may have dropped or cut.
	const contextAnchor = {
		kind: THREAD_ANCHOR_KIND.CONTEXT,
		filePath: "src/value.ts",
		startLine: 8,
		endLine: 9,
	};
	expect(
		reviewThreadSchema.parse({
			...thread,
			anchor: contextAnchor,
			migratedFrom,
			migrationOrphaned: true,
		}).migrationOrphaned,
	).toBe(true);
	const excerptAnchor = {
		kind: THREAD_ANCHOR_KIND.EXCERPT,
		filePath: "src/value.ts",
		startLine: 8,
		endLine: 8,
	};
	expect(
		reviewThreadSchema.parse({
			...thread,
			anchor: excerptAnchor,
			migratedFrom,
			migrationOrphaned: true,
		}).migrationOrphaned,
	).toBe(true);
	for (const invalid of [
		{ ...migrated, migrationOrphaned: false },
		{ ...thread, anchor: excerptAnchor, migrationOrphaned: true },
		{ ...thread, anchor: patchAnchor, migrationOrphaned: true },
	]) {
		expect(() => reviewThreadSchema.parse(invalid)).toThrow();
	}
});

test("original evidence preserves raw code but rejects incomplete range evidence", () => {
	const originalEvidence = {
		runId: thread.runId,
		anchor: thread.anchor,
		lines: [["\tbefore\r", "\u001b[31mcode\u001b[0m", ""]],
	};
	expect(reviewThreadSchema.parse({ ...thread, originalEvidence }).originalEvidence?.lines).toEqual(
		originalEvidence.lines,
	);
	for (const lines of [[], [["only one line"]], [...originalEvidence.lines, ["extra range"]]]) {
		expect(() =>
			reviewThreadSchema.parse({ ...thread, originalEvidence: { ...originalEvidence, lines } }),
		).toThrow("every line of every anchor range");
	}
});

test("original evidence belongs to the authored anchor and keeps its authority after carry", () => {
	const anchor = threadAnchorSchema.parse(thread.anchor);
	const originalEvidence = { runId: thread.runId, anchor, lines: [["one", "two", "three"]] };
	const shifted = { ...anchor, oldStart: 14, startLine: 18, endLine: 20 };
	for (const evidence of [
		{ ...originalEvidence, runId: "b".repeat(64) },
		{ ...originalEvidence, anchor: shifted },
		{ ...originalEvidence, anchor: { ...anchor, side: "deletions" } },
	]) {
		expect(() => reviewThreadSchema.parse({ ...thread, originalEvidence: evidence })).toThrow(
			"Original evidence",
		);
	}
	const carried = {
		...thread,
		runId: "b".repeat(64),
		migratedFrom: thread.runId,
		anchor: shifted,
		originalEvidence,
	};
	expect(reviewThreadSchema.parse(carried).originalEvidence).toEqual(originalEvidence);
	for (const evidenceAnchor of [
		{ ...anchor, filePath: "src/unrelated.ts" },
		{ kind: "excerpt", filePath: anchor.filePath, startLine: 8, endLine: 10 },
		{ kind: "context", filePath: anchor.filePath, startLine: 8, endLine: 10 },
	]) {
		expect(() =>
			reviewThreadSchema.parse({
				...carried,
				originalEvidence: { ...originalEvidence, anchor: evidenceAnchor },
			}),
		).toThrow("Original evidence");
	}
});

test("version three writes intent while rejecting future store fields", () => {
	expect(THREAD_STORE_SCHEMA_VERSION).toBe(3);
	const runId = "a".repeat(64);
	const current = {
		schemaVersion: 3,
		runs: { [runId]: [reviewThreadSchema.parse(thread)] },
	};
	expect(threadStoreFileSchema.parse(current)).toEqual(current);
	expect(() => threadStoreFileSchema.parse({ ...current, schemaVersion: 2 })).toThrow();
	expect(() => threadStoreFileSchema.parse({ ...current, futureField: true })).toThrow();
});

test("segmented selections preserve every patch and old-side context authority", () => {
	const anchor = {
		kind: "selection",
		filePath: "src/value.ts",
		segments: [
			{ kind: "patch", oldStart: 4, side: "additions", startLine: 8, endLine: 8 },
			{ kind: "context", side: "deletions", startLine: 6, endLine: 7 },
		],
	};
	expect(threadAnchorSchema.parse(anchor)).toEqual(anchor);
	expect(
		reviewThreadSchema.parse({
			...thread,
			anchor,
			originalEvidence: { runId: thread.runId, anchor, lines: [["changed"], ["old", "context"]] },
		}).originalEvidence?.lines,
	).toEqual([["changed"], ["old", "context"]]);
	expect(() => threadAnchorSchema.parse({ ...anchor, segments: [] })).toThrow();
});

test("selection segments are canonicalized by authority and persisted disorder is rejected", () => {
	const anchor = {
		kind: "selection",
		filePath: "src/value.ts",
		segments: [
			{ kind: "context", side: "additions", startLine: 5, endLine: 5 },
			{ kind: "context", side: "additions", startLine: 6, endLine: 7 },
		],
	};
	expect(() => threadAnchorSchema.parse(anchor)).toThrow("not canonical");
	expect(
		threadAnchorSchema.parse({
			...anchor,
			segments: [{ kind: "context", side: "additions", startLine: 5, endLine: 7 }],
		}),
	).toMatchObject({ kind: "selection" });
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
