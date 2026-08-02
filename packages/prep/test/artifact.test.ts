import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	RUN_COMPARISON,
	RUN_ENDPOINT_KIND,
	RUN_FILE_STATUS,
	RUN_OBJECT_KIND,
	RUN_SCHEMA_VERSION,
	RUN_SCOPE_MODE,
} from "@revue/types";
import {
	digest,
	loadPreparedRun,
	type WritePreparedRunInput,
	writePreparedRun,
} from "../src/artifact.ts";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

const fixture = (): Omit<WritePreparedRunInput, "runsDirectory"> => {
	const oldContent = new TextEncoder().encode("old\n");
	const newContent = new TextEncoder().encode("new\n");
	const oldBlob = digest(oldContent);
	const newBlob = digest(newContent);
	return {
		content: {
			schemaVersion: RUN_SCHEMA_VERSION,
			scope: {
				mode: RUN_SCOPE_MODE.COMMITTED,
				comparison: RUN_COMPARISON.MERGE_BASE,
				base: { ref: "main", sha: "1".repeat(40) },
				head: { ref: "HEAD", sha: "2".repeat(40) },
				mergeBaseSha: "3".repeat(40),
				oldEndpoint: { kind: RUN_ENDPOINT_KIND.COMMIT, revision: "3".repeat(40) },
				newEndpoint: { kind: RUN_ENDPOINT_KIND.COMMIT, revision: "2".repeat(40) },
			},
			files: [
				{
					path: "src/example.ts",
					previousPath: null,
					status: RUN_FILE_STATUS.MODIFIED,
					oldBlob,
					newBlob,
					oldMode: "100644",
					newMode: "100644",
					oldKind: RUN_OBJECT_KIND.FILE,
					newKind: RUN_OBJECT_KIND.FILE,
					isBinary: false,
					hunks: 1,
					referenceStarts: [1],
					additions: 1,
					deletions: 1,
				},
			],
			commits: [{ sha: "2".repeat(40), subject: "Change the example" }],
			exclusions: [],
			totals: {
				files: 1,
				hunks: 1,
				additions: 1,
				deletions: 1,
				excluded: 0,
				reviewUnits: 1,
			},
		},
		patch: "diff --git a/src/example.ts b/src/example.ts\n",
		hunks: "=== HUNKS ===\n",
		blobs: new Map([
			[oldBlob, oldContent],
			[newBlob, newContent],
		]),
		createdAt: "2026-08-02T00:00:00.000Z",
	};
};

test("prepared runs are immutable, content-addressed, and reusable", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-run-"));
	directories.push(root);
	const runsDirectory = join(root, ".revue", "runs");
	const input = fixture();
	const first = await writePreparedRun({ ...input, runsDirectory });
	const second = await writePreparedRun({
		...input,
		runsDirectory,
		createdAt: "2027-01-01T00:00:00.000Z",
	});

	expect(second.directory).toBe(first.directory);
	expect(second.manifest).toEqual(first.manifest);
	expect(await loadPreparedRun(first.directory)).toEqual(first);
});

test("loading rejects a run whose pinned patch has changed", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-run-"));
	directories.push(root);
	const prepared = await writePreparedRun({ ...fixture(), runsDirectory: join(root, "runs") });
	await writeFile(join(prepared.directory, "diff.patch"), "tampered\n");

	expect(loadPreparedRun(prepared.directory)).rejects.toThrow("diff.patch failed integrity check");
});
