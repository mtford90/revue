import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeHandoff } from "@revue/prep";
import type { HandoffDelivery } from "@revue/types";
import { waitForHandoff } from "./handoffWait.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const makeRepository = (): string => {
	const root = mkdtempSync(join(tmpdir(), "revue-handoff-wait-"));
	roots.push(root);
	return root;
};

const QUEUED: HandoffDelivery = { kind: "queued" };

const send = (root: string, threadIds: string[] = []) => {
	const handoffId = randomUUID();
	writeHandoff(root, {
		schemaVersion: 1,
		handoffId,
		requestedAt: new Date().toISOString(),
		runId: "a".repeat(64),
		threadIds,
		delivery: QUEUED,
	});
	return handoffId;
};

test("returns at once when a handoff newer than since already exists", async () => {
	const root = makeRepository();
	const handoffId = send(root);

	const result = await waitForHandoff({ repositoryRoot: root, since: null, timeoutMs: 1_000 });

	expect(result).toEqual({ kind: "ready", record: expect.objectContaining({ handoffId }) });
});

test("resolves at once for any record when since is null and one already exists", async () => {
	const root = makeRepository();
	const handoffId = send(root);

	const result = await waitForHandoff({
		repositoryRoot: root,
		since: handoffId,
		timeoutMs: 1_000,
	});

	expect(result).toEqual({ kind: "timeout" });
});

test("resolves when a handoff is written after the wait started", async () => {
	const root = makeRepository();

	const pending = waitForHandoff({ repositoryRoot: root, since: null, timeoutMs: 5_000 });
	const handoffId = send(root);

	const result = await pending;

	expect(result).toEqual({ kind: "ready", record: expect.objectContaining({ handoffId }) });
});

test("catches a write that lands between the first read and the watch attaching", async () => {
	const root = makeRepository();

	// waitForHandoff yields once before it attaches the watch; a synchronous write issued right
	// after calling it, before this test awaits anything, lands in that exact gap.
	const pending = waitForHandoff({ repositoryRoot: root, since: null, timeoutMs: 5_000 });
	const handoffId = send(root);

	const result = await pending;

	expect(result).toEqual({ kind: "ready", record: expect.objectContaining({ handoffId }) });
});

test("times out when no matching handoff lands", async () => {
	const root = makeRepository();

	const result = await waitForHandoff({ repositoryRoot: root, since: null, timeoutMs: 200 });

	expect(result).toEqual({ kind: "timeout" });
});
