import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const mainPath = resolve(import.meta.dir, "main.ts");
const pagerPath = resolve(import.meta.dir, "pager.ts");
const patch = `diff --git a/a b/a
index 1111111..2222222 100644
--- a/a
+++ b/a
@@ -1 +1 @@
-old
+new
`;
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI SGR parsing is intentional.
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

async function writePagerRunner(directory: string): Promise<string> {
	const runner = join(directory, "run-pager.ts");
	await writeFile(
		runner,
		`import { runPager } from ${JSON.stringify(pagerPath)};
Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
const status = await runPager(process.env.PATCH ?? "", { lineNumbers: false, changeMarkers: false, paging: "always", pager: process.env.FAKE_PAGER });
process.exit(status);
`,
	);
	return runner;
}

async function waitFor(path: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			await readFile(path);
			return;
		} catch {
			await Bun.sleep(10);
		}
	}
	throw new Error(`timed out waiting for ${path}`);
}

const run = async (runner: string, pager: string) => {
	const child = Bun.spawn([process.execPath, runner], {
		env: { ...process.env, PATCH: patch, FAKE_PAGER: pager },
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

const runCliPager = async (args: string[], input = patch, env?: Record<string, string>) => {
	const child = Bun.spawn([process.execPath, mainPath, ...args], {
		env: { ...process.env, ...env },
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	child.stdin.write(input);
	child.stdin.end();
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
};

test("standalone help, version, and invalid options keep streams separate", async () => {
	const help = await runCliPager(["--help"], "");
	expect(help).toMatchObject({ exitCode: 0, stderr: "" });
	expect(help.stdout).toContain("Usage:\n  revuediff");
	const version = await runCliPager(["--version"], "");
	expect(version).toEqual({ exitCode: 0, stdout: "revuediff 0.1.0\n", stderr: "" });
	const invalid = await runCliPager(["--wat"], "unread input");
	expect(invalid).toMatchObject({ exitCode: 1, stdout: "" });
	expect(invalid.stderr).toContain("unknown revuediff option");
	const theme = await runCliPager(["--theme=not-a-theme"], "unread input");
	expect(theme).toMatchObject({ exitCode: 1, stdout: "" });
	expect(theme.stderr).toContain("unknown theme: not-a-theme");
});

test("non-TTY auto mode directly emits sanitised ANSI output", async () => {
	const result = await runCliPager([
		"--no-config",
		"--paging=auto",
		"--width=80",
		"--theme=ayu-dark",
	]);
	expect(result).toMatchObject({ exitCode: 0, stderr: "" });
	expect(result.stdout).toContain("a  +1 -1");
	expect(result.stdout).toContain("\x1b[");
	expect(result.stdout).not.toContain("\x1b[31m");
});

test("chrome flags default off and reject duplicate or conflicting forms", async () => {
	const plain = stripAnsi(
		(await runCliPager(["--no-config", "--paging=never", "--width=40"])).stdout,
	);
	expect(plain).toContain(" old");
	expect(plain).not.toContain("1   -");
	const both = stripAnsi(
		(
			await runCliPager([
				"--no-config",
				"--paging=never",
				"--width=40",
				"--line-numbers",
				"--change-markers",
			])
		).stdout,
	);
	expect(both).toContain("1   -");
	for (const args of [
		["--line-numbers", "--no-line-numbers"],
		["--change-markers", "--change-markers"],
	]) {
		const result = await runCliPager(["--no-config", ...args], "unread input");
		expect(result).toMatchObject({ exitCode: 1, stdout: "" });
		expect(result.stderr).toContain("may only be specified once");
	}
});

test("config discovery, precedence, warnings, show, init, and explicit missing paths", async () => {
	const directory = await mkdtemp(join(tmpdir(), "revuediff-config-process-"));
	const xdg = join(directory, "xdg");
	const config = join(xdg, "revuediff", "config.toml");
	try {
		await mkdir(join(xdg, "revuediff"), { recursive: true });
		await writeFile(
			config,
			`[display]\nline-numbers = true\nchange-markers = false\ntheme = "ayu-dark"\nunknown = true\n[paging]\nmode = "never"\n`,
		);
		const env = { XDG_CONFIG_HOME: xdg, REVUEDIFF_CONFIG: "" };
		const configured = await runCliPager(["--width=40"], patch, env);
		expect(configured.exitCode).toBe(0);
		expect(configured.stderr).toContain("unknown key display.unknown");
		expect(stripAnsi(configured.stdout)).toContain("1    old");
		const overridden = await runCliPager(
			["--width=40", "--no-line-numbers", "--change-markers"],
			patch,
			env,
		);
		expect(stripAnsi(overridden.stdout)).toContain("-  old");
		const shown = await runCliPager(["config", "show"], "", env);
		expect(shown.stdout).toContain(`path: ${config} (default)`);
		expect(shown.stdout).toContain("display.line-numbers: true (config)");

		await writeFile(config, "[display\nline-numbers = true");
		const malformed = await runCliPager(["--width=40", "--paging=never"], patch, env);
		expect(malformed.exitCode).toBe(0);
		expect(malformed.stderr).toContain("malformed TOML");
		expect(malformed.stdout).toContain("old");

		const initPath = join(directory, "new", "config.toml");
		const init = await runCliPager(["config", "init", "--config", initPath], "");
		expect(init).toMatchObject({ exitCode: 0, stdout: `${initPath}\n`, stderr: "" });
		expect(await readFile(initPath, "utf8")).toContain("[paging]");
		const refused = await runCliPager(["config", "init", "--config", initPath], "");
		expect(refused.exitCode).toBe(1);
		expect(refused.stderr).toContain("--force");
		const irrelevant = await runCliPager(
			["config", "init", "--config", join(directory, "irrelevant.toml"), "--line-numbers"],
			"",
		);
		expect(irrelevant.exitCode).toBe(1);
		expect(irrelevant.stderr).toContain("not valid with config init");
		const forced = await runCliPager(["config", "init", "--config", initPath, "--force"], "");
		expect(forced.exitCode).toBe(0);

		const missing = await runCliPager(
			["--config", join(directory, "missing.toml")],
			"must not be emitted",
		);
		expect(missing).toMatchObject({ exitCode: 1, stdout: "" });
		expect(missing.stderr).toContain("cannot read config");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("missing environment pager does not affect non-TTY direct output", async () => {
	const result = await runCliPager([], patch, { REVUEDIFF_PAGER: "definitely-not-a-pager" });
	expect(result).toMatchObject({ exitCode: 0, stderr: "" });
	expect(result.stdout).toContain("a  +1 -1");
});

test("propagates a real pager's nonzero status and treats early stdin closure as success", async () => {
	const directory = await mkdtemp(join(tmpdir(), "revue-pager-process-"));
	try {
		const runner = await writePagerRunner(directory);
		const failing = join(directory, "fails");
		const closesEarly = join(directory, "closes-early");
		await writeFile(failing, "#!/bin/sh\nexit 7\n");
		await writeFile(closesEarly, "#!/bin/sh\nexit 0\n");
		await Promise.all([chmod(failing, 0o755), chmod(closesEarly, 0o755)]);

		expect(await run(runner, failing)).toMatchObject({ exitCode: 7, stderr: "" });
		expect(await run(runner, closesEarly)).toMatchObject({ exitCode: 0, stderr: "" });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("forwards SIGINT and SIGTERM to the active pager and exits nonzero", async () => {
	const directory = await mkdtemp(join(tmpdir(), "revue-pager-signal-"));
	try {
		const runner = await writePagerRunner(directory);
		for (const signal of ["SIGINT", "SIGTERM"] as const) {
			const ready = join(directory, `${signal}-ready`);
			const seen = join(directory, `${signal}-seen`);
			const trapSignal = signal === "SIGINT" ? "INT" : "TERM";
			// Inline shell keeps the trap on the same process writePager spawns via
			// `sh -c`. A script path nests another interpreter, so Linux can deliver
			// the signal to the outer shell and leave the trap waiting forever.
			// Install the trap before advertising readiness — a ready-then-trap race
			// lets CI deliver the signal under the default terminate action.
			const pager = [
				"cat >/dev/null",
				`trap 'echo ${signal} > ${JSON.stringify(seen)}; exit 1' ${trapSignal}`,
				`echo ready > ${JSON.stringify(ready)}`,
				"while :; do sleep 0.05; done",
			].join("; ");
			const child = Bun.spawn([process.execPath, runner], {
				env: { ...process.env, PATCH: patch, FAKE_PAGER: pager },
				stdout: "pipe",
				stderr: "pipe",
			});
			await waitFor(ready);
			child.kill(signal);
			const [stderr, exitCode] = await Promise.all([
				new Response(child.stderr).text(),
				child.exited,
			]);
			expect(await readFile(seen, "utf8")).toContain(signal);
			expect(exitCode).not.toBe(0);
			expect(stderr).toBe("");
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 30_000);
