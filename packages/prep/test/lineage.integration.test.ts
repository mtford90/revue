import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreparedRun } from "../src/artifact.ts";
import { prepareRun } from "../src/prep.ts";

const repositories: string[] = [];
afterEach(async () => {
	await Promise.all(
		repositories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

const git = async (root: string, ...args: string[]): Promise<string> => {
	const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
	return stdout.trim();
};

const write = async (root: string, path: string, content: string): Promise<void> => {
	await mkdir(join(root, path, ".."), { recursive: true });
	await writeFile(join(root, path), content);
};

const commit = async (root: string, message: string): Promise<void> => {
	await git(root, "add", "-A");
	await git(root, "commit", "-m", message);
};

const repository = async (): Promise<string> => {
	const root = await mkdtemp(join(tmpdir(), "revue-lineage-"));
	repositories.push(root);
	await git(root, "init", "-b", "main");
	await git(root, "config", "user.email", "revue@example.com");
	await git(root, "config", "user.name", "Revue Test");
	await write(root, "value.ts", "export const value = 0;\n");
	await commit(root, "Baseline");
	await git(root, "checkout", "-b", "feature");
	return root;
};

/** Stands in for the revue skill: a run is narrated once chapters.json sits beside its manifest. */
const narrate = async (run: PreparedRun): Promise<void> => {
	await writeFile(join(run.directory, "chapters.json"), `${JSON.stringify({ chapters: [] })}\n`);
};

const revise = async (root: string, value: number): Promise<void> => {
	await write(root, "value.ts", `export const value = ${value};\n`);
	await commit(root, `Set the value to ${value}`);
};

test("a re-prep after new commits supersedes the most recent narrated run", async () => {
	const root = await repository();
	await revise(root, 1);
	const first = await prepareRun(["main", "HEAD"], root);
	await narrate(first);
	await revise(root, 2);

	const second = await prepareRun(["main", "HEAD"], root);

	expect(second.manifest.runId).not.toBe(first.manifest.runId);
	expect(second.manifest.supersedes).toBe(first.manifest.runId);
	expect(first.manifest.supersedes).toBeUndefined();
});

test("an unnarrated predecessor is skipped in favour of the narrated one", async () => {
	const root = await repository();
	await revise(root, 1);
	const narrated = await prepareRun(["main", "HEAD"], root);
	await narrate(narrated);
	await revise(root, 2);
	const unnarrated = await prepareRun(["main", "HEAD"], root);
	await revise(root, 3);

	const latest = await prepareRun(["main", "HEAD"], root);

	expect(unnarrated.manifest.supersedes).toBe(narrated.manifest.runId);
	expect(latest.manifest.supersedes).toBe(narrated.manifest.runId);
});

test("lineage only links runs prepared with the same scope arguments", async () => {
	const root = await repository();
	await revise(root, 1);
	const committed = await prepareRun(["main", "HEAD"], root);
	await narrate(committed);
	await write(root, "value.ts", "export const value = 9;\n");

	const work = await prepareRun(["--ref", "work", "--base", "main"], root);
	const ignored = await prepareRun(["main", "HEAD", "--ignore", "never/**"], root);

	expect(work.manifest.supersedes).toBeUndefined();
	expect(ignored.manifest.supersedes).toBeUndefined();
});

test("--carry-from names the predecessor and --no-carry suppresses lineage", async () => {
	const root = await repository();
	await revise(root, 1);
	const narrated = await prepareRun(["main", "HEAD"], root);
	await narrate(narrated);
	await revise(root, 2);
	const unnarrated = await prepareRun(["main", "HEAD"], root);
	await revise(root, 3);

	const forced = await prepareRun(
		["main", "HEAD", "--carry-from", unnarrated.manifest.runId],
		root,
	);
	await revise(root, 4);
	const fresh = await prepareRun(["main", "HEAD", "--no-carry"], root);

	expect(forced.manifest.supersedes).toBe(unnarrated.manifest.runId);
	expect(fresh.manifest.supersedes).toBeUndefined();
	expect(prepareRun(["main", "HEAD", "--carry-from", "b".repeat(64)], root)).rejects.toThrow(
		"--carry-from names a run this repository has no record of",
	);
});

test("an unchanged scope dedupes to the identical run without recording self-lineage", async () => {
	const root = await repository();
	await revise(root, 1);
	const first = await prepareRun(["main", "HEAD"], root);
	await narrate(first);

	const again = await prepareRun(["main", "HEAD"], root);

	expect(again.directory).toBe(first.directory);
	expect(again.manifest.runId).toBe(first.manifest.runId);
	expect(again.manifest.supersedes).toBeUndefined();
});
