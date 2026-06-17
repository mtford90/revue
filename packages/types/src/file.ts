import { z } from "zod";
import { chapterSchema } from "./chapters.ts";
import { PrologueSchema } from "./prologue.ts";

// The on-disk artifact the chapter-generating skill writes and `revue show` reads.
// Mirrors stage-cli's AgentOutputSchema (the part the agent emits). `scope` and
// `generatedAt` are optional today — they become load-bearing once `revue prep`
// snapshots git state and we want to verify the chapters still match the diff.

export const SCOPE_KIND = {
	COMMITTED: "committed",
	WORKING_TREE: "workingTree",
} as const;
export type ScopeKind = (typeof SCOPE_KIND)[keyof typeof SCOPE_KIND];

const fullShaSchema = z.string().regex(/^[0-9a-f]{40}$/, "Expected a full commit SHA");

export const scopeSchema = z.looseObject({
	kind: z.enum(SCOPE_KIND),
	baseSha: fullShaSchema.optional(),
	headSha: fullShaSchema.optional(),
	mergeBaseSha: fullShaSchema.optional(),
});
export type Scope = z.infer<typeof scopeSchema>;

export const RevueChaptersFileSchema = z.object({
	chapters: z.array(chapterSchema),
	prologue: PrologueSchema.optional(),
	scope: scopeSchema.optional(),
	generatedAt: z.iso.datetime().optional(),
});
export type RevueChaptersFile = z.infer<typeof RevueChaptersFileSchema>;
