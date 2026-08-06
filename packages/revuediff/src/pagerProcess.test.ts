import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function writePagerRunner(directory: string): Promise<string> {
	const runner = join(directory, "run-pager.ts");
	await writeFile(
		runner,
		`import { runPager } from ${JSON.stringify(pagerPath)};
Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
const status = await runPager(process.env.PATCH ?? "", { paging: "always", pager: process.env.FAKE_PAGER });
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
	const result = await runCliPager(["--paging=auto", "--width=80", "--theme=ayu-dark"]);
	expect(result).toMatchObject({ exitCode: 0, stderr: "" });
	expect(result.stdout).toContain("a  +1 -1");
	expect(result.stdout).toContain("\x1b[");
	expect(result.stdout).not.toContain("\x1b[31m");
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
			const pager = join(directory, `${signal}-pager`);
			await writeFile(
				pager,
				`#!/bin/sh
echo ready > ${JSON.stringify(ready)}
trap 'echo ${signal} > ${JSON.stringify(seen)}; exit 1' ${signal}
while :; do sleep 1; done
`,
			);
			await chmod(pager, 0o755);
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
}, 10_000);
