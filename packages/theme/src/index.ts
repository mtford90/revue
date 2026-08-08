export { blendHex, contrastRatio, relativeLuminance } from "./color.ts";
export {
	type CustomThemeFile,
	CustomThemeFileSchema,
} from "./customTheme.ts";
export {
	BUNDLED_SHIKI_THEME_IDS,
	type BundledShikiThemeDiffColors,
	type BundledShikiThemeId,
	type BundledThemeInputs,
	bundledThemeInputs,
	isBundledShikiThemeId,
} from "./shikiThemes.ts";
export {
	type Appearance,
	appearanceForBackground,
	applyOverrides,
	type BuildThemeInputs,
	buildThemeFromInputs,
	DEFAULT_DARK_THEME_ID,
	DEFAULT_LIGHT_THEME_ID,
	FOLLOW_TERMINAL,
	followsTerminal,
	OVERRIDABLE_THEME_SLOTS,
	type OverridableThemeSlot,
	pairedThemeId,
	resolveTheme,
	resolveThemeChoice,
	THEME_IDS,
	THEMES,
	type Theme,
	type ThemeChoice,
	type ThemeOverrides,
	TRANSPARENT,
	withTransparentSurfaces,
} from "./theme.ts";
