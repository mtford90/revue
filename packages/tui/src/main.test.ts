import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runManifestSchema } from "@revue/types";

const mainPath = resolve(import.meta.dir, "main.tsx");

const run = async (cwd: string, args: string[]) => {
	const child = Bun.spawn(["bun", mainPath, ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
};

const git = async (cwd: string, ...args: string[]): Promise<void> => {
	const child = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "pipe" });
	const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
	if (exitCode !== 0) throw new Error(stderr);
};

test("prep composes persistent and session ignore controls without mutating the file", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-cli-ignore-"));
	try {
		await git(root, "init", "-b", "main");
		await git(root, "config", "user.email", "revue@example.com");
		await git(root, "config", "user.name", "Revue Test");
		await mkdir(join(root, "fixtures"));
		await mkdir(join(root, "src"));
		const persistentRules = "# review fixtures separately\nfixtures/**\n";
		await writeFile(join(root, ".revueignore"), persistentRules);
		await writeFile(join(root, "fixtures", "value.ts"), "before\n");
		await writeFile(join(root, "src", "value.generated.ts"), "before\n");
		await writeFile(join(root, "src", "value.ts"), "before\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Baseline");
		await git(root, "checkout", "-b", "feature");
		await writeFile(join(root, "fixtures", "value.ts"), "after\n");
		await writeFile(join(root, "src", "value.generated.ts"), "after\n");
		await writeFile(join(root, "src", "value.ts"), "after\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Change values");

		const prepared = await run(root, [
			"prep",
			"main",
			"HEAD",
			"--ignore",
			"*.generated.ts",
			"--show-ignored",
		]);
		const runDirectory = prepared.stdout.trim();

		expect(prepared.exitCode).toBe(0);
		expect(prepared.stderr).toContain("1 files, 1 review units, +1 -1, 2 omitted");
		expect(prepared.stderr).toContain(
			'Effective review ignore patterns (.revueignore, then --ignore):\n  .revueignore "fixtures/**"\n  --ignore     "*.generated.ts"',
		);
		expect(prepared.stderr).toContain(
			'Omitted paths:\n  "fixtures/value.ts": .revueignore "fixtures/**"\n  "src/value.generated.ts": --ignore "*.generated.ts"',
		);
		const manifest = runManifestSchema.parse(await Bun.file(join(runDirectory, "run.json")).json());
		expect(manifest.ignore).toEqual({
			revueIgnore: ["fixtures/**"],
			session: ["*.generated.ts"],
		});
		expect(manifest.exclusions.map(({ reason }) => reason)).toEqual([
			"revueignore",
			"session-ignore",
		]);
		expect(await Bun.file(join(root, ".revueignore")).text()).toBe(persistentRules);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("prep prints only the run path and show validates that same run", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-cli-"));
	try {
		await git(root, "init", "-b", "main");
		await git(root, "config", "user.email", "revue@example.com");
		await git(root, "config", "user.name", "Revue Test");
		await mkdir(join(root, "src"));
		await writeFile(join(root, "src", "value.ts"), "export const value = 1;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Baseline");
		await git(root, "checkout", "-b", "feature");
		await writeFile(join(root, "src", "value.ts"), "export const value = 2;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Change value");

		const prepared = await run(root, ["prep", "main", "HEAD"]);
		const runDirectory = prepared.stdout.trim();
		expect(prepared.exitCode).toBe(0);
		expect(prepared.stdout).toBe(`${runDirectory}\n`);
		expect(prepared.stderr).toContain("Prepared committed run");
		const manifest = runManifestSchema.parse(await Bun.file(join(runDirectory, "run.json")).json());
		const reference = manifest.files[0];
		const oldStart = reference?.referenceStarts[0];
		if (!reference || oldStart === undefined) throw new Error("Expected a prepared review unit");
		const chaptersPath = join(runDirectory, "chapters.json");
		const chapters = {
			chapters: [
				{
					id: "chapter-1",
					order: 1,
					title: "Change the value",
					summary: "The value now reflects the new behaviour.",
					hunkRefs: [{ filePath: reference.path, oldStart }],
					keyChanges: [],
				},
			],
		};
		await writeFile(chaptersPath, `${JSON.stringify(chapters)}\n`);

		const checked = await run(root, ["show", runDirectory, "--check"]);
		expect(checked).toMatchObject({ exitCode: 0, stderr: "" });
		expect(checked.stdout).toContain("1 chapter:");

		const mismatchedChapters = {
			chapters: chapters.chapters.map((chapter) => ({
				...chapter,
				hunkRefs: chapter.hunkRefs.map((reference) => ({
					...reference,
					oldStart: reference.oldStart + 999,
				})),
			})),
		};
		await writeFile(chaptersPath, `${JSON.stringify(mismatchedChapters)}\n`);
		const mismatched = await run(root, ["show", runDirectory, "--check"]);
		expect(mismatched).toMatchObject({ exitCode: 1, stdout: "" });
		expect(mismatched.stderr).toContain("does not cover the prepared run");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
