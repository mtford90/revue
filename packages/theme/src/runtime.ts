import {
	type Appearance,
	buildThemeFromInputs,
	DEFAULT_DARK_THEME_ID,
	DEFAULT_LIGHT_THEME_ID,
	type Theme,
	withTransparentSurfaces,
} from "./derive.ts";
import {
	type BundledShikiThemeId,
	bundledThemeInputs,
	isBundledShikiThemeId,
} from "./shikiThemes.ts";

export { isBundledShikiThemeId, type Theme, withTransparentSurfaces };

const themes = new Map<BundledShikiThemeId, Theme>();

const themeForId = (themeId: BundledShikiThemeId): Theme => {
	const cached = themes.get(themeId);
	if (cached) return cached;
	const theme = buildThemeFromInputs(bundledThemeInputs(themeId));
	themes.set(themeId, theme);
	return theme;
};

const defaultTheme = (appearance: Appearance | null | undefined): Theme =>
	themeForId(appearance === "light" ? DEFAULT_LIGHT_THEME_ID : DEFAULT_DARK_THEME_ID);

/** Resolve one bundled theme without loading custom-theme validation or deriving the full catalog. */
export const resolveBundledTheme = (
	requested: string | undefined,
	appearance?: Appearance | null,
): Theme => {
	if (requested === undefined) return defaultTheme(null);
	if (requested === "auto") return defaultTheme(appearance);
	return isBundledShikiThemeId(requested) ? themeForId(requested) : defaultTheme(appearance);
};
