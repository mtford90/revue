import { z } from "zod";

export const RUN_SCHEMA_VERSION = 1 as const;
export const RUN_SCOPE_MODE = {
	COMMITTED: "committed",
	STAGED: "staged",
	UNSTAGED: "unstaged",
	WORK: "work",
} as const;
export const RUN_COMPARISON = {
	DIRECT: "direct",
	MERGE_BASE: "merge-base",
	STAGED: "staged",
	UNSTAGED: "unstaged",
	WORK: "work",
} as const;
export const RUN_ENDPOINT_KIND = {
	COMMIT: "commit",
	INDEX_TREE: "index-tree",
	WORKTREE: "worktree",
} as const;
export const RUN_FILE_STATUS = {
	ADDED: "added",
	COPIED: "copied",
	DELETED: "deleted",
	MODIFIED: "modified",
	MODE_CHANGED: "mode-changed",
	RENAMED: "renamed",
} as const;
export const RUN_OBJECT_KIND = {
	FILE: "file",
	SYMLINK: "symlink",
} as const;
export const RUN_EXCLUSION_REASON = {
	BUILT_IN: "built-in",
	REVUE_IGNORE: "revueignore",
	SESSION_IGNORE: "session-ignore",
} as const;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "Expected a SHA-256 digest");
const commitShaSchema = z.string().regex(/^[0-9a-f]{40}$/, "Expected a full commit SHA");
const resolvedRefSchema = z.strictObject({
	ref: z.string().min(1),
	sha: commitShaSchema,
});
const endpointSchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal(RUN_ENDPOINT_KIND.COMMIT), revision: commitShaSchema }),
	z.strictObject({ kind: z.literal(RUN_ENDPOINT_KIND.INDEX_TREE), revision: commitShaSchema }),
	z.strictObject({ kind: z.literal(RUN_ENDPOINT_KIND.WORKTREE), revision: sha256Schema }),
]);

export const runScopeSchema = z
	.strictObject({
		mode: z.enum(RUN_SCOPE_MODE),
		comparison: z.enum(RUN_COMPARISON),
		base: resolvedRefSchema,
		head: resolvedRefSchema,
		mergeBaseSha: commitShaSchema,
		oldEndpoint: endpointSchema,
		newEndpoint: endpointSchema,
	})
	.superRefine((scope, context) => {
		const valid =
			(scope.mode === RUN_SCOPE_MODE.COMMITTED &&
				[RUN_COMPARISON.DIRECT, RUN_COMPARISON.MERGE_BASE].some(
					(comparison) => comparison === scope.comparison,
				) &&
				scope.oldEndpoint.kind === RUN_ENDPOINT_KIND.COMMIT &&
				scope.newEndpoint.kind === RUN_ENDPOINT_KIND.COMMIT) ||
			(scope.mode === RUN_SCOPE_MODE.STAGED &&
				scope.comparison === RUN_COMPARISON.STAGED &&
				scope.oldEndpoint.kind === RUN_ENDPOINT_KIND.COMMIT &&
				scope.newEndpoint.kind === RUN_ENDPOINT_KIND.INDEX_TREE) ||
			(scope.mode === RUN_SCOPE_MODE.UNSTAGED &&
				scope.comparison === RUN_COMPARISON.UNSTAGED &&
				scope.oldEndpoint.kind === RUN_ENDPOINT_KIND.INDEX_TREE &&
				scope.newEndpoint.kind === RUN_ENDPOINT_KIND.WORKTREE) ||
			(scope.mode === RUN_SCOPE_MODE.WORK &&
				scope.comparison === RUN_COMPARISON.WORK &&
				scope.oldEndpoint.kind === RUN_ENDPOINT_KIND.COMMIT &&
				scope.newEndpoint.kind === RUN_ENDPOINT_KIND.WORKTREE);
		if (!valid) context.addIssue({ code: "custom", message: "Scope mode and endpoints disagree" });
	});
export type RunScope = z.infer<typeof runScopeSchema>;

