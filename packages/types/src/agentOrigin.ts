import { z } from "zod";
import { sha256Schema } from "./run.ts";

export const AGENT_ORIGIN_SCHEMA_VERSION = 1 as const;
export const AGENT_ORIGIN_HOST = {
	ORCA: "orca",
} as const;

/**
 * Where the agent that prepared or replied to a run is running, so a later handoff can find its
 * pane again. Repo-level rather than part of `run.json`: prep returns an existing run early on a
 * dedup, and the origin must still follow whichever pane last ran the agent.
 */
export const agentOriginSchema = z.strictObject({
	schemaVersion: z.literal(AGENT_ORIGIN_SCHEMA_VERSION),
	host: z.literal(AGENT_ORIGIN_HOST.ORCA),
	paneKey: z.string().min(1),
	worktreeId: z.string().min(1),
	runId: sha256Schema,
	recordedAt: z.iso.datetime(),
});

export type AgentOrigin = z.infer<typeof agentOriginSchema>;
