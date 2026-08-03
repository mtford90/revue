import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("release archives receive every bundled production licence, including Apache-2.0 texts", async () => {
	const directory = await mkdtemp(join(tmpdir(), "revue-licences-"));
	const output = join(directory, "BUNDLED_LICENSES.md");
	try {
		const child = Bun.spawn(
			[process.execPath, resolve(import.meta.dir, "collect-licenses.ts"), output],
			{ stdout: "ignore", stderr: "pipe" },
		);
		expect(await child.exited).toBe(0);

		const document = await readFile(output, "utf8");
		expect(document).toContain("## @pierre/diffs@");
		expect(document).toContain("Apache License");
		expect(document).toContain("## react@");
		expect(document).toContain("## @opentui/core@");
		expect(document).toContain("## zod@");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
