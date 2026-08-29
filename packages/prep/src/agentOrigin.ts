import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AGENT_ORIGIN_HOST, type AgentOrigin, agentOriginSchema } from "@revue/types";

// The record lives beside the thread store rather than inside a run: prep can return an existing
// run early on a dedup, and the origin must still follow whichever pane last ran the agent.

export class AgentOriginError extends Error {}

export type AgentHost = {
	host: typeof AGENT_ORIGIN_HOST.ORCA;
	paneKey: string;
	worktreeId: string;
};

export type RecordAgentOriginInput = {
	repositoryRoot: string;
	runId: string;
	env?: NodeJS.ProcessEnv;
};

export type ReadAgentOriginResult = {
	origin: AgentOrigin | null;
	warning?: string;
};

export const agentOriginPath = (repoRoot: string): string => join(repoRoot, ".revue", "agent.json");

/** Orca is present when both of its identifying variables are set; `ORCA_PANE_KEY` is `tabId:leafId`. */
export const detectAgentHost = (env: NodeJS.ProcessEnv = process.env): AgentHost | null => {
	const worktreeId = env.ORCA_WORKTREE_ID;
	const paneKey = env.ORCA_PANE_KEY;
	if (!worktreeId || !paneKey) return null;
	return { host: AGENT_ORIGIN_HOST.ORCA, paneKey, worktreeId };
};

/** Writes `.revue/agent.json` for the pane that just ran an agent-side command. A no-op outside Orca. */
export function recordAgentOrigin(input: RecordAgentOriginInput): boolean {
	const host = detectAgentHost(input.env ?? process.env);
	if (!host) return false;
	const path = agentOriginPath(input.repositoryRoot);
	const record = agentOriginSchema.parse({
		schemaVersion: 1,
		host: host.host,
		paneKey: host.paneKey,
		worktreeId: host.worktreeId,
		runId: input.runId,
		recordedAt: new Date().toISOString(),
	});
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(temporary, path);
		return true;
	} catch (error) {
		rmSync(temporary, { force: true });
		throw new AgentOriginError(`Could not record agent origin at ${path}: ${describe(error)}`);
	}
}

/** Reads `.revue/agent.json`. A missing file is absence, not an error; a malformed one is reported as a warning rather than thrown, since a bad record must never block orientation. */
export function readAgentOrigin(repoRoot: string): ReadAgentOriginResult {
	const path = agentOriginPath(repoRoot);
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { origin: null };
		return { origin: null, warning: `Could not read agent origin at ${path}: ${describe(error)}` };
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		return {
			origin: null,
			warning: `Agent origin at ${path} is not valid JSON: ${describe(error)}`,
		};
	}
	const parsed = agentOriginSchema.safeParse(value);
	if (!parsed.success) {
		return {
			origin: null,
			warning: `Agent origin at ${path} does not match the agent origin schema`,
		};
	}
	return { origin: parsed.data };
}

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
