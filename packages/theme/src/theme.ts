import { blendHex, contrastRatio, relativeLuminance } from "./color.ts";
import {
	BUNDLED_SHIKI_THEME_IDS,
	type BundledShikiThemeId,
	bundledThemeBackground,
	bundledThemeDiffColors,
	bundledThemeForeground,
	isBundledShikiThemeId,
} from "./shikiThemes.ts";

export type Appearance = "light" | "dark";

/**
 * Every colour Revue paints. One theme is derived from one editor theme rather than hand-picked,
 * so the shell, the diff body, and the highlighted source always agree.
 */
export type Theme = {
	id: string;
	label: string;
	appearance: Appearance;
	/** Neutral surfaces: the page, raised chrome, selected chrome, and rules. */
	background: string;
	panel: string;
	panelAlt: string;
	border: string;
	/** Foregrounds. */
	text: string;
	muted: string;
	heading: string;
	accent: string;
	accentMuted: string;
	/** Diff row surfaces; the `Content` variants are the stronger focused tint. */
	contextBg: string;
	addedBg: string;
	removedBg: string;
	addedContentBg: string;
	removedContentBg: string;
	selectedHunk: string;
	/** Diff foregrounds. */
	addedSignColor: string;
	removedSignColor: string;
	lineNumberFg: string;
	/** Semantic status colours that must stay readable on chrome, not just on the page. */
	badgeAdded: string;
	badgeRemoved: string;
	badgeModified: string;
	badgeNeutral: string;
	/** The Shiki theme highlighted source is rendered with. */
	syntaxTheme: string;
};

export const TRANSPARENT = "transparent";
export const DEFAULT_DARK_THEME_ID = "ayu-dark";
export const DEFAULT_LIGHT_THEME_ID = "ayu-light";

const MIN_TEXT_CONTRAST = 4.5;
const MIN_DIFF_SIGN_CONTRAST = 3;
const LIGHT_SURFACE_LUMINANCE = 0.45;

const FALLBACK_DIFF_COLORS = {
	dark: { added: "#5ecc71", removed: "#ff6762", modified: "#69b1ff" },
	light: { added: "#0dbe4e", removed: "#ff2e3f", modified: "#009fff" },
} as const;

const isLight = (background: string) => relativeLuminance(background) > LIGHT_SURFACE_LUMINANCE;

/** A foreground that stays legible over an arbitrary editor surface. */
const readableForeground = (preferred: string | undefined, background: string): string => {
	if (preferred && contrastRatio(preferred, background) >= MIN_TEXT_CONTRAST) return preferred;
	return isLight(background) ? "#000000" : "#ffffff";
};

/** A dimmed foreground that stays legible over an arbitrary editor surface. */
const readableDimForeground = (preferred: string, background: string): string => {
	if (contrastRatio(preferred, background) >= MIN_TEXT_CONTRAST) return preferred;
	const anchor = isLight(background) ? "#000000" : "#ffffff";
	return blendHex(anchor, background, 0.62);
};

/** A diff marker keeps a lower contrast floor than body text; it is a glyph, not prose. */
const readableDiffSign = (preferred: string, background: string): string => {
	if (contrastRatio(preferred, background) >= MIN_DIFF_SIGN_CONTRAST) return preferred;
	const anchor = isLight(background) ? "#000000" : "#ffffff";
	return blendHex(anchor, preferred, 0.45);
};

/** The strongest tint of `tintColor` over `background` that still carries `foreground`. */
const readableTintedBackground = ({
	tintColor,
	background,
	foreground,
	preferredAmount,
}: {
	tintColor: string;
	background: string;
	foreground: string;
	preferredAmount: number;
}): string => {
	for (let amount = preferredAmount; amount >= 0.02; amount -= 0.02) {
		const candidate = blendHex(tintColor, background, amount);
		if (contrastRatio(foreground, candidate) >= MIN_TEXT_CONTRAST) return candidate;
	}
	return background;
};

/** Keep a semantic status colour readable on both chrome surfaces, not only on the page. */
const readableChromeColor = (preferred: string, panel: string, panelAlt: string): string => {
	const carries = (candidate: string) =>
		contrastRatio(candidate, panel) >= MIN_TEXT_CONTRAST &&
		contrastRatio(candidate, panelAlt) >= MIN_TEXT_CONTRAST;
	if (carries(preferred)) return preferred;

	const anchor = isLight(panelAlt) ? "#000000" : "#ffffff";
	const stronger = [0.35, 0.5, 0.65, 0.8, 1].map((amount) => blendHex(anchor, preferred, amount));
	return stronger.find(carries) ?? anchor;
};

