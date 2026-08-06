import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePatch } from "@revue/diff";
import {
	ansiLineCount,
	layoutForFile,
	resolvePagerCommand,
	resolvePagerWidth,
	runPager,
} from "./pager.ts";

const changed = parsePatch(`diff --git a/a b/a
index 1111111..2222222 100644
--- a/a
+++ b/a
@@ -1 +1 @@
-old
+new
`)[0];
if (!changed) throw new Error("fixture did not parse");

test("chooses stack at 79 and split at 80 only for files with both sides", () => {
	expect(layoutForFile(changed, 79)).toBe("stack");
	expect(layoutForFile(changed, 80)).toBe("split");
	const added = { ...changed, stats: { additions: 1, deletions: 0 } };
	expect(layoutForFile(added, 120)).toBe("stack");
});

test("does not consult GIT_PAGER when resolving the downstream pager", () => {
	const original = {
		GIT_PAGER: process.env.GIT_PAGER,
		REVUEDIFF_PAGER: process.env.REVUEDIFF_PAGER,
		PAGER: process.env.PAGER,
	};
	process.env.GIT_PAGER = "revuediff";
	delete process.env.REVUEDIFF_PAGER;
	delete process.env.PAGER;
	try {
		expect(resolvePagerCommand({ paging: "auto" }).command).toBe("less");
	} finally {
		for (const [key, value] of Object.entries(original)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

test("falls back from non-positive terminal columns and counts an unterminated line", () => {
	const columns = process.stdout.columns;
	Object.defineProperty(process.stdout, "columns", { configurable: true, value: 0 });
	try {
		expect(resolvePagerWidth({ paging: "auto" })).toBe(80);
	} finally {
		Object.defineProperty(process.stdout, "columns", { configurable: true, value: columns });
	}
	expect(ansiLineCount("one\ntwo")).toBe(2);
});

test("delivers ANSI to a fake pager, falls back for missing environment commands, and rejects explicit missing commands", async () => {
	const directory = await mkdtemp(join(tmpdir(), "revue-pager-"));
	const oldTTY = process.stdout.isTTY;
	const oldPager = process.env.PAGER;
	const received = join(directory, "received");
	const fake = join(directory, "fake-pager");
	await writeFile(
		fake,
		`#!/bin/sh\nprintf '%s' "$*" > "${join(directory, "args")}"\ncat > "${received}"\n`,
	);
	await chmod(fake, 0o755);
	Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
	try {
		const source = `diff --git a/a b/a\nindex 1111111..2222222 100644\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n`;
		expect(await runPager(source, { paging: "always", pager: fake })).toBe(0);
		expect(await readFile(received, "utf8")).toContain("\x1b[");
		process.env.PAGER = "definitely-not-a-pager";
		expect(await runPager(source, { paging: "always" })).toBe(0);
		await expect(
			runPager(source, { paging: "always", pager: "definitely-not-a-pager" }),
		).rejects.toThrow("could not start pager");
	} finally {
		Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: oldTTY });
		if (oldPager === undefined) delete process.env.PAGER;
		else process.env.PAGER = oldPager;
		await rm(directory, { recursive: true, force: true });
	}
});
