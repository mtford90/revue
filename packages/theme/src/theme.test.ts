import { describe, expect, test } from "bun:test";
import { contrastRatio } from "./color.ts";
import {
	DEFAULT_DARK_THEME_ID,
	DEFAULT_LIGHT_THEME_ID,
	resolveTheme,
	THEMES,
	TRANSPARENT,
	withTransparentSurfaces,
} from "./theme.ts";

const READABLE = 4.5;

describe("derived themes", () => {
	test("every bundled theme carries body text on the surfaces it paints", () => {
		const unreadable = THEMES.flatMap((theme) =>
			(
				[
					["background", theme.background],
					["panel", theme.panel],
					["panelAlt", theme.panelAlt],
					["addedBg", theme.addedBg],
					["removedBg", theme.removedBg],
					["addedContentBg", theme.addedContentBg],
					["removedContentBg", theme.removedContentBg],
				] as const
			)
				.filter(([, surface]) => contrastRatio(theme.text, surface) < READABLE)
				.map(([slot]) => `${theme.id}.${slot}`),
		);
		expect(unreadable).toEqual([]);
	});

	test("every bundled theme keeps status colours readable on chrome", () => {
		const unreadable = THEMES.flatMap((theme) =>
			(
				[
					["badgeAdded", theme.badgeAdded],
					["badgeRemoved", theme.badgeRemoved],
					["badgeModified", theme.badgeModified],
					["badgeNeutral", theme.badgeNeutral],
					["muted", theme.muted],
				] as const
			)
				.filter(([, color]) => contrastRatio(color, theme.panelAlt) < READABLE)
				.map(([slot]) => `${theme.id}.${slot}`),
		);
		expect(unreadable).toEqual([]);
	});

	test("appearance follows the editor surface rather than the theme name", () => {
		const byId = new Map(THEMES.map((theme) => [theme.id, theme.appearance]));
		expect(byId.get("github-light-default")).toBe("light");
		expect(byId.get("catppuccin-mocha")).toBe("dark");
		expect(byId.get("gruvbox-light-soft")).toBe("light");
	});
});

describe("resolveTheme", () => {
	test("an unknown or automatic name falls back to the terminal's own appearance", () => {
		expect(resolveTheme("auto", "light").id).toBe(DEFAULT_LIGHT_THEME_ID);
		expect(resolveTheme("auto", "dark").id).toBe(DEFAULT_DARK_THEME_ID);
		expect(resolveTheme("not-a-theme", "light").id).toBe(DEFAULT_LIGHT_THEME_ID);
		expect(resolveTheme(undefined, null).id).toBe(DEFAULT_DARK_THEME_ID);
	});

	test("a known name wins over the terminal's appearance", () => {
		expect(resolveTheme("nord", "light").id).toBe("nord");
	});
});

test("transparent surfaces keep diff rows tinted", () => {
	const theme = withTransparentSurfaces(resolveTheme("catppuccin-mocha"));
	expect(theme.background).toBe(TRANSPARENT);
	expect(theme.panel).toBe(TRANSPARENT);
	expect(theme.contextBg).toBe(TRANSPARENT);
	expect(theme.addedBg).not.toBe(TRANSPARENT);
	expect(theme.removedBg).not.toBe(TRANSPARENT);
});
