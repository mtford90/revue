import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("Revue formula installs its adjacent native highlighter", async () => {
	const directory = await mkdtemp(join(tmpdir(), "revue-formula-"));
	const checksums = join(directory, "checksums.txt");
	try {
		const sha = "a".repeat(64);
		await writeFile(
			checksums,
			["darwin-arm64", "darwin-x64", "linux-x64"]
				.map((target) => `${sha}  revue-v1.2.3-${target}.tar.gz`)
				.join("\n"),
		);
		const child = Bun.spawn(
			["bash", resolve(import.meta.dir, "generate-tap-formula.sh"), "1.2.3", checksums],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const [formula, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
		expect(formula).toContain('bin.install "revue", "revue-highlighter.node"');
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
