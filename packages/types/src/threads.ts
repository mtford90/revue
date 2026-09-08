import { z } from "zod";

export const THREAD_STORE_SCHEMA_VERSION = 3 as const;
export const HISTORICAL_THREAD_STORE_SCHEMA_VERSION = 1 as const;
export const PREVIOUS_THREAD_STORE_SCHEMA_VERSION = 2 as const;
export const THREAD_REPLY_INTENT = {
	PROPOSAL: "proposal",
	COMPLETED: "completed",
} as const;
export type ThreadReplyIntent = (typeof THREAD_REPLY_INTENT)[keyof typeof THREAD_REPLY_INTENT];
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
	PATCH: "patch",
	CONTEXT: "context",
} as const;

export type NonEmptyArray<Value> = [Value, ...Value[]];

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

/**
 * A thread anchored to unchanged code the reviewer revealed around a hunk. Like an excerpt it
 * names a new-side line range and no review unit, but it answers to the run's pinned new blob
 * rather than to the narration's frozen context: revealed lines are the file itself, not a quote.
 */
export const contextThreadAnchorSchema = z
	.strictObject({
		kind: z.literal(THREAD_ANCHOR_KIND.CONTEXT),
		filePath: z.string().min(1),
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
	})
	.refine((anchor) => anchor.startLine <= anchor.endLine, orderedRange);
export type ContextThreadAnchor = z.infer<typeof contextThreadAnchorSchema>;

export const patchThreadRangeSchema = z
	.strictObject({
		oldStart: z.number().int().nonnegative(),
		side: z.enum(["additions", "deletions"]),
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
	})
	.refine((range) => range.startLine <= range.endLine, orderedRange);
export type PatchThreadRange = z.infer<typeof patchThreadRangeSchema>;

/** A file-scoped selection over one or more independently authoritative original patch ranges. */
export const patchThreadAnchorSchema = z.strictObject({
	kind: z.literal(THREAD_ANCHOR_KIND.PATCH),
	filePath: z.string().min(1),
	ranges: z.tuple([patchThreadRangeSchema], patchThreadRangeSchema),
});
export type PatchThreadAnchor = z.infer<typeof patchThreadAnchorSchema>;

/** One side-authoritative part of a mixed changed/revealed selection. */
export const selectionThreadSegmentSchema = z.union([
	z
		.strictObject({ kind: z.literal(THREAD_ANCHOR_KIND.PATCH), ...patchThreadRangeSchema.shape })
		.refine((segment) => segment.startLine <= segment.endLine, orderedRange),
	z
		.strictObject({
			kind: z.literal(THREAD_ANCHOR_KIND.CONTEXT),
			side: z.enum(["additions", "deletions"]),
			startLine: z.number().int().positive(),
			endLine: z.number().int().positive(),
		})
		.refine((segment) => segment.startLine <= segment.endLine, orderedRange),
]);
export type SelectionThreadSegment = z.infer<typeof selectionThreadSegmentSchema>;

const selectionSegmentOrder = (
	left: SelectionThreadSegment,
	right: SelectionThreadSegment,
): number =>
	left.side.localeCompare(right.side) ||
	left.startLine - right.startLine ||
	left.endLine - right.endLine ||
	left.kind.localeCompare(right.kind) ||
	(left.kind === THREAD_ANCHOR_KIND.PATCH && right.kind === THREAD_ANCHOR_KIND.PATCH
		? left.oldStart - right.oldStart
		: 0);

const sameSelectionAuthority = (
	left: SelectionThreadSegment,
	right: SelectionThreadSegment,
): boolean =>
	left.kind === right.kind &&
	left.side === right.side &&
	(left.kind !== THREAD_ANCHOR_KIND.PATCH ||
		(right.kind === THREAD_ANCHOR_KIND.PATCH && left.oldStart === right.oldStart));

/** Layout-independent persisted ordering for mixed patch/context selections. */
export const canonicalizeSelectionSegments = (
	segments: readonly SelectionThreadSegment[],
): SelectionThreadSegment[] =>
	segments
		.slice()
		.sort(selectionSegmentOrder)
		.reduce<SelectionThreadSegment[]>((canonical, segment) => {
			const previous = canonical.at(-1);
			if (
				previous &&
				sameSelectionAuthority(previous, segment) &&
				segment.startLine <= previous.endLine + 1
			) {
				canonical[canonical.length - 1] = {
					...previous,
					endLine: Math.max(previous.endLine, segment.endLine),
				} as SelectionThreadSegment;
			} else canonical.push(segment);
			return canonical;
		}, []);

