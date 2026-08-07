import {
	type Appearance,
	buildThemeFromInputs,
	DEFAULT_DARK_THEME_ID,
	DEFAULT_LIGHT_THEME_ID,
	type Theme,
} from "./derive.ts";
import {
	BUNDLED_SHIKI_THEME_IDS,
	type BundledShikiThemeId,
	bundledThemeInputs,
	isBundledShikiThemeId,
} from "./shikiThemes.ts";

export {
	type Appearance,
	appearanceForBackground,
	type BuildThemeInputs,
	buildThemeFromInputs,
	DEFAULT_DARK_THEME_ID,
	DEFAULT_LIGHT_THEME_ID,
	type Theme,
	TRANSPARENT,
	withTransparentSurfaces,
} from "./derive.ts";

/** Derive one complete Revue theme from one bundled editor theme. */
const buildTheme = (themeId: BundledShikiThemeId): Theme =>
	buildThemeFromInputs(bundledThemeInputs(themeId));

export const THEMES: Theme[] = BUNDLED_SHIKI_THEME_IDS.map(buildTheme);

export const THEME_IDS: readonly string[] = BUNDLED_SHIKI_THEME_IDS;

const themeById = (themeId: string | undefined) =>
	isBundledShikiThemeId(themeId) ? THEMES.find((theme) => theme.id === themeId) : undefined;

const defaultTheme = (appearance: Appearance | null | undefined): Theme => {
	const fallbackId = appearance === "light" ? DEFAULT_LIGHT_THEME_ID : DEFAULT_DARK_THEME_ID;
	// Every bundled id derives a theme, so the array lookup only guards the type.
	return themeById(fallbackId) ?? (THEMES[0] as Theme);
};

const extraThemeById = (extraThemes: readonly Theme[] | undefined, themeId: string) =>
	extraThemes?.find((theme) => theme.id === themeId);

/**
 * Resolve a named theme; absence uses Ayu Dark while `auto` follows the terminal.
 * `extraThemes` shadow bundled themes that share an id, but never satisfy `auto` or absence.
 */
export const resolveTheme = (
	requested: string | undefined,
	appearance?: Appearance | null,
	extraThemes?: readonly Theme[],
): Theme => {
	if (requested === undefined) return defaultTheme(null);
	if (requested === "auto") return defaultTheme(appearance);
	return extraThemeById(extraThemes, requested) ?? themeById(requested) ?? defaultTheme(appearance);
};

/** Colour slots a custom theme may pin verbatim after derivation. */
export type OverridableThemeSlot = Exclude<
	keyof Theme,
	"id" | "label" | "appearance" | "syntaxTheme"
>;

export type ThemeOverrides = Partial<Record<OverridableThemeSlot, string>>;

const NON_OVERRIDABLE_SLOTS = new Set<keyof Theme>(["id", "label", "appearance", "syntaxTheme"]);

// Mechanically derived from a real Theme's keys rather than hand-listed, so a new Theme field
// is overridable (or excluded) by construction rather than by remembering to update this list.
export const OVERRIDABLE_THEME_SLOTS: readonly OverridableThemeSlot[] = (
	Object.keys(THEMES[0] as Theme) as (keyof Theme)[]
).filter((slot): slot is OverridableThemeSlot => !NON_OVERRIDABLE_SLOTS.has(slot));

/** Pin colour slots on a derived theme verbatim; unknown slots are ignored. */
export const applyOverrides = (theme: Theme, overrides: ThemeOverrides): Theme => {
	const overridden = { ...theme };
	for (const slot of OVERRIDABLE_THEME_SLOTS) {
		const value = overrides[slot];
		if (value !== undefined) overridden[slot] = value;
	}
	return overridden;
};