const fileModeSchema = z.string().regex(/^[0-7]{6}$/, "Expected a six-digit Git file mode");
const objectKindSchema = z.enum(RUN_OBJECT_KIND);
export const runFileSchema = z
	.strictObject({
		path: z.string().min(1),
		previousPath: z.string().min(1).nullable(),
		status: z.enum(RUN_FILE_STATUS),
		oldBlob: sha256Schema.nullable(),
		newBlob: sha256Schema.nullable(),
		oldMode: fileModeSchema.nullable(),
		newMode: fileModeSchema.nullable(),
		oldKind: objectKindSchema.nullable(),
		newKind: objectKindSchema.nullable(),
		isBinary: z.boolean(),
		hunks: z.number().int().nonnegative(),
		referenceStarts: z.array(z.number().int().nonnegative()).min(1),
		additions: z.number().int().nonnegative(),
		deletions: z.number().int().nonnegative(),
	})
	.superRefine((file, context) => {
		const oldPresent = file.oldBlob !== null && file.oldMode !== null && file.oldKind !== null;
		const newPresent = file.newBlob !== null && file.newMode !== null && file.newKind !== null;
		const oldAbsent = file.oldBlob === null && file.oldMode === null && file.oldKind === null;
		const newAbsent = file.newBlob === null && file.newMode === null && file.newKind === null;
		if ((!oldPresent && !oldAbsent) || (!newPresent && !newAbsent)) {
			context.addIssue({ code: "custom", message: "Snapshot side is only partially described" });
		}
		const validSides =
			(file.status === RUN_FILE_STATUS.ADDED && oldAbsent && newPresent) ||
			(file.status === RUN_FILE_STATUS.DELETED && oldPresent && newAbsent) ||
			(file.status !== RUN_FILE_STATUS.ADDED &&
				file.status !== RUN_FILE_STATUS.DELETED &&
				oldPresent &&
				newPresent);
		if (!validSides)
			context.addIssue({ code: "custom", message: "File status and snapshots disagree" });
		const pathChanged =
			file.status === RUN_FILE_STATUS.RENAMED || file.status === RUN_FILE_STATUS.COPIED;
		if (pathChanged !== (file.previousPath !== null)) {
			context.addIssue({ code: "custom", message: "File status and previousPath disagree" });
		}
		if (file.status === RUN_FILE_STATUS.MODE_CHANGED && file.oldMode === file.newMode) {
			context.addIssue({ code: "custom", message: "A mode change needs distinct Git modes" });
		}
		if (file.hunks !== 0 && file.referenceStarts.length !== file.hunks) {
			context.addIssue({ code: "custom", message: "Each textual hunk needs one reference start" });
		}
		if (file.hunks === 0 && (file.referenceStarts.length !== 1 || file.referenceStarts[0] !== 0)) {
			context.addIssue({ code: "custom", message: "No-hunk files use the oldStart 0 reference" });
		}
	});
export type RunFile = z.infer<typeof runFileSchema>;

export const runIgnoreInputsSchema = z.strictObject({
	revueIgnore: z.array(z.string().min(1)),
	session: z.array(z.string().min(1)),
});
export type RunIgnoreInputs = z.infer<typeof runIgnoreInputsSchema>;

export const runExclusionSchema = z.strictObject({
	path: z.string().min(1),
	matchedPath: z.string().min(1).optional(),
	reason: z.enum(RUN_EXCLUSION_REASON),
	pattern: z.string().min(1),
});
export type RunExclusion = z.infer<typeof runExclusionSchema>;

export const runCommitSchema = z.strictObject({
	sha: commitShaSchema,
	subject: z.string(),
});
export type RunCommit = z.infer<typeof runCommitSchema>;

export const runTotalsSchema = z.strictObject({
	files: z.number().int().nonnegative(),
	hunks: z.number().int().nonnegative(),
	additions: z.number().int().nonnegative(),
	deletions: z.number().int().nonnegative(),
	excluded: z.number().int().nonnegative(),
	reviewUnits: z.number().int().nonnegative(),
});
export type RunTotals = z.infer<typeof runTotalsSchema>;

export const runManifestContentSchema = z.strictObject({
	schemaVersion: z.literal(RUN_SCHEMA_VERSION),
	scope: runScopeSchema,
	patchSha256: sha256Schema,
	hunksSha256: sha256Schema,
	files: z.array(runFileSchema),
	commits: z.array(runCommitSchema),
	ignore: runIgnoreInputsSchema.optional(),
	exclusions: z.array(runExclusionSchema),
	totals: runTotalsSchema,
});
export type RunManifestContent = z.infer<typeof runManifestContentSchema>;

export const runManifestSchema = runManifestContentSchema.extend({
	runId: sha256Schema,
	createdAt: z.iso.datetime(),
});
export type RunManifest = z.infer<typeof runManifestSchema>;