/** A persistent single thread spanning original patch and revealed-context segments in one file. */
export const selectionThreadAnchorSchema = z
	.strictObject({
		kind: z.literal("selection"),
		filePath: z.string().min(1),
		segments: z.tuple([selectionThreadSegmentSchema], selectionThreadSegmentSchema),
	})
	.superRefine((anchor, context) => {
		const canonical = canonicalizeSelectionSegments(anchor.segments);
		if (JSON.stringify(canonical) !== JSON.stringify(anchor.segments)) {
			context.addIssue({
				code: "custom",
				path: ["segments"],
				message:
					"Selection segments are not canonical (ordered, non-overlapping, and adjacent-merged)",
			});
		}
	});
export type SelectionThreadAnchor = z.infer<typeof selectionThreadAnchorSchema>;

export const threadAnchorSchema = z.union([
	hunkThreadAnchorSchema,
	excerptThreadAnchorSchema,
	patchThreadAnchorSchema,
	contextThreadAnchorSchema,
	selectionThreadAnchorSchema,
]);
export type ThreadAnchor = z.infer<typeof threadAnchorSchema>;

export const isExcerptAnchor = (anchor: ThreadAnchor): anchor is ExcerptThreadAnchor =>
	anchor.kind === THREAD_ANCHOR_KIND.EXCERPT;

export const isPatchAnchor = (anchor: ThreadAnchor): anchor is PatchThreadAnchor =>
	anchor.kind === THREAD_ANCHOR_KIND.PATCH;

export const isContextAnchor = (anchor: ThreadAnchor): anchor is ContextThreadAnchor =>
	anchor.kind === THREAD_ANCHOR_KIND.CONTEXT;

export const isSelectionAnchor = (anchor: ThreadAnchor): anchor is SelectionThreadAnchor =>
	anchor.kind === "selection";

export const threadAuthorSchema = z.strictObject({
	kind: z.enum(THREAD_AUTHOR_KIND),
	name: terminalSafeName,
});
export type ThreadAuthor = z.infer<typeof threadAuthorSchema>;

export const threadMessageSchema = z
	.strictObject({
		id: z.uuid(),
		author: threadAuthorSchema,
		body: terminalSafeText("Thread message body"),
		createdAt: z.iso.datetime(),
		intent: z.enum(THREAD_REPLY_INTENT).optional(),
	})
	.superRefine((message, context) => {
		if (message.intent && message.author.kind !== THREAD_AUTHOR_KIND.AGENT) {
			context.addIssue({
				code: "custom",
				path: ["intent"],
				message: "Only an agent reply may declare reply intent",
			});
		}
	});
export type ThreadMessage = z.infer<typeof threadMessageSchema>;

/** The one reply-state interpretation shared by status and review surfaces. */
export type ThreadDisposition =
	| "dealt-with"
	| "awaiting-agent"
	| "awaiting-reviewer-legacy"
	| "awaiting-approval"
	| "ready-to-verify";

export const threadDisposition = (
	thread: Pick<ReviewThread, "status" | "messages">,
): ThreadDisposition => {
	if (thread.status === THREAD_STATUS.DEALT_WITH) return "dealt-with";
	const last = thread.messages.at(-1);
	if (last?.author.kind !== THREAD_AUTHOR_KIND.AGENT) return "awaiting-agent";
	if (last.intent === THREAD_REPLY_INTENT.PROPOSAL) return "awaiting-approval";
	if (last.intent === THREAD_REPLY_INTENT.COMPLETED) return "ready-to-verify";
	return "awaiting-reviewer-legacy";
};

/** User-visible protocol state shared by inline cards, Comments, and disk-backed status. */
export const threadDispositionLabel = (thread: Pick<ReviewThread, "status" | "messages">): string =>
	({
		"dealt-with": "dealt with",
		"awaiting-agent": "awaiting agent",
		"awaiting-reviewer-legacy": "awaiting reviewer",
		"awaiting-approval": "needs approval",
		"ready-to-verify": "ready to verify",
	})[threadDisposition(thread)];

/** Original source lines, one array per anchor range; never rewritten by supersession. */
export const threadEvidenceSchema = z
	.strictObject({
		runId: runIdSchema,
		anchor: threadAnchorSchema,
		lines: z.array(z.array(z.string())),
	})
	.superRefine((evidence, context) => {
		const ranges = isPatchAnchor(evidence.anchor)
			? evidence.anchor.ranges
			: isSelectionAnchor(evidence.anchor)
				? evidence.anchor.segments
				: [evidence.anchor];
		if (
			evidence.lines.length !== ranges.length ||
			ranges.some(
				(range, index) => evidence.lines[index]?.length !== range.endLine - range.startLine + 1,
			)
		) {
			context.addIssue({
				code: "custom",
				path: ["lines"],
				message: "Original evidence must contain every line of every anchor range",
			});
		}
	});
export type ThreadEvidence = z.infer<typeof threadEvidenceSchema>;

