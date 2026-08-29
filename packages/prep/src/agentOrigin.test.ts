import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	agentOriginPath,
	detectAgentHost,
	readAgentOrigin,
	recordAgentOrigin,
} from "./agentOrigin.ts";

const runId = "a".repeat(64);
const orcaEnv = { ORCA_WORKTREE_ID: "worktree-1", ORCA_PANE_KEY: "tab-1:leaf-1" };

const withScratchDir = async (action: (root: string) => Promise<void>): Promise<void> => {
	const root = await mkdtemp(join(tmpdir(), "revue-agent-origin-"));
	try {
		await action(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
};

test("detectAgentHost requires both Orca variables", () => {
	expect(detectAgentHost(orcaEnv)).toEqual({
		host: "orca",
		paneKey: "tab-1:leaf-1",
		worktreeId: "worktree-1",
	});
	expect(detectAgentHost({ ORCA_WORKTREE_ID: "worktree-1" })).toBeNull();
	expect(detectAgentHost({ ORCA_PANE_KEY: "tab-1:leaf-1" })).toBeNull();
	expect(detectAgentHost({})).toBeNull();
});

test("recordAgentOrigin writes and readAgentOrigin round-trips it", async () => {
	await withScratchDir(async (root) => {
		const written = recordAgentOrigin({ repositoryRoot: root, runId, env: orcaEnv });
		expect(written).toBe(true);
		const { origin, warning } = readAgentOrigin(root);
		expect(warning).toBeUndefined();
		expect(origin).toMatchObject({
			schemaVersion: 1,
			host: "orca",
			paneKey: "tab-1:leaf-1",
			worktreeId: "worktree-1",
			runId,
		});
	});
});

test("recordAgentOrigin is a no-op outside Orca", async () => {
	await withScratchDir(async (root) => {
		const written = recordAgentOrigin({ repositoryRoot: root, runId, env: {} });
		expect(written).toBe(false);
		expect(readAgentOrigin(root)).toEqual({ origin: null });
	});
});

test("readAgentOrigin reports a missing record as absent", async () => {
	await withScratchDir(async (root) => {
		expect(readAgentOrigin(root)).toEqual({ origin: null });
	});
});

test("readAgentOrigin reports a malformed record as a warning rather than throwing", async () => {
	await withScratchDir(async (root) => {
		const path = agentOriginPath(root);
		await mkdir(join(root, ".revue"), { recursive: true });
		await writeFile(path, "not json", "utf8");
		const { origin, warning } = readAgentOrigin(root);
		expect(origin).toBeNull();
		expect(warning).toContain("not valid JSON");

		await writeFile(path, JSON.stringify({ schemaVersion: 1 }), "utf8");
		const missingFields = readAgentOrigin(root);
		expect(missingFields.origin).toBeNull();
		expect(missingFields.warning).toContain("does not match the agent origin schema");
	});
});