/** Derive one complete Revue theme from one bundled editor theme. */
const buildTheme = (themeId: BundledShikiThemeId): Theme => {
	const editorBackground = bundledThemeBackground(themeId);
	const lightSurface = isLight(editorBackground);
	const fallbackDiffColors = FALLBACK_DIFF_COLORS[lightSurface ? "light" : "dark"];
	const diffColors = bundledThemeDiffColors(themeId);
	const rowTint = lightSurface ? 0.12 : 0.2;
	const focusedTint = lightSurface ? 0.18 : 0.28;
	const selectedTint = lightSurface ? 0.18 : 0.25;

	const editorForeground = bundledThemeForeground(themeId);
	const codeForeground = readableForeground(editorForeground, editorBackground);
	const panel = blendHex(codeForeground, editorBackground, lightSurface ? 0.04 : 0.08);
	const panelAlt = blendHex(codeForeground, editorBackground, lightSurface ? 0.08 : 0.12);
	const border = blendHex(codeForeground, editorBackground, lightSurface ? 0.15 : 0.18);
	const text = readableForeground(editorForeground ?? codeForeground, panelAlt);
	const dimmed = blendHex(text, editorBackground, 0.56);

	const added = readableDiffSign(diffColors?.added ?? fallbackDiffColors.added, editorBackground);
	const removed = readableDiffSign(
		diffColors?.removed ?? fallbackDiffColors.removed,
		editorBackground,
	);
	const modified = readableDiffSign(
		diffColors?.modified ?? fallbackDiffColors.modified,
		editorBackground,
	);
	const tinted = (tintColor: string, preferredAmount: number) =>
		readableTintedBackground({
			tintColor,
			background: editorBackground,
			foreground: text,
			preferredAmount,
		});

	return {
		id: themeId,
		label: themeId,
		appearance: lightSurface ? "light" : "dark",
		background: editorBackground,
		panel,
		panelAlt,
		border,
		text,
		muted: readableDimForeground(dimmed, panelAlt),
		// Revue's shell separates headings from focus, which one editor theme does not
		// distinguish; half-way between the accent and body text reads as neither.
		heading: blendHex(modified, text, 0.5),
		accent: modified,
		accentMuted: tinted(modified, selectedTint),
		contextBg: editorBackground,
		addedBg: tinted(added, rowTint),
		removedBg: tinted(removed, rowTint),
		addedContentBg: tinted(added, focusedTint),
		removedContentBg: tinted(removed, focusedTint),
		selectedHunk: blendHex(modified, editorBackground, selectedTint),
		addedSignColor: added,
		removedSignColor: removed,
		lineNumberFg: readableDimForeground(dimmed, editorBackground),
		badgeAdded: readableChromeColor(added, panel, panelAlt),
		badgeRemoved: readableChromeColor(removed, panel, panelAlt),
		badgeModified: readableChromeColor(modified, panel, panelAlt),
		badgeNeutral: readableDimForeground(dimmed, panelAlt),
		syntaxTheme: themeId,
	};
};

export const THEMES: Theme[] = BUNDLED_SHIKI_THEME_IDS.map(buildTheme);

export const THEME_IDS: readonly string[] = BUNDLED_SHIKI_THEME_IDS;

const themeById = (themeId: string | undefined) =>
	isBundledShikiThemeId(themeId) ? THEMES.find((theme) => theme.id === themeId) : undefined;

const defaultTheme = (appearance: Appearance | null | undefined): Theme => {
	const fallbackId = appearance === "light" ? DEFAULT_LIGHT_THEME_ID : DEFAULT_DARK_THEME_ID;
	// Every bundled id derives a theme, so the array lookup only guards the type.
	return themeById(fallbackId) ?? (THEMES[0] as Theme);
};

/** Resolve a named theme; absence uses Ayu Dark while `auto` follows the terminal. */
export const resolveTheme = (
	requested: string | undefined,
	appearance?: Appearance | null,
): Theme => {
	if (requested === undefined) return defaultTheme(null);
	if (requested === "auto") return defaultTheme(appearance);
	return themeById(requested) ?? defaultTheme(appearance);
};

/**
 * Let the terminal's own background show through Revue's neutral surfaces while diff rows keep
 * their semantic tints, so a translucent terminal stays readable and still marks changes.
 */
export const withTransparentSurfaces = (theme: Theme): Theme => ({
	...theme,
	background: TRANSPARENT,
	panel: TRANSPARENT,
	panelAlt: TRANSPARENT,
	contextBg: TRANSPARENT,
});
