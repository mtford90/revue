import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("Revuediff formula uses its independent tag, assets, binary, and class", async () => {
	const directory = await mkdtemp(join(tmpdir(), "revuediff-formula-"));
	const checksums = join(directory, "checksums.txt");
	try {
		const sha = "a".repeat(64);
		await writeFile(
			checksums,
			[
				`${sha}  revuediff-v0.1.0-darwin-arm64.tar.gz`,
				`${sha}  revuediff-v0.1.0-darwin-x64.tar.gz`,
				`${sha}  revuediff-v0.1.0-linux-x64.tar.gz`,
			].join("\n"),
		);
		const child = Bun.spawn(
			["bash", resolve(import.meta.dir, "generate-revuediff-tap-formula.sh"), "0.1.0", checksums],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const [formula, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
		expect(formula).toContain("class Revuediff < Formula");
		expect(formula).toContain("releases/download/revuediff-v0.1.0");
		for (const target of ["darwin-arm64", "darwin-x64", "linux-x64"])
			expect(formula).toContain(`revuediff-v0.1.0-${target}.tar.gz`);
		expect(formula).toContain('bin.install "revuediff", "revuediff-highlighter.node"');
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
