import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const mainPath = resolve(import.meta.dir, "main.ts");
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI SGR parsing is intentional.
const sgr = /\x1b\[[\d;]*m/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal control detection is intentional.
const unsafeControl = /\x1b|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const baselineSource = Array.from(
	{ length: 24 },
	(_, index) => `const line${String(index + 1).padStart(2, "0")} = ${index + 1};\n`,
).join("");
const changedSource = baselineSource
	.replace("const line01 = 1;", 'const line01 = "界👩‍💻";')
	.replace(
		"const line24 = 24;",
		'const line24 = "this is a deliberately long changed line with a tab\tand enough text to wrap";',
	);

type CommandOptions = {
	command: string[];
	cwd: string;
	input?: string;
	env?: Record<string, string | undefined>;
};

const runCommand = async ({ command, cwd, input = "", env }: CommandOptions) => {
	const child = Bun.spawn(command, { cwd, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
	child.stdin.write(input);
	child.stdin.end();
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
};

const runGit = async (cwd: string, args: string[]) => {
	const result = await runCommand({ command: ["git", ...args], cwd });
	if (result.exitCode !== 0) throw new Error(result.stderr);
	return result.stdout;
};

const initialiseRepository = async (directory: string) => {
	await runGit(directory, ["init", "--quiet"]);
	await runGit(directory, ["config", "user.email", "pager@example.com"]);
	await runGit(directory, ["config", "user.name", "Pager Test"]);
	await runGit(directory, ["config", "core.filemode", "true"]);
};

const writeBaseline = async (directory: string) => {
	await Promise.all([mkdir(join(directory, "src")), mkdir(join(directory, "docs"))]);
	await Promise.all([
		writeFile(join(directory, "src/complex.ts"), baselineSource),
		writeFile(join(directory, "no-newline.txt"), "without newline"),
		writeFile(join(directory, "docs/original.txt"), "rename me\n"),
		writeFile(join(directory, "script.sh"), "#!/bin/sh\necho hi\n"),
		writeFile(join(directory, "blob.bin"), new Uint8Array([0, 111, 108, 100, 1])),
	]);
	await runGit(directory, ["add", "."]);
	await runGit(directory, ["commit", "--quiet", "-m", "baseline"]);
};

const writeChanges = async (directory: string) => {
	await runGit(directory, ["mv", "docs/original.txt", "docs/renamed.txt"]);
	await Promise.all([
		writeFile(join(directory, "src/complex.ts"), changedSource),
		writeFile(join(directory, "no-newline.txt"), "changed without newline"),
		writeFile(join(directory, "blob.bin"), new Uint8Array([0, 110, 101, 119, 2])),
		writeFile(join(directory, "empty.txt"), ""),
		chmod(join(directory, "script.sh"), 0o755),
	]);
	await runGit(directory, ["add", "--all"]);
};

const createColouredDiff = async (directory: string) => {
	await initialiseRepository(directory);
	await writeBaseline(directory);
	await writeChanges(directory);
	return runGit(directory, [
		"-c",
		"color.ui=always",
		"diff",
		"--cached",
		"--color=always",
		"--no-ext-diff",
		"--find-renames",
		"HEAD",
	]);
};

const runPager = (directory: string, input: string, width: number) =>
	runCommand({
		command: [process.execPath, mainPath, "--paging=never", `--width=${width}`, "--theme=ayu-dark"],
		cwd: repoRoot,
		input,
		env: { ...process.env, HOME: directory },
	});

const expectSafeAnsi = (output: string, visible: string) => {
	expect(output).toContain("\x1b[");
	expect(output).not.toContain("\x1b[31m");
	expect(visible).not.toMatch(unsafeControl);
	expect(visible).not.toContain("diff --git");
};

const expectBoundedLayout = (visible: string, width: number) => {
	for (const line of visible.split("\n")) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width);
	if (width === 79) expect(visible).not.toContain("│");
	else expect(visible).toContain("│");
};

const expectComplexOutput = (output: string, width: number) => {
	const visible = output.replace(sgr, "");
	for (const fragment of [
		"Binary file differs.",
		"docs/original.txt -> docs/renamed.txt",
		"Renamed without changes.",
		"New empty file.",
		"changed without newline",
		"Mode 100644 -> 100755.",
		"src/complex.ts  +2 -2",
		"界👩‍💻",
	])
		expect(visible).toContain(fragment);
	const compact = visible.replace(/[^\p{L}\p{N}]/gu, "");
	expect(compact).toContain("thisisadeliberatelylongchangedlinewithatabandenoughtexttowrap");
	expectSafeAnsi(output, visible);
	expectBoundedLayout(visible, width);
};

test("real coloured Git output renders complex files safely at stack and split widths", async () => {
	const directory = await mkdtemp(join(tmpdir(), "revue-pager-git-"));
	try {
		const input = await createColouredDiff(directory);
		const gitText = input.replace(sgr, "");
		expect(input).toContain("\x1b[");
		for (const fragment of [
			"Binary files a/blob.bin and b/blob.bin differ",
			"similarity index 100%",
			"new file mode 100644",
			"\\ No newline at end of file",
			"old mode 100644",
			"@@ -21,4 +21,4 @@",
		])
			expect(gitText).toContain(fragment);
		for (const width of [79, 80]) {
			const result = await runPager(directory, input, width);
			expect(result).toMatchObject({ exitCode: 0, stderr: "" });
			expectComplexOutput(result.stdout, width);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 30_000);
