import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadPreparedRun } from "@revue/prep";
import { resolveTheme } from "@revue/theme";
import { RUN_FILE_STATUS, RUN_OBJECT_KIND, type RunFile } from "@revue/types";
import { generateSemanticDiff, SemanticDiffError } from "./semantic.ts";
import { semanticAnsiPalette } from "./theme.ts";

const sampleRun = resolve(import.meta.dir, "../../../examples/sample-run");
const palette = semanticAnsiPalette(resolveTheme("catppuccin-mocha"));

async function fakeDifftastic(directory: string): Promise<{ executable: string; log: string }> {
	const executable = join(directory, "difft");
	const log = join(directory, "invocations");
	await writeFile(
		executable,
		`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "Difftastic 0.67.0"
  exit 0
fi
if [ "$1" = "--help" ]; then
  echo "--color --display --width"
  exit 0
fi
if [ -n "$REVUE_TEST_DIFFT_LOG" ]; then
  printf '%s\\t%s\\t%s\\t%s\\n' "$2" "$5" "$6" "$9" >> "$REVUE_TEST_DIFFT_LOG"
fi
printf '\\033[31msemantic output for %s\\033[0m\\n' "$5"
`,
	);
	await chmod(executable, 0o755);
	return { executable, log };
}

test("semantic diff preserves colour and compares only pinned run blobs", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "revue-semantic-test-"));
	const previousLog = process.env.REVUE_TEST_DIFFT_LOG;
	try {
		const { executable, log } = await fakeDifftastic(temporary);
		process.env.REVUE_TEST_DIFFT_LOG = log;
		const run = await loadPreparedRun(sampleRun);
		const result = await generateSemanticDiff(run, 92, palette, executable);

		expect(result.version).toBe("Difftastic 0.67.0");
		expect(result.files).toHaveLength(run.manifest.files.length);
		const styledLine = result.files[0]?.lines.find((line) =>
			line.text.includes("semantic output for src/lib/apiClient.test.ts"),
		);
		expect(styledLine?.spans).toContainEqual({
			text: "semantic output for src/lib/apiClient.test.ts",
			fg: "#f38ba8",
			bold: false,
			dim: false,
			italic: false,
			underline: false,
		});
		expect(JSON.stringify(result.files)).not.toContain("\u001b");

		const invocations = (await readFile(log, "utf8")).trim().split("\n");
		const modified = run.manifest.files.find((file) => file.status === RUN_FILE_STATUS.MODIFIED);
		expect(modified).toBeDefined();
		expect(invocations).toContain(
			[
				"--display=side-by-side",
				modified?.path,
				join(sampleRun, "blobs", modified?.oldBlob ?? ""),
				join(sampleRun, "blobs", modified?.newBlob ?? ""),
			].join("\t"),
		);
		for (const invocation of invocations) {
			const [, , oldPath, newPath] = invocation.split("\t");
			for (const snapshotPath of [oldPath, newPath]) {
				expect(
					snapshotPath?.startsWith(join(sampleRun, "blobs")) ||
						snapshotPath?.startsWith(join(tmpdir(), "revue-semantic-")),
				).toBe(true);
			}
		}

		if (!modified) throw new Error("sample run needs a modified file");
		await generateSemanticDiff(
			{ ...run, manifest: { ...run.manifest, files: [modified] } },
			60,
			palette,
			executable,
		);
		const narrowInvocation = (await readFile(log, "utf8")).trim().split("\n").at(-1);
		expect(narrowInvocation?.split("\t")[0]).toBe("--display=inline");
	} finally {
		if (previousLog === undefined) delete process.env.REVUE_TEST_DIFFT_LOG;
		else process.env.REVUE_TEST_DIFFT_LOG = previousLog;
		await rm(temporary, { recursive: true, force: true });
	}
});