export const reviewThreadSchema = z
	.strictObject({
		id: z.uuid(),
		runId: runIdSchema,
		anchor: threadAnchorSchema,
		/**
		 * The superseded run this thread was carried from, absent while it sits on the run it was
		 * written against. A carried anchor was re-mapped by machine rather than placed by its author,
		 * so a hunk anchor the new run no longer holds is orphaned instead of treated as corruption.
		 */
		migratedFrom: runIdSchema.optional(),
		originalEvidence: threadEvidenceSchema.optional(),
		/** Sticky detachment established by prep or context freeze. */
		migrationOrphaned: z.literal(true).optional(),
		status: z.enum(THREAD_STATUS),
		createdAt: z.iso.datetime(),
		messages: z.array(threadMessageSchema).min(1),
	})
	.superRefine((thread, context) => {
		if (thread.migrationOrphaned && !thread.migratedFrom) {
			context.addIssue({
				code: "custom",
				path: ["migrationOrphaned"],
				message: "migrationOrphaned requires a migrated anchor",
			});
		}
		const evidence = thread.originalEvidence;
		if (
			evidence &&
			(evidence.anchor.kind !== thread.anchor.kind ||
				evidence.anchor.filePath !== thread.anchor.filePath ||
				(!thread.migratedFrom &&
					(evidence.runId !== thread.runId ||
						JSON.stringify(evidence.anchor) !== JSON.stringify(thread.anchor))))
		) {
			context.addIssue({
				code: "custom",
				path: ["originalEvidence"],
				message:
					"Original evidence must match the authored run and anchor, or the carried anchor kind and path",
			});
		}
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

/** Strict historical schemas never gain fields from newer messages. */
const historicalThreadMessageSchema = z.strictObject({
	id: z.uuid(),
	author: threadAuthorSchema,
	body: terminalSafeText("Thread message body"),
	createdAt: z.iso.datetime(),
});

/** Strict historical schema: v1 predates patch anchors and their migration marker. */
const historicalReviewThreadSchema = z
	.strictObject({
		id: z.uuid(),
		runId: runIdSchema,
		anchor: z.union([hunkThreadAnchorSchema, excerptThreadAnchorSchema]),
		migratedFrom: runIdSchema.optional(),
		status: z.enum(THREAD_STATUS),
		createdAt: z.iso.datetime(),
		messages: z.array(historicalThreadMessageSchema).min(1),
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

export const historicalThreadStoreFileSchema = z
	.strictObject({
		schemaVersion: z.literal(HISTORICAL_THREAD_STORE_SCHEMA_VERSION),
		runs: z.record(runIdSchema, z.array(historicalReviewThreadSchema)),
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

/** v2 evidence predates segmented selections, just as its message schema predates reply intent. */
const previousThreadEvidenceSchema = z
	.strictObject({
		runId: runIdSchema,
		anchor: z.union([
			hunkThreadAnchorSchema,
			excerptThreadAnchorSchema,
			patchThreadAnchorSchema,
			contextThreadAnchorSchema,
		]),
		lines: z.array(z.array(z.string())),
	})
	.superRefine((evidence, context) => {
		const ranges = isPatchAnchor(evidence.anchor) ? evidence.anchor.ranges : [evidence.anchor];
		if (
			evidence.lines.length !== ranges.length ||
			ranges.some(
				(range, index) => evidence.lines[index]?.length !== range.endLine - range.startLine + 1,
			)
		) {
			context.addIssue({
				code: "custom",
				path: ["lines"],
				message: "Original evidence must contain every line of every anchor range",
			});
		}
	});

/** v2 had patch/context anchors and evidence, but messages had no reply intent. */
const previousReviewThreadSchema = z.strictObject({
	id: z.uuid(),
	runId: runIdSchema,
	anchor: z.union([
		hunkThreadAnchorSchema,
		excerptThreadAnchorSchema,
		patchThreadAnchorSchema,
		contextThreadAnchorSchema,
	]),
	migratedFrom: runIdSchema.optional(),
	originalEvidence: previousThreadEvidenceSchema.optional(),
	migrationOrphaned: z.literal(true).optional(),
	status: z.enum(THREAD_STATUS),
	createdAt: z.iso.datetime(),
	messages: z.array(historicalThreadMessageSchema).min(1),
});

const previousThreadStoreFileSchema = z.strictObject({
	schemaVersion: z.literal(PREVIOUS_THREAD_STORE_SCHEMA_VERSION),
	runs: z.record(runIdSchema, z.array(previousReviewThreadSchema)),
});

/** Read historical envelopes strictly, then upgrade only their envelope. */
export const threadStoreFileReaderSchema = z
	.union([threadStoreFileSchema, previousThreadStoreFileSchema, historicalThreadStoreFileSchema])
	.transform(
		(store): ThreadStoreFile =>
			store.schemaVersion === THREAD_STORE_SCHEMA_VERSION
				? store
				: threadStoreFileSchema.parse({
						schemaVersion: THREAD_STORE_SCHEMA_VERSION,
						runs: store.runs,
					}),
	);
