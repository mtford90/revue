import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const terminalModes = [1000, 1002, 1003, 1006, 1049];
const lacksPtyTools = !Bun.which("bash") || !Bun.which("script");

const scriptCommand = () => {
	const revue = "bun run revue show examples/sample-run";
	// q is re-sent every second because a keypress delivered before the TUI enables raw
	// mode is flushed with the cooked-mode buffer; one early q would never arrive and the
	// app would wait for input forever. The loop dies on SIGPIPE once script exits.
	const keys = "for _ in $(seq 1 25); do sleep 1; printf q; done";
	if (process.platform === "linux") {
		return `(${keys}) | script -q -c '${revue}' "$TRANSCRIPT" >/dev/null`;
	}
	return `(${keys}) | script -q "$TRANSCRIPT" ${revue} >/dev/null`;
};

test.skipIf(process.platform === "win32" || lacksPtyTools)(
	"q restores terminal modes before exiting",
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "revue-terminal-"));
		const transcript = join(directory, "typescript");

		try {
			const child = Bun.spawn(["bash", "-c", scriptCommand()], {
				cwd: repoRoot,
				env: { ...process.env, TERM: "xterm-256color", TRANSCRIPT: transcript },
				stderr: "pipe",
			});
			const exitCode = await child.exited;
			const stderr = await new Response(child.stderr).text();
			expect(stderr).toBe("");
			expect(exitCode).toBe(0);

			const output = await readFile(transcript, "latin1");
			for (const mode of terminalModes) {
				const enable = `\u001b[?${mode}h`;
				const disable = `\u001b[?${mode}l`;
				expect(output).toContain(enable);
				expect(output.lastIndexOf(disable)).toBeGreaterThan(output.lastIndexOf(enable));
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	},
	// Generous because GitHub's Intel macOS runners start the TUI several times slower
	// than Apple Silicon; a genuine hang still fails well before this.
	30_000,
);
