import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HandoffRecord } from "@revue/types";
import { HandoffError, handoffPath, readHandoff, writeHandoff } from "./handoff.ts";

const runId = "b".repeat(64);

const record = (overrides: Partial<HandoffRecord> = {}): HandoffRecord => ({
	schemaVersion: 1,
	handoffId: randomUUID(),
	requestedAt: new Date().toISOString(),
	runId,
	threadIds: [randomUUID()],
	delivery: { kind: "queued" },
	...overrides,
});

const scratchRoot = () => mkdtemp(join(tmpdir(), "revue-handoff-"));

test("a repository with no handoff reports nothing and no complaint", async () => {
	const root = await scratchRoot();
	try {
		expect(readHandoff(root)).toEqual({ record: null });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a written handoff reads back whole, and the next Send overwrites it", async () => {
	const root = await scratchRoot();
	try {
		const first = record();
		writeHandoff(root, first);
		expect(readHandoff(root)).toEqual({ record: first });

		const second = record({
			delivery: { kind: "delivered", host: "orca", terminal: "1:2", title: "agent" },
		});
		writeHandoff(root, second);
		expect(readHandoff(root).record).toEqual(second);
		expect(await readdir(join(root, ".revue"))).toEqual(["handoff.json"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a malformed handoff is a warning rather than a throw, and reads as absent", async () => {
	const root = await scratchRoot();
	try {
		await mkdir(join(root, ".revue"), { recursive: true });
		await writeFile(handoffPath(root), "{ not json");
		expect(readHandoff(root)).toMatchObject({
			record: null,
			warning: expect.stringContaining("not valid JSON"),
		});

		await writeFile(handoffPath(root), JSON.stringify({ schemaVersion: 1, handoffId: "nope" }));
		const parsed = readHandoff(root);
		expect(parsed.record).toBeNull();
		expect(parsed.warning).toContain("does not match the handoff schema");
		expect(parsed.warning).not.toContain("\n");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a write that cannot land leaves the previous record and no temporary file", async () => {
	const root = await scratchRoot();
	try {
		const kept = record();
		writeHandoff(root, kept);
		// A directory in the record's place fails the rename, standing in for a full or read-only disk.
		await rm(handoffPath(root));
		await mkdir(handoffPath(root));

		expect(() => writeHandoff(root, record())).toThrow(HandoffError);
		expect(await readdir(join(root, ".revue"))).toEqual(["handoff.json"]);

		await rm(handoffPath(root), { recursive: true });
		writeHandoff(root, kept);
		expect(readHandoff(root).record).toEqual(kept);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
