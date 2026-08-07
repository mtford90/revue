import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUN_COMPARISON, RUN_ENDPOINT_KIND, RUN_FILE_STATUS } from "@revue/types";
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

const write = async (root: string, path: string, content: string | Uint8Array): Promise<void> => {
	await mkdir(join(root, path, ".."), { recursive: true });
	await writeFile(join(root, path), content);
};

const repository = async (): Promise<string> => {
	const root = await mkdtemp(join(tmpdir(), "revue-prep-"));
	repositories.push(root);
	await git(root, "init", "-b", "main");
	await git(root, "config", "user.email", "revue@example.com");
	await git(root, "config", "user.name", "Revue Test");
	await git(root, "config", "core.filemode", "true");
	return root;
};

const commit = async (root: string, message: string): Promise<void> => {
	await git(root, "add", "-A");
	await git(root, "commit", "-m", message);
};

test("committed prep pins blobs, modes, pseudo-references, and exclusions", async () => {
	const root = await repository();
	await write(root, ".revueignore", "ignored.txt\nsecret.txt\n");
	await write(root, "src/value.ts", "export const value = 1;\n");
	await write(root, "old-name.txt", "same\n");
	await write(root, "secret.txt", "hidden rename\n");
	await write(root, "script.sh", "#!/bin/sh\necho ok\n");
	await write(root, "ignored.txt", "old\n");
	await symlink("first-target", join(root, "linked"));
	await commit(root, "Baseline");
	await git(root, "checkout", "-b", "feature");

	await write(root, "src/value.ts", "export const value = 2;");
	await git(root, "mv", "old-name.txt", "new-name.txt");
	await git(root, "mv", "secret.txt", "visible.txt");
	await chmod(join(root, "script.sh"), 0o755);
	await unlink(join(root, "linked"));
	await symlink("second-target", join(root, "linked"));
	await write(root, "empty.txt", "");
	await write(root, "ignored.txt", "new\n");
	await write(root, "package-lock.json", "{}\n");
	await write(root, "image.bin", new Uint8Array([0, 1, 2, 3]));
	await commit(root, "Prepare the feature");

	const run = await prepareRun(["main", "HEAD"], root);
	const byPath = new Map(run.manifest.files.map((file) => [file.path, file]));

	expect([...byPath.keys()]).toEqual([
		"empty.txt",
		"linked",
		"new-name.txt",
		"script.sh",
		"src/value.ts",
	]);
	expect(byPath.get("new-name.txt")).toMatchObject({
		previousPath: "old-name.txt",
		status: RUN_FILE_STATUS.RENAMED,
		hunks: 0,
		referenceStarts: [0],
	});
	expect(byPath.get("script.sh")).toMatchObject({
		status: RUN_FILE_STATUS.MODE_CHANGED,
		oldMode: "100644",
		newMode: "100755",
		referenceStarts: [0],
	});
	const linked = byPath.get("linked");
	expect(linked).toMatchObject({ oldKind: "symlink", newKind: "symlink" });
	expect(await readFile(join(run.directory, "blobs", linked?.newBlob ?? ""), "utf8")).toBe(
		"second-target",
	);
	expect(run.manifest.exclusions.map((entry) => entry.path)).toEqual([
		"ignored.txt",
		"image.bin",
		"package-lock.json",
		"visible.txt",
	]);
	expect(run.manifest.scope).toMatchObject({
		comparison: RUN_COMPARISON.MERGE_BASE,
		oldEndpoint: { kind: RUN_ENDPOINT_KIND.COMMIT },
		newEndpoint: { kind: RUN_ENDPOINT_KIND.COMMIT },
	});
	expect(run.hunks).toContain('filePath: "new-name.txt", oldStart: 0');
	expect(run.hunks).toContain("\\ No newline at end of file");
	expect(run.patch).not.toContain("ignored.txt");

	// The narrating agent reads only hunks.txt, so a file it cannot see has to be named there —
	// otherwise an over-broad ignore silently narrows the review and the narrative reads complete.
	expect(run.hunks).toContain("=== OMITTED FROM THIS RUN ===");
	expect(run.hunks).toContain('"ignored.txt": .revueignore pattern "ignored.txt"');
	expect(run.hunks).toContain('"visible.txt" (matched "secret.txt"): .revueignore pattern');
	expect(run.hunks).toContain("4 changed files were omitted");
});

