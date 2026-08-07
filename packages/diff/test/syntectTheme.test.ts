import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { compositeTerminalForeground } from "@revue/diff";
import { BUNDLED_SHIKI_THEME_IDS } from "../../theme/src/shikiThemes.ts";

test("converts opaque and alpha Shiki foregrounds to deterministic terminal RGB", () => {
	expect(compositeTerminalForeground("#123456", "#abcdef")).toBe("#123456");
	// Ayu Dark's punctuation foreground is #bfbdb6b3 over #10141c.
	expect(compositeTerminalForeground("#bfbdb6b3", "#10141c")).toBe("#8b8b88");
});

test("rejects non-terminal Shiki colour values rather than silently changing them", () => {
	expect(compositeTerminalForeground("#abc", "#000000")).toBeUndefined();
	expect(compositeTerminalForeground("inherit", "#000000")).toBeUndefined();
});

test("ships a converted Syntect asset for every bundled Shiki syntax theme", async () => {
	const themes = await readdir(join(import.meta.dir, "../native/themes"));
	expect(themes.filter((theme) => theme.endsWith(".tmTheme")).sort()).toEqual(
		BUNDLED_SHIKI_THEME_IDS.map((theme) => `${theme}.tmTheme`).sort(),
	);
});
