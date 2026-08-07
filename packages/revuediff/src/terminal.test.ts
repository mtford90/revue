import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const terminalModes = [1000, 1002, 1003, 1006, 1049];
const lacksPtyTools = !Bun.which("bash") || !Bun.which("script");

test.skipIf(process.platform === "win32" || lacksPtyTools)(
	"auto paging selects the downstream pager without enabling terminal modes",
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "revuediff-pager-pty-"));
		const fixture = join(directory, "large.patch");
		const pager = join(directory, "pager");
		const received = join(directory, "received");
		const transcript = join(directory, "transcript");
		const lines = Array.from({ length: 80 }, (_, index) => `-${index}\n+${index}`).join("\n");
		await writeFile(
			fixture,
			`diff --git a/a b/a\nindex 1111111..2222222 100644\n--- a/a\n+++ b/a\n@@ -1,80 +1,80 @@\n${lines}\n`,
		);
		await writeFile(pager, `#!/bin/sh\ncat > ${JSON.stringify(received)}\n`);
		await chmod(pager, 0o755);
		const command = `bun run revuediff --pager ${JSON.stringify(pager)} < ${JSON.stringify(fixture)}`;
		const script =
			process.platform === "linux"
				? ["script", "-q", "-c", command, transcript]
				: ["script", "-q", transcript, "sh", "-c", command];
		try {
			const child = Bun.spawn(script, {
				cwd: repoRoot,
				env: { ...process.env, TERM: "xterm-256color" },
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stderr, exitCode] = await Promise.all([
				new Response(child.stderr).text(),
				child.exited,
			]);
			expect(exitCode).toBe(0);
			expect(stderr).toBe("");
			expect(await readFile(received, "utf8")).toContain("\x1b[");
			const output = await readFile(transcript, "latin1");
			for (const mode of terminalModes) expect(output).not.toContain(`\u001b[?${mode}h`);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	},
	30_000,
);
