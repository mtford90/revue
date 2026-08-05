import { describe, expect, test } from "bun:test";
import bundledThemesFixture from "./__fixtures__/bundled-themes.json" with { type: "json" };
import { contrastRatio } from "./color.ts";
import { BUNDLED_SHIKI_THEME_IDS, bundledThemeInputs } from "./shikiThemes.ts";
import {
	appearanceForBackground,
	applyOverrides,
	buildThemeFromInputs,
	DEFAULT_DARK_THEME_ID,
	DEFAULT_LIGHT_THEME_ID,
	OVERRIDABLE_THEME_SLOTS,
	resolveTheme,
	THEMES,
	type Theme,
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

	test("every bundled theme's emphasis tint outranks both its row and focused tints", () => {
		const indistinct = THEMES.flatMap((theme) =>
			(
				[
					["addedEmphasisBg", theme.addedEmphasisBg, theme.addedBg, theme.addedContentBg],
					["removedEmphasisBg", theme.removedEmphasisBg, theme.removedBg, theme.removedContentBg],
				] as const
			)
				.filter(([, emphasis, row, focused]) => emphasis === row || emphasis === focused)
				.map(([slot]) => `${theme.id}.${slot}`),
		);
		expect(indistinct).toEqual([]);
	});

	test("appearance follows the editor surface rather than the theme name", () => {
		const byId = new Map(THEMES.map((theme) => [theme.id, theme.appearance]));
		expect(byId.get("github-light-default")).toBe("light");
		expect(byId.get("catppuccin-mocha")).toBe("dark");
		expect(byId.get("gruvbox-light-soft")).toBe("light");
	});

	test("every bundled theme derives byte-identically to the pre-refactor fixture", () => {
		expect(THEMES).toEqual(bundledThemesFixture as Theme[]);
		expect(THEMES).toHaveLength(BUNDLED_SHIKI_THEME_IDS.length);
	});

	test("the bundled wrapper matches buildThemeFromInputs called with bundled inputs directly", () => {
		for (const themeId of BUNDLED_SHIKI_THEME_IDS) {
			const derived = buildThemeFromInputs(bundledThemeInputs(themeId));
			const bundled = THEMES.find((theme) => theme.id === themeId);
			expect(derived).toEqual(bundled as Theme);
		}
	});
});

describe("appearanceForBackground", () => {
	test("agrees with buildThemeFromInputs' own appearance derivation", () => {
		expect(appearanceForBackground("#101010")).toBe("dark");
		expect(appearanceForBackground("#fafafa")).toBe("light");
	});
});

describe("buildThemeFromInputs", () => {
	test("derives appearance from background luminance rather than a passed-in flag", () => {
		const dark = buildThemeFromInputs({ id: "custom-dark", background: "#101010" });
		const light = buildThemeFromInputs({ id: "custom-light", background: "#fafafa" });
		expect(dark.appearance).toBe("dark");
		expect(light.appearance).toBe("light");
	});

	test("defaults label and syntaxTheme to id when omitted", () => {
		const theme = buildThemeFromInputs({ id: "custom", background: "#101010" });
		expect(theme.label).toBe("custom");
		expect(theme.syntaxTheme).toBe("custom");
	});

	test("honours an explicit label, syntaxTheme, foreground and diffColors", () => {
		const theme = buildThemeFromInputs({
			id: "custom",
			label: "My Custom Theme",
			background: "#101010",
			foreground: "#eeeeee",
			syntaxTheme: "nord",
			diffColors: { added: "#00ff00", removed: "#ff0000", modified: "#0000ff" },
		});
		expect(theme.label).toBe("My Custom Theme");
		expect(theme.syntaxTheme).toBe("nord");
	});

	test("derives emphasis tints distinct from the row and focused tints on either appearance", () => {
		for (const background of ["#101010", "#fafafa"]) {
			const theme = buildThemeFromInputs({ id: "custom", background });
			expect(theme.addedEmphasisBg).not.toBe(theme.addedBg);
			expect(theme.addedEmphasisBg).not.toBe(theme.addedContentBg);
			expect(theme.removedEmphasisBg).not.toBe(theme.removedBg);
			expect(theme.removedEmphasisBg).not.toBe(theme.removedContentBg);
			expect(contrastRatio(theme.text, theme.addedEmphasisBg)).toBeGreaterThanOrEqual(4);
			expect(contrastRatio(theme.text, theme.removedEmphasisBg)).toBeGreaterThanOrEqual(4);
		}
	});

	test("falls back to a legible foreground and fallback diff colours when omitted", () => {
		const theme = buildThemeFromInputs({ id: "custom", background: "#101010" });
		expect(contrastRatio(theme.text, theme.panelAlt)).toBeGreaterThanOrEqual(READABLE);
		expect(theme.addedSignColor).toBeTruthy();
		expect(theme.removedSignColor).toBeTruthy();
	});
});

