import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUN_FILE_STATUS, RUN_OBJECT_KIND, type RunFile } from "@revue/types";
import { generateSemanticDiff, SemanticDiffError } from "./semantic.ts";

type SemanticRun = Parameters<typeof generateSemanticDiff>[0];

const baseFile = (overrides: Partial<RunFile>): RunFile =>
	({
		path: "sample.ts",
		previousPath: null,
		status: RUN_FILE_STATUS.MODIFIED,
		oldBlob: "old-blob",
		newBlob: "new-blob",
		oldMode: "100644",
		newMode: "100644",
		oldKind: RUN_OBJECT_KIND.FILE,
		newKind: RUN_OBJECT_KIND.FILE,
		isBinary: false,
		...overrides,
	}) as RunFile;

async function makeRun(
	directory: string,
	files: RunFile[],
	blobs: Record<string, string>,
): Promise<SemanticRun> {
	await mkdir(join(directory, "blobs"), { recursive: true });
	for (const [hash, content] of Object.entries(blobs)) {
		await writeFile(join(directory, "blobs", hash), content);
	}
	return { directory, manifest: { files } } as SemanticRun;
}

async function fakeDifftastic(
	directory: string,
	report: unknown,
): Promise<{ executable: string; log: string }> {
	const executable = join(directory, "difft");
	const log = join(directory, "invocations");
	const reportPath = join(directory, "report.json");
	await writeFile(reportPath, JSON.stringify(report));
	await writeFile(
		executable,
		`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "Difftastic 0.67.0"
  exit 0
fi
if [ "$1" = "--help" ]; then
  echo "--display side-by-side inline json"
  exit 0
fi
printf '%s\\t%s\\t%s\\t%s\\n' "$1" "$3" "$4" "$7" >> ${JSON.stringify(log)}
cat ${JSON.stringify(reportPath)}
`,
	);
	await chmod(executable, 0o755);
	return { executable, log };
}

