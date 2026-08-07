import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	RevueChaptersFileSchema,
	runManifestSchema,
	THREAD_AUTHOR_KIND,
	viewStateFileId,
	viewStateKeyChangeId,
} from "@revue/types";
import { openThreadStore } from "./threads.ts";
import { runKey } from "./viewState.ts";

const mainPath = resolve(import.meta.dir, "main.tsx");
const sampleRun = resolve(import.meta.dir, "../../../examples/sample-run");

const run = async (cwd: string, args: string[], env?: Record<string, string>) => {
	const child = Bun.spawn([process.execPath, mainPath, ...args], {
		cwd,
		env: env ? { ...process.env, ...env } : undefined,
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

const copySampleRun = async (root: string): Promise<string> => {
	const directory = join(root, "sample-run");
	await mkdir(join(root, ".git"));
	await cp(sampleRun, directory, { recursive: true });
	return directory;
};

test("thread CLI creates authored conversations and exposes lifecycle operations as JSON", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-threads-cli-"));
	try {
		const reviewRun = await copySampleRun(root);
		const manifest = runManifestSchema.parse(await Bun.file(join(reviewRun, "run.json")).json());
		const bodyFile = join(root, "agent-message.txt");
		await writeFile(bodyFile, "Use a lower retry cap\nfor interactive requests.");
		const created = await run(root, [
			"threads",
			"create",
			reviewRun,
			"--file",
			"src/lib/backoff.ts",
			"--old-start",
			"0",
			"--side",
			"additions",
			"--start-line",
			"4",
			"--end-line",
			"6",
			"--author",
			"Review agent",
			"--body-file",
			bodyFile,
		]);
		expect(created).toMatchObject({ exitCode: 0, stderr: "" });
		const thread = JSON.parse(created.stdout).thread;
		expect(thread.messages[0]).toMatchObject({
			author: { kind: THREAD_AUTHOR_KIND.AGENT, name: "Review agent" },
			body: "Use a lower retry cap\nfor interactive requests.",
		});

		const replied = await run(root, [
			"threads",
			"reply",
			reviewRun,
			thread.id,
			"--author",
			"Fix agent",
			"--body",
			"Adjusted in the next revision.",
		]);
		expect(replied).toMatchObject({ exitCode: 0, stderr: "" });
		const reply = JSON.parse(replied.stdout).thread.messages[1];
		expect(reply).toMatchObject({
			author: { kind: THREAD_AUTHOR_KIND.AGENT, name: "Fix agent" },
			body: "Adjusted in the next revision.",
		});

		const listed = await run(root, ["threads", "list", reviewRun, "--json"]);
		expect(listed).toMatchObject({ exitCode: 0, stderr: "" });
		expect(JSON.parse(listed.stdout)).toMatchObject({
			runId: manifest.runId,
			threads: [{ id: thread.id, messages: [{}, {}] }],
		});
		const alias = await run(root, ["comments", "list", reviewRun, "--json"]);
		expect(JSON.parse(alias.stdout).threads).toHaveLength(1);

		const dealt = await run(root, ["threads", "mark-dealt", reviewRun, thread.id]);
		expect(JSON.parse(dealt.stdout).thread.status).toBe("dealt-with");
		expect(
			JSON.parse((await run(root, ["threads", "list", reviewRun, "--json"])).stdout).threads,
		).toEqual([]);
		expect(
			JSON.parse((await run(root, ["threads", "list", reviewRun, "--json", "--all"])).stdout)
				.threads,
		).toHaveLength(1);

		const reopened = await run(root, ["threads", "reopen", reviewRun, thread.id]);
		expect(JSON.parse(reopened.stdout).thread.status).toBe("open");
		const deletedMessage = await run(root, [
			"threads",
			"delete-message",
			reviewRun,
			thread.id,
			reply.id,
		]);
		expect(JSON.parse(deletedMessage.stdout).message.id).toBe(reply.id);

		const missing = await run(root, [
			"threads",
			"delete",
			reviewRun,
			"00000000-0000-4000-8000-000000000099",
		]);
		expect(missing).toMatchObject({ exitCode: 1, stdout: "" });
		expect(missing.stderr).toContain("does not exist in this run");
		const malformed = await run(root, ["threads", "delete", reviewRun, "not-an-id"]);
		expect(malformed).toMatchObject({ exitCode: 1, stdout: "" });
		expect(malformed.stderr).toContain("Thread ID must be a UUID");

		const deleted = await run(root, ["threads", "delete", reviewRun, thread.id]);
		expect(JSON.parse(deleted.stdout).thread.id).toBe(thread.id);
		expect(
			JSON.parse((await run(root, ["threads", "list", reviewRun, "--json", "--all"])).stdout)
				.threads,
		).toEqual([]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("thread operations reject stale anchors against the verified pinned patch", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-threads-stale-"));
	try {
		const reviewRun = await copySampleRun(root);
		const manifest = runManifestSchema.parse(await Bun.file(join(reviewRun, "run.json")).json());
		openThreadStore(join(root, ".revue", "threads.json"), manifest.runId).create(
			{
				filePath: "src/lib/backoff.ts",
				oldStart: 0,
				side: "additions",
				startLine: 999,
				endLine: 999,
			},
			{ kind: THREAD_AUTHOR_KIND.AGENT, name: "Review agent" },
			"Stale feedback",
		);
		const result = await run(root, ["threads", "list", reviewRun, "--json"]);
		expect(result).toMatchObject({ exitCode: 1, stdout: "" });
		expect(result.stderr).toContain("corrupt or stale anchor");
		expect(result.stderr).toContain("outside that review unit");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("export selects chapters unambiguously and preserves read-only review state", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-export-cli-"));
	try {
		const reviewRun = await copySampleRun(root);
		const withoutState = await run(root, ["export", reviewRun, "--chapter-id", "chapter-2"]);
		expect(withoutState).toMatchObject({ exitCode: 0, stderr: "" });
		expect(withoutState.stdout).toContain(
			"# Chapter 2: Retry transient failures in the API client",
		);
		expect(withoutState.stdout).toContain("- [ ] Chapter reviewed");
		expect(withoutState.stdout).toContain(
			"- [ ] `src/lib/apiClient.ts` — status: modified; file total: +9 / -1",
		);
		expect(withoutState.stdout).not.toContain("Add a reusable backoff helper");
		expect(await Bun.file(join(root, ".revue", "state.json")).exists()).toBe(false);

		const manifest = runManifestSchema.parse(await Bun.file(join(reviewRun, "run.json")).json());
		const chapters = RevueChaptersFileSchema.parse(
			await Bun.file(join(reviewRun, "chapters.json")).json(),
		);
		const key = runKey(manifest.runId, chapters);
		const statePath = join(root, ".revue", "state.json");
		const stateContents = `${JSON.stringify({
			[key]: {
				chapters: ["chapter-2"],
				files: [viewStateFileId("chapter-2", "src/lib/apiClient.ts")],
				keyChanges: [viewStateKeyChangeId("chapter-2", 0)],
			},
		})}\n`;
		await mkdir(join(root, ".revue"));
		await writeFile(statePath, stateContents);
		const output = join(root, "chapter.md");
		const toFile = await run(root, [
			"export",
			reviewRun,
			"--chapter-order",
			"2",
			"--output",
			output,
		]);
		expect(toFile).toMatchObject({
			exitCode: 0,
			stdout: "",
			stderr: `Wrote Markdown export to ${output}\n`,
		});
		const markdown = await Bun.file(output).text();
		expect(markdown).toContain("- [x] Chapter reviewed");
		expect(markdown).toContain("- [x] `src/lib/apiClient.ts`");
		expect(markdown).toContain("1. [x] Should retries be capped per-request");
		expect(await Bun.file(statePath).text()).toBe(stateContents);

		const ambiguous = await run(root, [
			"export",
			reviewRun,
			"--chapter-id",
			"chapter-2",
			"--chapter-order",
			"2",
		]);
		expect(ambiguous).toMatchObject({ exitCode: 1, stdout: "" });
		expect(ambiguous.stderr).toContain("choose only one of");

		const missingOutput = await run(root, ["export", reviewRun, "--output", "--prologue"]);
		expect(missingOutput).toMatchObject({ exitCode: 1, stdout: "" });
		expect(missingOutput.stderr).toContain("--output requires a path");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

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
		expect(checked.stdout).toContain("1 of 1 review unit narrated");
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

		const mismatchedExport = await run(root, ["export", runDirectory]);
		expect(mismatchedExport).toMatchObject({ exitCode: 1, stdout: "" });
		expect(mismatchedExport.stderr).toContain("does not cover the prepared run");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a run without chapters.json validates, opens flat, and still takes threads", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-chapterless-"));
	try {
		const reviewRun = await copySampleRun(root);
		await rm(join(reviewRun, "chapters.json"));

		const checked = await run(root, ["show", reviewRun, "--check"]);
		expect(checked).toMatchObject({ exitCode: 0, stderr: "" });
		expect(checked.stdout).toContain("chapterless run is valid");
		expect(checked.stdout).toContain("3 files, 3 review units, +24 -1");
		expect(checked.stdout).toContain("flat file-by-file diff");

		const created = await run(root, [
			"threads",
			"create",
			reviewRun,
			"--file",
			"src/lib/backoff.ts",
			"--old-start",
			"0",
			"--side",
			"additions",
			"--start-line",
			"4",
			"--end-line",
			"6",
			"--author",
			"Review agent",
			"--body",
			"Confirm the cap.",
		]);
		expect(created).toMatchObject({ exitCode: 0, stderr: "" });
		const listed = await run(root, ["threads", "list", reviewRun, "--json"]);
		expect(JSON.parse(listed.stdout).threads).toHaveLength(1);

		const exported = await run(root, ["export", reviewRun]);
		expect(exported).toMatchObject({ exitCode: 1, stdout: "" });
		expect(exported.stderr).toContain("needs a narrated run");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("bare revue and revue diff prep the scope and print the run directory", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-diff-cli-"));
	try {
		await git(root, "init", "-b", "main");
		await git(root, "config", "user.email", "revue@example.com");
		await git(root, "config", "user.name", "Revue Test");
		await mkdir(join(root, "src"));
		await writeFile(join(root, "src", "value.ts"), "export const value = 1;\n");
		await git(root, "add", "-A");
		await git(root, "commit", "-m", "Baseline");
		await writeFile(join(root, "src", "value.ts"), "export const value = 2;\n");

		// stdout is not a TTY here, so the shared open path prints the summary instead.
		const bare = await run(root, []);
		expect(bare.exitCode).toBe(0);
		expect(bare.stderr).toContain("Prepared work run");
		expect(bare.stdout).toContain("chapterless run is valid");

		const scoped = await run(root, ["diff", "--ref", "unstaged"]);
		expect(scoped.exitCode).toBe(0);
		expect(scoped.stderr).toContain("Prepared unstaged run");
		const directory = scoped.stderr.trim().split("\n").at(-1) ?? "";
		expect(await Bun.file(join(directory, "run.json")).exists()).toBe(true);

		// The theme is validated before git prep runs, so no "Prepared ..." summary is printed.
		const badTheme = await run(root, ["diff", "--theme", "solarised-dark"]);
		expect(badTheme).toMatchObject({ exitCode: 1, stdout: "" });
		expect(badTheme.stderr).toBe(
			"unknown theme: solarised-dark\nRun `revue show <run-directory> --theme list` or `revue themes` for details.\n",
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("show names its themes, including custom ones, and refuses an unknown one before touching the run", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-theme-"));
	try {
		const directory = await copySampleRun(root);
		const themesDir = join(root, ".revue", "themes");
		await mkdir(themesDir, { recursive: true });
		await writeFile(
			join(themesDir, "mauve.json"),
			JSON.stringify({ extends: "nord", label: "Mauve" }),
			"utf8",
		);

		const listed = await run(root, ["show", directory, "--theme", "list"], { HOME: root });
		expect(listed.exitCode).toBe(0);
		const ids = listed.stdout.trim().split("\n");
		expect(ids).toContain("github-dark-default");
		expect(ids).toContain("mauve");

		const unknown = await run(root, ["show", directory, "--theme", "solarised-dark"]);
		expect(unknown).toMatchObject({ exitCode: 1, stdout: "" });
		expect(unknown.stderr).toBe(
			"unknown theme: solarised-dark\nRun `revue show <run-directory> --theme list` or `revue themes` for details.\n",
		);

		const known = await run(root, ["show", directory, "--theme", "nord", "--check"]);
		expect(known.exitCode).toBe(0);
		expect(known.stdout).toContain("run is valid");

		// A broken run directory never gets touched: the unknown theme is rejected first.
		const brokenRun = join(root, "does-not-exist");
		const beforeRun = await run(root, ["show", brokenRun, "--theme", "solarised-dark"]);
		expect(beforeRun).toMatchObject({ exitCode: 1, stdout: "" });
		expect(beforeRun.stderr).toContain("unknown theme: solarised-dark");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("show resolves a custom theme by id from ~/.revue/themes", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-custom-theme-"));
	try {
		const directory = await copySampleRun(root);
		const themesDir = join(root, ".revue", "themes");
		await mkdir(themesDir, { recursive: true });
		await writeFile(
			join(themesDir, "mauve.json"),
			JSON.stringify({ extends: "nord", label: "Mauve" }),
			"utf8",
		);

		const known = await run(root, ["show", directory, "--theme", "mauve", "--check"], {
			HOME: root,
		});
		expect(known.exitCode).toBe(0);
		expect(known.stdout).toContain("run is valid");

		const unknown = await run(root, ["show", directory, "--theme", "not-a-theme", "--check"], {
			HOME: root,
		});
		expect(unknown).toMatchObject({ exitCode: 1, stdout: "" });
		expect(unknown.stderr).toContain("unknown theme: not-a-theme");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

// Stands in for the skills CLI (vercel-labs/skills): records its arguments and copies the
// handed-over skill where a real run would install it for Claude Code at project scope.
const fakeSkillsRunner = async (root: string): Promise<{ executable: string; log: string }> => {
	const executable = join(root, "fake-skills");
	const log = join(root, "runner-args.log");
	await writeFile(
		executable,
		`#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(log)}
mkdir -p .claude/skills/revue
cp "$2/SKILL.md" .claude/skills/revue/SKILL.md
`,
	);
	await chmod(executable, 0o755);
	return { executable, log };
};

test("skill install hands a version-stamped skill to the skills CLI runner", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-skill-"));
	try {
		await git(root, "init", "-b", "main");
		const { executable, log } = await fakeSkillsRunner(root);

		const installed = await run(root, ["skill", "install"], { REVUE_SKILL_RUNNER: executable });
		expect(installed.exitCode).toBe(0);

		const runnerArgs = (await Bun.file(log).text()).trim().split("\n");
		expect(runnerArgs[0]).toBe("add");
		expect(runnerArgs.slice(2)).toEqual(["--copy", "-y"]);

		const contents = await Bun.file(join(root, ".claude", "skills", "revue", "SKILL.md")).text();
		expect(contents).toMatch(/^---\nrevue-version: \d+\.\d+\.\d+\n/);
		expect(contents).toContain("# revue");

		const userScope = await run(root, ["skill", "install", "--user"], {
			REVUE_SKILL_RUNNER: executable,
		});
		expect(userScope.exitCode).toBe(0);
		expect((await Bun.file(log).text()).trim().split("\n").slice(2)).toEqual([
			"--copy",
			"-y",
			"-g",
		]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("skill install without any package runner prints manual instructions and fails", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-skill-norunner-"));
	try {
		const missing = await run(root, ["skill", "install"], { PATH: "/var/empty" });
		expect(missing.exitCode).toBe(1);
		expect(missing.stderr).toContain("No package runner found");
		expect(missing.stderr).toContain("revue skill print");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("skill print writes the stamped skill to stdout", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-skill-print-"));
	try {
		const printed = await run(root, ["skill", "print"]);
		expect(printed).toMatchObject({ exitCode: 0, stderr: "" });
		expect(printed.stdout).toMatch(/^---\nrevue-version: \d+\.\d+\.\d+\n/);
		expect(printed.stdout).toContain("# revue");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("doctor reports dependency and skill state and exits by git availability", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-doctor-"));
	try {
		await git(root, "init", "-b", "main");
		const before = await run(root, ["doctor"]);
		expect(before.exitCode).toBe(0);
		expect(before.stdout).toContain("git: ok");
		expect(before.stdout).toContain("skill project: not installed");

		const { executable } = await fakeSkillsRunner(root);
		await run(root, ["skill", "install"], { REVUE_SKILL_RUNNER: executable });
		const after = await run(root, ["doctor"]);
		expect(after.exitCode).toBe(0);
		expect(after.stdout).toMatch(/skill project: ok \(\d+\.\d+\.\d+\)/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("keybindings lists every action and flags overrides and issues", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-keybindings-cli-"));
	try {
		await mkdir(join(root, ".revue"));
		await writeFile(
			join(root, ".revue", "keybindings.json"),
			JSON.stringify({ quit: "z", "not-a-real-action": "x" }),
		);
		const listing = await run(root, ["keybindings"], { HOME: root });
		expect(listing.exitCode).toBe(0);
		expect(listing.stdout).toContain("line-up");
		expect(listing.stdout).toMatch(/quit\s+z\s+Quit \(Esc also works\) \(overridden, default: q\)/);
		expect(listing.stdout).toContain("Issues:");
		expect(listing.stdout).toContain('not-a-real-action: unknown action "not-a-real-action"');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("keybindings init writes a starter template and refuses to overwrite it without --force", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-keybindings-init-"));
	try {
		const init = await run(root, ["keybindings", "init"], { HOME: root });
		expect(init.exitCode).toBe(0);
		expect(init.stdout).toContain(join(root, ".revue", "keybindings.json"));
		const written = await Bun.file(join(root, ".revue", "keybindings.json")).text();
		expect(written).toContain('// "quit": ["q"]');

		const again = await run(root, ["keybindings", "init"], { HOME: root });
		expect(again.exitCode).toBe(1);
		expect(again.stderr).toContain("already exists");

		const forced = await run(root, ["keybindings", "init", "--force"], { HOME: root });
		expect(forced.exitCode).toBe(0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("themes lists bundled and custom themes and flags shadowed overrides and issues", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-themes-cli-"));
	try {
		await mkdir(join(root, ".revue", "themes"), { recursive: true });
		await writeFile(
			join(root, ".revue", "themes", "ayu-dark.json"),
			JSON.stringify({ extends: "ayu-dark", overrides: { accent: "#ff0000" } }),
		);
		await writeFile(join(root, ".revue", "themes", "broken.json"), "{not json");
		const listing = await run(root, ["themes"], { HOME: root });
		expect(listing.exitCode).toBe(0);
		expect(listing.stdout).toContain("dark:");
		expect(listing.stdout).toMatch(/ayu-dark.*\(customised\)/);
		expect(listing.stdout).toContain("Issues:");
		expect(listing.stdout).toContain("broken: malformed JSON; theme ignored");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("themes init writes a starter template that parses cleanly, and refuses to overwrite it without --force", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-themes-init-"));
	try {
		const init = await run(root, ["themes", "init", "my-theme"], { HOME: root });
		expect(init.exitCode).toBe(0);
		expect(init.stdout).toContain(join(root, ".revue", "themes", "my-theme.json"));
		const written = await Bun.file(join(root, ".revue", "themes", "my-theme.json")).text();
		expect(written).toContain('"extends": "ayu-dark"');

		const listing = await run(root, ["themes"], { HOME: root });
		expect(listing.exitCode).toBe(0);
		expect(listing.stdout).not.toContain("Issues:");

		const again = await run(root, ["themes", "init", "my-theme"], { HOME: root });
		expect(again.exitCode).toBe(1);
		expect(again.stderr).toContain("already exists");

		const forced = await run(root, ["themes", "init", "my-theme", "--force"], { HOME: root });
		expect(forced.exitCode).toBe(0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("themes init refuses a name containing a path separator or leading dot", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-themes-init-unsafe-"));
	try {
		const traversal = await run(root, ["themes", "init", "../evil"], { HOME: root });
		expect(traversal.exitCode).toBe(1);
		expect(traversal.stderr).toContain('invalid theme name "../evil"');
		expect(await Bun.file(join(root, "evil.json")).exists()).toBe(false);

		const nested = await run(root, ["themes", "init", "nested/name"], { HOME: root });
		expect(nested.exitCode).toBe(1);
		expect(nested.stderr).toContain('invalid theme name "nested/name"');

		const hidden = await run(root, ["themes", "init", ".hidden"], { HOME: root });
		expect(hidden.exitCode).toBe(1);
		expect(hidden.stderr).toContain('invalid theme name ".hidden"');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("prep --pr fetches a pull request head from the remote and pins it as the compare ref", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-prep-pr-"));
	try {
		const upstream = join(root, "upstream");
		await mkdir(upstream);
		await git(upstream, "init", "-b", "main");
		await git(upstream, "config", "user.email", "revue@example.com");
		await git(upstream, "config", "user.name", "Revue Test");
		await writeFile(join(upstream, "value.txt"), "one\n");
		await git(upstream, "add", "-A");
		await git(upstream, "commit", "-m", "Baseline");
		await git(upstream, "checkout", "-b", "feature");
		await writeFile(join(upstream, "value.txt"), "two\n");
		await git(upstream, "add", "-A");
		await git(upstream, "commit", "-m", "Change value");
		await git(upstream, "update-ref", "refs/pull/1/head", "feature");
		await git(upstream, "checkout", "main");

		const clone = join(root, "clone");
		await git(root, "clone", "--quiet", upstream, clone);

		const prepped = await run(clone, ["prep", "--pr", "1"]);
		expect(prepped.exitCode).toBe(0);
		expect(prepped.stderr).toContain("head  pull/1/head");
		const runDirectory = prepped.stdout.trim();
		const manifest = runManifestSchema.parse(await Bun.file(join(runDirectory, "run.json")).json());
		expect(manifest.scope.mode).toBe("committed");
		expect(manifest.scope.head.ref).toBe("pull/1/head");
		expect(manifest.totals.files).toBe(1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
