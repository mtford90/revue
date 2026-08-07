import { describe, expect, test } from "bun:test";
import bundledThemesFixture from "./__fixtures__/bundled-themes.json" with { type: "json" };
import { isBundledShikiThemeId, resolveBundledTheme, withTransparentSurfaces } from "./runtime.ts";
import type { Theme } from "./theme.ts";

const bundledTheme = (id: string): Theme => {
	const theme = (bundledThemesFixture as Theme[]).find((candidate) => candidate.id === id);
	if (!theme) throw new Error(`missing bundled theme fixture: ${id}`);
	return theme;
};

describe("runtime theme resolution", () => {
	test("validates and derives a selected bundled theme byte-identically", () => {
		expect(isBundledShikiThemeId("catppuccin-mocha")).toBe(true);
		expect(isBundledShikiThemeId("not-a-theme")).toBe(false);
		expect(resolveBundledTheme("catppuccin-mocha")).toEqual(bundledTheme("catppuccin-mocha"));
	});

	test("keeps the root resolver's fallback and transparent surface behaviour", () => {
		expect(resolveBundledTheme("auto", "light")).toEqual(bundledTheme("ayu-light"));
		expect(resolveBundledTheme("not-a-theme", "dark")).toEqual(bundledTheme("ayu-dark"));
		const transparent = withTransparentSurfaces(resolveBundledTheme("nord"));
		expect(transparent.background).toBe("transparent");
		expect(transparent.addedBg).toBe(bundledTheme("nord").addedBg);
	});
});