test("persistent and session ignores compose with rename path provenance", async () => {
	const root = await repository();
	const ignoreFile = "persistent/**\nold-name.ts\n*.generated.ts\n";
	await write(root, ".revueignore", ignoreFile);
	await write(root, "persistent/value.ts", "before\n");
	await write(root, "old-name.ts", "rename me\n");
	await write(root, "src/drop.generated.ts", "before\n");
	await write(root, "src/keep.generated.ts", "before\n");
	await commit(root, "Baseline");
	await git(root, "checkout", "-b", "feature");
	await write(root, "persistent/value.ts", "after\n");
	await git(root, "mv", "old-name.ts", "new-name.ts");
	await write(root, "src/drop.generated.ts", "after\n");
	await write(root, "src/keep.generated.ts", "after\n");
	await commit(root, "Change generated files");

	const run = await prepareRun(
		[
			"main",
			"HEAD",
			"--ignore",
			"!old-name.ts",
			"--ignore",
			"!src/keep.generated.ts",
			"--ignore",
			"src/keep.generated.ts",
		],
		root,
	);

	expect(run.manifest.ignore).toEqual({
		revueIgnore: ["persistent/**", "old-name.ts", "*.generated.ts"],
		session: ["!old-name.ts", "!src/keep.generated.ts", "src/keep.generated.ts"],
	});
	expect(run.manifest.files.map((file) => file.path)).toEqual(["new-name.ts"]);
	expect(run.manifest.exclusions).toEqual([
		{
			path: "persistent/value.ts",
			matchedPath: "persistent/value.ts",
			reason: "revueignore",
			pattern: "persistent/**",
		},
		{
			path: "src/drop.generated.ts",
			matchedPath: "src/drop.generated.ts",
			reason: "revueignore",
			pattern: "*.generated.ts",
		},
		{
			path: "src/keep.generated.ts",
			matchedPath: "src/keep.generated.ts",
			reason: "session-ignore",
			pattern: "src/keep.generated.ts",
		},
	]);
	expect(await readFile(join(root, ".revueignore"), "utf8")).toBe(ignoreFile);
});

test("standard Git excludes hide untracked files but retain tracked changes", async () => {
	const root = await repository();
	const globalExcludes = join(root, "..", `${root.split("/").at(-1)}-global-excludes`);
	await writeFile(globalExcludes, "global-hidden.txt\n");
	try {
		await git(root, "config", "core.excludesFile", globalExcludes);
		await write(root, ".git/info/exclude", "local-hidden.txt\n");
		await write(root, ".gitignore", ".revue/\nrepo-hidden.txt\nkeep.txt\n");
		await write(root, ".revueignore", "ignored.txt\n");
		await write(root, "keep.txt", "before\n");
		await write(root, "ignored.txt", "before\n");
		await git(root, "add", "-f", "keep.txt");
		await commit(root, "Baseline");
		await write(root, "keep.txt", "after\n");
		await write(root, "ignored.txt", "ignored one\n");
		await write(root, "repo-hidden.txt", "review me\n");
		await write(root, "local-hidden.txt", "review me\n");
		await write(root, "global-hidden.txt", "review me\n");

		const first = await prepareRun(["--ref", "work", "--base", "main"], root);
		expect(first.manifest.files.map((file) => file.path)).toEqual(["keep.txt"]);
		await write(root, "ignored.txt", "ignored two\n");
		const second = await prepareRun(["--ref", "work", "--base", "main"], root);

		expect(second.manifest.runId).toBe(first.manifest.runId);
		expect(second.directory).toBe(first.directory);
		const withDifferentInputs = await prepareRun(
			["--ref", "work", "--base", "main", "--ignore", "never/**"],
			root,
		);
		expect(withDifferentInputs.manifest.runId).not.toBe(first.manifest.runId);
	} finally {
		await rm(globalExcludes, { force: true });
	}
});

test("ignoring every changed file fails with paths and rule sources", async () => {
	const root = await repository();
	await write(root, "value.ts", "before\n");
	await commit(root, "Baseline");
	await write(root, "value.ts", "after\n");

	expect(prepareRun(["--ref", "work", "--ignore", "value.ts"], root)).rejects.toThrow(
		'All 1 changed files were omitted from review. Adjust .revueignore or --ignore patterns and run revue prep again.\n- "value.ts": session-ignore pattern "value.ts"',
	);
});

