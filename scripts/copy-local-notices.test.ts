import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyLocalNotices } from "./copy-local-notices.ts";

test("Revue release archives contain every local third-party notice", async () => {
	const directory = await mkdtemp(join(tmpdir(), "revue-local-notices-"));
	try {
		await copyLocalNotices(directory);
		expect((await readdir(directory)).sort()).toEqual([
			"THIRD_PARTY_NOTICES-diff-opentui.md",
			"THIRD_PARTY_NOTICES-diff.md",
			"THIRD_PARTY_NOTICES-skill.md",
			"THIRD_PARTY_NOTICES-theme.md",
			"THIRD_PARTY_NOTICES-tui.md",
			"THIRD_PARTY_NOTICES-types.md",
		]);
		expect(await readFile(join(directory, "THIRD_PARTY_NOTICES-diff.md"), "utf8")).toContain(
			"Hunk",
		);
		expect(
			await readFile(join(directory, "THIRD_PARTY_NOTICES-diff-opentui.md"), "utf8"),
		).toContain("Hunk");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("Revuediff archives contain only notices in its reusable package closure", async () => {
	const directory = await mkdtemp(join(tmpdir(), "revuediff-local-notices-"));
	try {
		await copyLocalNotices(directory, "revuediff");
		expect((await readdir(directory)).sort()).toEqual([
			"THIRD_PARTY_NOTICES-diff.md",
			"THIRD_PARTY_NOTICES-theme.md",
		]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