test("a changed file synthesises a Difftastic-aligned patch with char-exact emphasis", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "revue-semantic-"));
	try {
		const { executable, log } = await fakeDifftastic(temporary, {
			path: "sample.ts",
			language: "TypeScript",
			status: "changed",
			aligned_lines: [
				[0, 0],
				[1, 1],
				[2, 2],
				[null, 3],
			],
			chunks: [
				[
					{
						lhs: { line_number: 1, changes: [{ start: 0, end: 5, content: "bravo" }] },
						rhs: { line_number: 1, changes: [{ start: 0, end: 6, content: "bravò" }] },
					},
					{ rhs: { line_number: 3, changes: [{ start: 0, end: 5, content: "delta" }] } },
				],
			],
		});
		const run = await makeRun(join(temporary, "run"), [baseFile({})], {
			"old-blob": "alpha\nbravo\ncharlie\n",
			"new-blob": "alpha\nbravò!\ncharlie\ndelta\n",
		});

		const result = await generateSemanticDiff(run, executable);
		expect(result.version).toBe("Difftastic 0.67.0");
		const file = result.files[0];
		expect(file?.notes).toEqual([]);
		expect(file?.patch).toBe(
			[
				"--- a/sample.ts",
				"+++ b/sample.ts",
				"@@ -1,3 +1,4 @@",
				" alpha",
				"-bravo",
				"+bravò!",
				" charlie",
				"+delta",
				"",
			].join("\n"),
		);
		// Difftastic reports byte offsets: "bravò" is 6 bytes but 5 chars.
		expect(file?.emphasis.deletions.get(2)).toEqual([{ start: 0, end: 5 }]);
		expect(file?.emphasis.additions.get(2)).toEqual([{ start: 0, end: 5 }]);
		expect(file?.emphasis.additions.get(4)).toEqual([{ start: 0, end: 5 }]);

		const invocations = (await readFile(log, "utf8")).trim().split("\n");
		expect(invocations).toHaveLength(1);
		const [display, path, oldPath, newPath] = (invocations[0] ?? "").split("\t");
		expect(display).toBe("--display=json");
		expect(path).toBe("sample.ts");
		expect(oldPath).toBe(join(run.directory, "blobs", "old-blob"));
		expect(newPath).toBe(join(run.directory, "blobs", "new-blob"));
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("far-apart changes produce separate context-limited hunks", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "revue-semantic-hunks-"));
	try {
		const lines = Array.from({ length: 15 }, (_, index) => `line ${index + 1}`);
		const changedLines = [...lines];
		changedLines[0] = "line one";
		changedLines[11] = "line twelve";
		const { executable } = await fakeDifftastic(temporary, {
			path: "sample.ts",
			status: "changed",
			aligned_lines: lines.map((_, index) => [index, index]),
			chunks: [
				[
					{
						lhs: { line_number: 0, changes: [{ start: 5, end: 6 }] },
						rhs: { line_number: 0, changes: [{ start: 5, end: 8 }] },
					},
					{
						lhs: { line_number: 11, changes: [{ start: 5, end: 7 }] },
						rhs: { line_number: 11, changes: [{ start: 5, end: 11 }] },
					},
				],
			],
		});
		const run = await makeRun(join(temporary, "run"), [baseFile({})], {
			"old-blob": `${lines.join("\n")}\n`,
			"new-blob": `${changedLines.join("\n")}\n`,
		});

		const patch = (await generateSemanticDiff(run, executable)).files[0]?.patch ?? "";
		expect(patch).toContain("@@ -1,4 +1,4 @@");
		expect(patch).toContain("@@ -9,7 +9,7 @@");
		expect(patch).not.toContain("line 7");
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("pairs without novel tokens render as post-image context, not changes", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "revue-semantic-whitespace-"));
	try {
		const { executable } = await fakeDifftastic(temporary, {
			path: "sample.ts",
			status: "changed",
			aligned_lines: [
				[0, 0],
				[1, 1],
				[2, 2],
			],
			chunks: [[{ rhs: { line_number: 2, changes: [{ start: 0, end: 5 }] } }]],
		});
		const run = await makeRun(join(temporary, "run"), [baseFile({})], {
			"old-blob": "alpha\n  indented\nbravo\n",
			"new-blob": "alpha\n    indented\nfresh\n",
		});

		const patch = (await generateSemanticDiff(run, executable)).files[0]?.patch ?? "";
		// Line 2 differs only in indentation; Difftastic aligned it without novelty.
		expect(patch).toContain("     indented");
		expect(patch).not.toContain("-  indented");
		expect(patch).toContain("-bravo");
		expect(patch).toContain("+fresh");
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("a whitespace-only file reports no semantic content changes", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "revue-semantic-noise-"));
	try {
		const { executable } = await fakeDifftastic(temporary, {
			path: "sample.ts",
			status: "changed",
			aligned_lines: [
				[0, 0],
				[1, 1],
			],
			chunks: [],
		});
		const run = await makeRun(join(temporary, "run"), [baseFile({})], {
			"old-blob": "alpha\nbravo\n",
			"new-blob": "alpha\n  bravo\n",
		});

		const file = (await generateSemanticDiff(run, executable)).files[0];
		expect(file?.patch).toBeNull();
		expect(file?.notes).toContain("Difftastic found only whitespace or formatting differences.");
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("created and deleted reports render the whole pinned snapshot", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "revue-semantic-created-"));
	try {
		const { executable } = await fakeDifftastic(temporary, {
			path: "sample.ts",
			status: "created",
		});
		const run = await makeRun(
			join(temporary, "run"),
			[baseFile({ status: RUN_FILE_STATUS.ADDED, oldBlob: null, oldMode: null, oldKind: null })],
			{ "new-blob": "first\nsecond\n" },
		);

		const file = (await generateSemanticDiff(run, executable)).files[0];
		expect(file?.patch).toBe(
			["--- /dev/null", "+++ b/sample.ts", "@@ -0,0 +1,2 @@", "+first", "+second", ""].join("\n"),
		);
		expect(file?.notes).toEqual([]);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("special file states resolve to notes without invoking Difftastic on their blobs", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "revue-semantic-states-"));
	try {
		const { executable, log } = await fakeDifftastic(temporary, {
			path: "deleted.ts",
			status: "deleted",
		});
		const files = [
			baseFile({
				path: "renamed.ts",
				previousPath: "old.ts",
				status: RUN_FILE_STATUS.RENAMED,
				newBlob: "old-blob",
			}),
			baseFile({
				path: "mode.ts",
				status: RUN_FILE_STATUS.MODE_CHANGED,
				oldMode: "100644",
				newMode: "100755",
				newBlob: "old-blob",
			}),
			baseFile({ path: "binary.dat", isBinary: true }),
			baseFile({
				path: "link",
				oldKind: RUN_OBJECT_KIND.SYMLINK,
				newKind: RUN_OBJECT_KIND.SYMLINK,
			}),
			baseFile({
				path: "deleted.ts",
				status: RUN_FILE_STATUS.DELETED,
				newBlob: null,
				newMode: null,
				newKind: null,
			}),
		];
		const run = await makeRun(join(temporary, "run"), files, {
			"old-blob": "kept\n",
			"new-blob": "changed\n",
		});

		const result = await generateSemanticDiff(run, executable);
		const notes = result.files.flatMap((file) => file.notes).join("\n");
		expect(notes).toContain("renamed: old.ts -> renamed.ts");
		expect(notes).toContain("contents are identical");
		expect(notes).toContain("File mode changed 100644 -> 100755");
		expect(notes).toContain("Binary snapshots cannot be represented");
		expect(notes).toContain("Symlink snapshots are not parsed as source code");
		expect(result.files.at(-1)?.patch).toBe(
			["--- a/deleted.ts", "+++ /dev/null", "@@ -1,1 +0,0 @@", "-kept", ""].join("\n"),
		);
		const invocations = (await readFile(log, "utf8")).trim().split("\n");
		expect(invocations).toHaveLength(1);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("a pinned path beginning with a hyphen is accepted", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "revue-semantic-hyphen-"));
	try {
		const { executable } = await fakeDifftastic(temporary, {
			path: "-leading.ts",
			status: "changed",
			aligned_lines: [[0, 0]],
			chunks: [
				[
					{
						lhs: { line_number: 0, changes: [{ start: 0, end: 3 }] },
						rhs: { line_number: 0, changes: [{ start: 0, end: 3 }] },
					},
				],
			],
		});
		const run = await makeRun(join(temporary, "run"), [baseFile({ path: "-leading.ts" })], {
			"old-blob": "one\n",
			"new-blob": "two\n",
		});

		const file = (await generateSemanticDiff(run, executable)).files[0];
		expect(file?.path).toBe("-leading.ts");
		expect(file?.patch).toContain("+two");
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("an unsupported JSON layout is rejected with the active version named", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "revue-semantic-schema-"));
	try {
		const { executable } = await fakeDifftastic(temporary, [1, 2, 3]);
		const run = await makeRun(join(temporary, "run"), [baseFile({})], {
			"old-blob": "one\n",
			"new-blob": "two\n",
		});
		await expect(generateSemanticDiff(run, executable)).rejects.toThrow("unsupported JSON layout");
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("an executable without JSON display support is rejected before comparing", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "revue-semantic-incompatible-"));
	try {
		const executable = join(temporary, "difft");
		await writeFile(
			executable,
			`#!/bin/sh
if [ "$1" = "--version" ]; then echo "Difftastic 0.50.0"; exit 0; fi
if [ "$1" = "--help" ]; then echo "--color --display --width"; exit 0; fi
exit 9
`,
		);
		await chmod(executable, 0o755);
		const run = await makeRun(join(temporary, "run"), [baseFile({})], {
			"old-blob": "one\n",
			"new-blob": "two\n",
		});
		await expect(generateSemanticDiff(run, executable)).rejects.toThrow(
			"does not provide the required",
		);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("a missing executable produces a terminal-safe fallback explanation", async () => {
	const path = join(tmpdir(), `missing-difft-${crypto.randomUUID()}`);
	try {
		await generateSemanticDiff({ directory: path, manifest: { files: [] } } as never, path);
		expect.unreachable("a missing executable must fail");
	} catch (error) {
		expect(error).toBeInstanceOf(SemanticDiffError);
		const message = error instanceof Error ? error.message : String(error);
		expect(message).toContain("Semantic diff unavailable");
		expect(message).toContain("Install a compatible Difftastic executable");
		expect(message).not.toContain("\u001b");
	}
});