describe("applyOverrides", () => {
	const base = buildThemeFromInputs({ id: "custom", background: "#101010" });

	test("pins overridden slots verbatim, without contrast policing", () => {
		const overridden = applyOverrides(base, { text: "#123456", accent: "#abcdef" });
		expect(overridden.text).toBe("#123456");
		expect(overridden.accent).toBe("#abcdef");
	});

	test("leaves slots that were not overridden untouched", () => {
		const overridden = applyOverrides(base, { text: "#123456" });
		expect(overridden.background).toBe(base.background);
		expect(overridden.panel).toBe(base.panel);
	});

	test("pins the emphasis slots verbatim", () => {
		const overridden = applyOverrides(base, {
			addedEmphasisBg: "#0a3d0a",
			removedEmphasisBg: "#3d0a0a",
		});
		expect(overridden.addedEmphasisBg).toBe("#0a3d0a");
		expect(overridden.removedEmphasisBg).toBe("#3d0a0a");
		expect(OVERRIDABLE_THEME_SLOTS).toContain("addedEmphasisBg");
		expect(OVERRIDABLE_THEME_SLOTS).toContain("removedEmphasisBg");
	});

	test("the overridable slot set excludes id, label, appearance and syntaxTheme", () => {
		expect(OVERRIDABLE_THEME_SLOTS).not.toContain("id");
		expect(OVERRIDABLE_THEME_SLOTS).not.toContain("label");
		expect(OVERRIDABLE_THEME_SLOTS).not.toContain("appearance");
		expect(OVERRIDABLE_THEME_SLOTS).not.toContain("syntaxTheme");
		expect(OVERRIDABLE_THEME_SLOTS).toContain("background");
		expect(OVERRIDABLE_THEME_SLOTS).toContain("badgeAdded");
	});
});

describe("resolveTheme", () => {
	test("an unknown or automatic name falls back to the Ayu theme for the terminal's appearance", () => {
		expect(DEFAULT_LIGHT_THEME_ID).toBe("ayu-light");
		expect(DEFAULT_DARK_THEME_ID).toBe("ayu-dark");
		expect(resolveTheme("auto", "light").id).toBe(DEFAULT_LIGHT_THEME_ID);
		expect(resolveTheme("auto", "dark").id).toBe(DEFAULT_DARK_THEME_ID);
		expect(resolveTheme("not-a-theme", "light").id).toBe(DEFAULT_LIGHT_THEME_ID);
		expect(resolveTheme(undefined, "light").id).toBe(DEFAULT_DARK_THEME_ID);
		expect(resolveTheme(undefined, null).id).toBe(DEFAULT_DARK_THEME_ID);
	});

	test("a known name wins over the terminal's appearance", () => {
		expect(resolveTheme("nord", "light").id).toBe("nord");
	});

	test("an extra theme shadows a bundled theme with the same id", () => {
		const shadow = buildThemeFromInputs({ id: "nord", background: "#000000" });
		expect(resolveTheme("nord", "light", [shadow])).toBe(shadow);
	});

	test("an unknown id still falls back to the appearance default when extra themes are given", () => {
		const shadow = buildThemeFromInputs({ id: "nord", background: "#000000" });
		expect(resolveTheme("not-a-theme", "light", [shadow]).id).toBe(DEFAULT_LIGHT_THEME_ID);
	});

	test("auto and absent requests never resolve to an extra theme", () => {
		const shadow = buildThemeFromInputs({ id: DEFAULT_DARK_THEME_ID, background: "#000000" });
		expect(resolveTheme("auto", "dark", [shadow]).id).toBe(DEFAULT_DARK_THEME_ID);
		expect(resolveTheme("auto", "dark", [shadow])).not.toBe(shadow);
		expect(resolveTheme(undefined, null, [shadow])).not.toBe(shadow);
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