test("an explicit two-dot range compares endpoints instead of the merge base", async () => {
	const root = await repository();
	await write(root, "shared.txt", "baseline\n");
	await commit(root, "Baseline");
	await git(root, "checkout", "-b", "feature");
	await write(root, "feature.txt", "feature\n");
	await commit(root, "Feature work");
	await git(root, "checkout", "main");
	await write(root, "main.txt", "main\n");
	await commit(root, "Main work");

	const direct = await prepareRun(["main..feature"], root);
	const mergeBase = await prepareRun(["main...feature"], root);

	expect(direct.manifest.scope.oldEndpoint.revision).toBe(direct.manifest.scope.base.sha);
	expect(direct.manifest.files.map((file) => file.path)).toEqual(["feature.txt", "main.txt"]);
	expect(mergeBase.manifest.scope.oldEndpoint.revision).toBe(mergeBase.manifest.scope.mergeBaseSha);
	expect(mergeBase.manifest.files.map((file) => file.path)).toEqual(["feature.txt"]);
});

test("prep rejects paths that cannot be represented safely in the terminal", async () => {
	const root = await repository();
	await write(root, "baseline.txt", "baseline\n");
	await commit(root, "Baseline");
	await git(root, "checkout", "-b", "feature");
	await write(root, "unsafe\tpath.txt", "changed\n");
	await commit(root, "Add unsafe path");

	expect(prepareRun(["main", "HEAD"], root)).rejects.toThrow(
		"Cannot review a path containing terminal control characters",
	);
});

test("prep validates both sides of renamed paths", async () => {
	const root = await repository();
	await write(root, "unsafe\told.txt", "content\n");
	await commit(root, "Baseline");
	await git(root, "checkout", "-b", "feature");
	await git(root, "mv", "unsafe\told.txt", "safe.txt");
	await commit(root, "Rename unsafe path");

	expect(prepareRun(["main", "HEAD"], root)).rejects.toThrow(
		"Cannot review a path containing terminal control characters",
	);
});

test("local modes do not require a main branch", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-prep-"));
	repositories.push(root);
	await git(root, "init", "-b", "feature");
	await git(root, "config", "user.email", "revue@example.com");
	await git(root, "config", "user.name", "Revue Test");
	await write(root, "value.txt", "before\n");
	await commit(root, "Baseline");
	await write(root, "value.txt", "after\n");
	await git(root, "add", "value.txt");

	const staged = await prepareRun(["--ref", "staged"], root);

	expect(staged.manifest.scope.base.ref).toBe("HEAD");
	expect(staged.manifest.files.map((file) => file.path)).toEqual(["value.txt"]);
});

test("local modes capture work, staged, and unstaged scopes independently", async () => {
	const root = await repository();
	await write(root, "staged.txt", "before staged\n");
	await write(root, "unstaged.txt", "before unstaged\n");
	await commit(root, "Baseline");
	await write(root, "staged.txt", "after staged\n");
	await git(root, "add", "staged.txt");
	await write(root, "unstaged.txt", "after unstaged\n");
	await write(root, "untracked.txt", "new file\n");

	const work = await prepareRun(["--ref", "work", "--base", "main"], root);
	const staged = await prepareRun(["--ref", "staged", "--base", "main"], root);
	const unstaged = await prepareRun(["--ref", "unstaged", "--base", "main"], root);

	expect(work.manifest.files.map((file) => file.path)).toEqual([
		"staged.txt",
		"unstaged.txt",
		"untracked.txt",
	]);
	expect(staged.manifest.files.map((file) => file.path)).toEqual(["staged.txt"]);
	expect(unstaged.manifest.files.map((file) => file.path)).toEqual(["unstaged.txt"]);
	expect(work.manifest.scope.newEndpoint.kind).toBe(RUN_ENDPOINT_KIND.WORKTREE);
	expect(staged.manifest.scope.newEndpoint.kind).toBe(RUN_ENDPOINT_KIND.INDEX_TREE);
	expect(unstaged.manifest.scope.oldEndpoint.kind).toBe(RUN_ENDPOINT_KIND.INDEX_TREE);
});
