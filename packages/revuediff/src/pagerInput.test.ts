import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { classifyPagerInput } from "./pagerInput.ts";

const patch = `diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-const old = 1;
+const next = 2;
`;

test("classifies the checked-in Revuediff demo patches as supported", async () => {
	for (const fixture of ["feature.patch", "plain.patch"]) {
		const input = await readFile(
			join(import.meta.dir, "../../../examples/revuediff", fixture),
			"utf8",
		);
		expect(classifyPagerInput(input).kind, fixture).toBe("supported");
	}
});

test("classifies coloured Git and plain unified patches after sanitising them", () => {
	const result = classifyPagerInput(`\x1b[31m${patch}\x1b[0m`);
	expect(result.kind).toBe("supported");
	if (result.kind === "supported") expect(result.files).toHaveLength(1);
	const plain = classifyPagerInput(
		patch.replace("diff --git a/a.ts b/a.ts\nindex 1111111..2222222 100644\n", ""),
	);
	expect(plain.kind).toBe("supported");
});

test("keeps unsupported input whole while stripping terminal controls", () => {
	const result = classifyPagerInput(
		`${patch}\ntrailing prose\x1b]8;;https://bad\x07hidden\x1b]8;;\x07`,
	);
	expect(result).toEqual({ kind: "passthrough", text: `${patch}\ntrailing prosehidden` });
	expect(classifyPagerInput("diff --cc a.ts\n@@@ -1 +1 @@@\n").kind).toBe("passthrough");
});

test("accepts an ordinary no-final-newline marker after the final hunk line", () => {
	const result = classifyPagerInput(`${patch}\\ No newline at end of file\n`);
	expect(result.kind).toBe("supported");
});

test("passes through orphan envelope lines and truncated additional file headers whole", () => {
	for (const input of [
		`${patch}--- a/orphan\n`,
		`${patch}index 3333333..4444444 100644\n`,
		`${patch}diff --git a/b b/b\nindex 1111111..2222222 100644\n--- a/b\n`,
	]) {
		const result = classifyPagerInput(input);
		expect(result).toEqual({ kind: "passthrough", text: input });
	}
});

test("preserves one git show preamble before the parsed files", () => {
	const result = classifyPagerInput(`commit abcdef\nAuthor: A\n\n    message\n\n${patch}`);
	expect(result.kind).toBe("supported");
	if (result.kind === "supported") expect(result.preamble).toContain("commit abcdef");
});
