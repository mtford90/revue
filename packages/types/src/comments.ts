import { z } from "zod";

export const COMMENT_STORE_SCHEMA_VERSION = 1 as const;
export const COMMENT_STATUS = {
	OPEN: "open",
	DEALT_WITH: "dealt-with",
} as const;

const runIdSchema = z.string().regex(/^[0-9a-f]{64}$/, "Expected a run ID");

const containsTerminalControl = (value: string): boolean =>
	[...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return (code < 0x20 && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
	});

export const commentAnchorSchema = z
	.strictObject({
		filePath: z.string().min(1),
		oldStart: z.number().int().nonnegative(),
		side: z.enum(["additions", "deletions"]),
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
	})
	.refine((anchor) => anchor.startLine <= anchor.endLine, {
		message: "Comment anchor startLine must not exceed endLine",
	});
export type CommentAnchor = z.infer<typeof commentAnchorSchema>;

export const revueCommentSchema = z.strictObject({
	id: z.uuid(),
	runId: runIdSchema,
	anchor: commentAnchorSchema,
	body: z
		.string()
		.refine((body) => body.trim().length > 0, "Comment body must not be blank")
		.refine(
			(body) => !containsTerminalControl(body),
			"Comment body must not contain terminal control characters",
		),
	status: z.enum(COMMENT_STATUS),
	createdAt: z.iso.datetime(),
});
export type RevueComment = z.infer<typeof revueCommentSchema>;

export const commentStoreFileSchema = z
	.strictObject({
		schemaVersion: z.literal(COMMENT_STORE_SCHEMA_VERSION),
		runs: z.record(runIdSchema, z.array(revueCommentSchema)),
	})
	.superRefine((store, context) => {
		for (const [runId, comments] of Object.entries(store.runs)) {
			const ids = new Set<string>();
			for (const [index, comment] of comments.entries()) {
				if (comment.runId !== runId) {
					context.addIssue({
						code: "custom",
						path: ["runs", runId, index, "runId"],
						message: "Comment runId does not match its store key",
					});
				}
				if (ids.has(comment.id)) {
					context.addIssue({
						code: "custom",
						path: ["runs", runId, index, "id"],
						message: "Comment IDs must be unique within a run",
					});
				}
				ids.add(comment.id);
			}
		}
	});
export type CommentStoreFile = z.infer<typeof commentStoreFileSchema>;

export const emptyCommentStoreFile = (): CommentStoreFile => ({
	schemaVersion: COMMENT_STORE_SCHEMA_VERSION,
	runs: {},
});
