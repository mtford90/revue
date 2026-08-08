import { z } from "zod";

export const THREAD_STORE_SCHEMA_VERSION = 1 as const;
export const THREAD_STATUS = {
	OPEN: "open",
	DEALT_WITH: "dealt-with",
} as const;
export const THREAD_AUTHOR_KIND = {
	HUMAN: "human",
	AGENT: "agent",
} as const;
export const THREAD_ANCHOR_KIND = {
	HUNK: "hunk",
	EXCERPT: "excerpt",
} as const;

const runIdSchema = z.string().regex(/^[0-9a-f]{64}$/, "Expected a run ID");

const containsTerminalControl = (value: string): boolean =>
	[...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return (code < 0x20 && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
	});

const terminalSafeText = (label: string) =>
	z
		.string()
		.refine((value) => value.trim().length > 0, `${label} must not be blank`)
		.refine(
			(value) => !containsTerminalControl(value),
			`${label} must not contain terminal control characters`,
		);

const containsLineControl = (value: string): boolean =>
	[...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
	});

const terminalSafeName = terminalSafeText("Author name").refine(
	(value) => !containsLineControl(value),
	"Author name must be a single line without terminal control characters",
);

const orderedRange = { message: "Thread anchor startLine must not exceed endLine" };

/**
 * A thread anchored to one pinned git hunk. `kind` carries a default so anchors written before
 * excerpt threads existed keep parsing unchanged; everything written from now on states it.
 */
export const hunkThreadAnchorSchema = z
	.strictObject({
		kind: z.literal(THREAD_ANCHOR_KIND.HUNK).default(THREAD_ANCHOR_KIND.HUNK),
		filePath: z.string().min(1),
		oldStart: z.number().int().nonnegative(),
		side: z.enum(["additions", "deletions"]),
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
	})
	.refine((anchor) => anchor.startLine <= anchor.endLine, orderedRange);
export type HunkThreadAnchor = z.infer<typeof hunkThreadAnchorSchema>;

/**
 * A thread anchored to quoted unchanged code, keyed to the run and validated against the frozen
 * context rather than the patch. It deliberately carries no `oldStart`: zero is already the
 * metadata review unit's sentinel, so an excerpt anchor borrowing it would be indistinguishable
 * from a thread on a file with no textual hunk.
 */
export const excerptThreadAnchorSchema = z
	.strictObject({
		kind: z.literal(THREAD_ANCHOR_KIND.EXCERPT),
		filePath: z.string().min(1),
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
	})
	.refine((anchor) => anchor.startLine <= anchor.endLine, orderedRange);
export type ExcerptThreadAnchor = z.infer<typeof excerptThreadAnchorSchema>;

export const threadAnchorSchema = z.union([hunkThreadAnchorSchema, excerptThreadAnchorSchema]);
export type ThreadAnchor = z.infer<typeof threadAnchorSchema>;

export const isExcerptAnchor = (anchor: ThreadAnchor): anchor is ExcerptThreadAnchor =>
	anchor.kind === THREAD_ANCHOR_KIND.EXCERPT;

export const threadAuthorSchema = z.strictObject({
	kind: z.enum(THREAD_AUTHOR_KIND),
	name: terminalSafeName,
});
export type ThreadAuthor = z.infer<typeof threadAuthorSchema>;

export const threadMessageSchema = z.strictObject({
	id: z.uuid(),
	author: threadAuthorSchema,
	body: terminalSafeText("Thread message body"),
	createdAt: z.iso.datetime(),
});
export type ThreadMessage = z.infer<typeof threadMessageSchema>;

export const reviewThreadSchema = z
	.strictObject({
		id: z.uuid(),
		runId: runIdSchema,
		anchor: threadAnchorSchema,
		status: z.enum(THREAD_STATUS),
		createdAt: z.iso.datetime(),
		messages: z.array(threadMessageSchema).min(1),
	})
	.superRefine((thread, context) => {
		if (thread.messages[0]?.createdAt !== thread.createdAt) {
			context.addIssue({
				code: "custom",
				path: ["createdAt"],
				message: "Thread creation time must match its root message",
			});
		}
		const ids = new Set<string>();
		for (const [index, message] of thread.messages.entries()) {
			if (ids.has(message.id)) {
				context.addIssue({
					code: "custom",
					path: ["messages", index, "id"],
					message: "Message IDs must be unique within a thread",
				});
			}
			ids.add(message.id);
		}
	});
export type ReviewThread = z.infer<typeof reviewThreadSchema>;

export const threadStoreFileSchema = z
	.strictObject({
		schemaVersion: z.literal(THREAD_STORE_SCHEMA_VERSION),
		runs: z.record(runIdSchema, z.array(reviewThreadSchema)),
	})
	.superRefine((store, context) => {
		for (const [runId, threads] of Object.entries(store.runs)) {
			const ids = new Set<string>();
			for (const [index, thread] of threads.entries()) {
				if (thread.runId !== runId) {
					context.addIssue({
						code: "custom",
						path: ["runs", runId, index, "runId"],
						message: "Thread runId does not match its store key",
					});
				}
				if (ids.has(thread.id)) {
					context.addIssue({
						code: "custom",
						path: ["runs", runId, index, "id"],
						message: "Thread IDs must be unique within a run",
					});
				}
				ids.add(thread.id);
			}
		}
	});
export type ThreadStoreFile = z.infer<typeof threadStoreFileSchema>;

export const emptyThreadStoreFile = (): ThreadStoreFile => ({
	schemaVersion: THREAD_STORE_SCHEMA_VERSION,
	runs: {},
});
