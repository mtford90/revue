import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handoffPath, readHandoff, writeHandoff } from "@revue/prep";
import {
	type HandoffRecord,
	type ReviewThread,
	THREAD_ANCHOR_KIND,
	THREAD_AUTHOR_KIND,
	THREAD_STATUS,
} from "@revue/types";
import { createFeedbackController } from "./feedback.ts";
import { createThread, createThreadMessage } from "./threads.ts";

const runId = "c".repeat(64);
const reviewer = { kind: THREAD_AUTHOR_KIND.HUMAN, name: "Reviewer" } as const;
const agent = { kind: THREAD_AUTHOR_KIND.AGENT, name: "Review agent" } as const;

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 10, minute)).toISOString();

const anchor = (line: number) => ({
	kind: THREAD_ANCHOR_KIND.HUNK,
	filePath: "src/alpha.ts",
	oldStart: 1,
	side: "additions" as const,
	startLine: line,
	endLine: line,
});

const thread = (line: number, minute: number): ReviewThread =>
	createThread(runId, anchor(line), reviewer, `Line ${line}?`, { createdAt: at(minute) });

const answered = (base: ReviewThread, minute: number): ReviewThread => ({
	...base,
	messages: [...base.messages, createThreadMessage(agent, "Fixed.", { createdAt: at(minute) })],
});

const handoff = (requestedAt: string, threadIds: string[]): HandoffRecord => ({
	schemaVersion: 1,
	handoffId: "11111111-1111-4111-8111-111111111111",
	requestedAt,
	runId,
	threadIds,
	delivery: { kind: "queued" },
});

const scratchRepository = () => mkdtemp(join(tmpdir(), "revue-feedback-"));

const controllerFor = (repositoryRoot: string, threads: readonly ReviewThread[]) =>
	createFeedbackController({ repositoryRoot, runId, threads: () => threads });

test("the first Send queues every open thread a human spoke last", async () => {
	const root = await scratchRepository();
	try {
		const unsent = thread(1, 0);
		const closed = { ...thread(3, 2), status: THREAD_STATUS.DEALT_WITH };
		const threads = [unsent, answered(thread(2, 1), 3), closed, thread(4, 4)];

		const outcome = await controllerFor(root, threads).send();
		expect(outcome).toEqual({ kind: "queued", count: 2 });

		const record = readHandoff(root).record;
		expect(record).toMatchObject({
			runId,
			threadIds: [unsent.id, threads[3]?.id],
			delivery: { kind: "queued" },
		});
		expect(Date.parse(record?.requestedAt ?? "")).toBeGreaterThan(0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a second Send with nothing new to say writes nothing", async () => {
	const root = await scratchRepository();
	try {
		const threads = [thread(1, 0)];
		const before = handoff(at(30), [threads[0]?.id ?? ""]);
		writeHandoff(root, before);

		expect(await controllerFor(root, threads).send()).toEqual({ kind: "nothing" });
		expect(readHandoff(root).record).toEqual(before);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a comment written after the last handoff is the only thing the next Send carries", async () => {
	const root = await scratchRepository();
	try {
		const stale = thread(1, 0);
		const fresh = thread(2, 40);
		const before = handoff(at(30), [stale.id]);
		writeHandoff(root, before);

		expect(await controllerFor(root, [stale, fresh]).send()).toEqual({ kind: "queued", count: 1 });
		const record = readHandoff(root).record;
		expect(record?.threadIds).toEqual([fresh.id]);
		expect(record?.handoffId).not.toBe(before.handoffId);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a damaged handoff sends the whole conversation again rather than nothing", async () => {
	const root = await scratchRepository();
	try {
		await mkdir(join(root, ".revue"), { recursive: true });
		await writeFile(handoffPath(root), "{ not a handoff");
		const threads = [thread(1, 0), thread(2, 1)];

		expect(await controllerFor(root, threads).send()).toEqual({ kind: "queued", count: 2 });
		expect(readHandoff(root).record?.threadIds).toEqual(threads.map((each) => each.id));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a record that cannot be written is reported, and no partial handoff is left", async () => {
	const root = await scratchRepository();
	try {
		await mkdir(handoffPath(root), { recursive: true });

		const outcome = await controllerFor(root, [thread(1, 0)]).send();
		expect(outcome).toMatchObject({
			kind: "error",
			message: expect.stringContaining("Could not write the handoff"),
		});
		expect(readHandoff(root).record).toBeNull();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