test("semantic diff accepts a pinned path beginning with a hyphen", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "revue-semantic-hyphen-"));
	try {
		const executable = join(temporary, "difft");
		await writeFile(
			executable,
			`#!/bin/sh
if [ "$1" = "--version" ]; then echo "Difftastic 0.67.0"; exit 0; fi
if [ "$1" = "--help" ]; then echo "--color --display --width"; exit 0; fi
if [ "$4" != "--" ] || [ "$5" != "-leading.ts" ]; then exit 9; fi
echo "semantic leading path"
`,
		);
		await chmod(executable, 0o755);
		const run = await loadPreparedRun(sampleRun);
		const source = run.manifest.files.find(
			(file) => file.oldBlob && file.newBlob && file.oldBlob !== file.newBlob,
		);
		if (!source) throw new Error("sample run needs a changed two-sided file");
		const result = await generateSemanticDiff(
			{ ...run, manifest: { ...run.manifest, files: [{ ...source, path: "-leading.ts" }] } },
			80,
			palette,
			executable,
		);

		expect(result.files[0]).toMatchObject({
			path: "-leading.ts",
			lines: expect.arrayContaining([expect.objectContaining({ text: "semantic leading path" })]),
		});
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("semantic diff describes special file states and absent snapshot sides", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "revue-semantic-states-"));
	try {
		const { executable } = await fakeDifftastic(temporary);
		const run = await loadPreparedRun(sampleRun);
		const source = run.manifest.files.find((file) => file.oldBlob && file.newBlob);
		if (!source) throw new Error("sample run needs a two-sided file");
		const files = [
			{
				...source,
				path: "renamed.ts",
				previousPath: "old.ts",
				status: RUN_FILE_STATUS.RENAMED,
				newBlob: source.oldBlob,
			},
			{
				...source,
				path: "mode.ts",
				status: RUN_FILE_STATUS.MODE_CHANGED,
				oldMode: "100644",
				newMode: "100755",
				newBlob: source.oldBlob,
			},
			{ ...source, path: "binary.dat", isBinary: true },
			{
				...source,
				path: "link",
				oldKind: RUN_OBJECT_KIND.SYMLINK,
				newKind: RUN_OBJECT_KIND.SYMLINK,
			},
			{
				...source,
				path: "deleted.ts",
				status: RUN_FILE_STATUS.DELETED,
				newBlob: null,
				newMode: null,
				newKind: null,
			},
		] satisfies RunFile[];
		const result = await generateSemanticDiff(
			{ ...run, manifest: { ...run.manifest, files } },
			80,
			palette,
			executable,
		);
		const text = result.files.flatMap((file) => file.lines.map((line) => line.text)).join("\n");
		expect(text).toContain("renamed: old.ts -> renamed.ts");
		expect(text).toContain("contents are identical");
		expect(text).toContain("File mode changed 100644 -> 100755");
		expect(text).toContain("Binary snapshots cannot be represented");
		expect(text).toContain("Symlink snapshots are not parsed as source code");
		expect(text).toContain(
			"New snapshot is absent; comparing the pinned old snapshot with an empty post-image.",
		);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("an incompatible executable is rejected before any snapshot is compared", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "revue-semantic-incompatible-"));
	try {
		const executable = join(temporary, "difft");
		await writeFile(executable, "#!/bin/sh\necho 'not Difftastic'\n");
		await chmod(executable, 0o755);
		const run = await loadPreparedRun(sampleRun);
		await expect(generateSemanticDiff(run, 80, palette, executable)).rejects.toThrow(
			"not a compatible Difftastic executable",
		);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("a missing executable produces a terminal-safe fallback explanation", async () => {
	const run = await loadPreparedRun(sampleRun);
	const path = join(tmpdir(), `missing-difft-${crypto.randomUUID()}`);
	try {
		await generateSemanticDiff(run, 80, palette, path);
		expect.unreachable("a missing executable must fail");
	} catch (error) {
		expect(error).toBeInstanceOf(SemanticDiffError);
		const message = error instanceof Error ? error.message : String(error);
		expect(message).toContain("Semantic diff unavailable");
		expect(message).toContain("Install a compatible Difftastic executable");
		expect(message).not.toContain("\u001b");
	}
});
