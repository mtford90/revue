import { blendHex, contrastRatio, relativeLuminance } from "./color.ts";
import {
	BUNDLED_SHIKI_THEME_IDS,
	type BundledShikiThemeDiffColors,
	type BundledShikiThemeId,
	bundledThemeInputs,
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
	/** The strongest diff tints, painted behind intra-line emphasis inside a changed line. */
	addedEmphasisBg: string;
	removedEmphasisBg: string;
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
// Emphasis spans are short runs whose whole purpose is visible differentiation, so they trade a
// little contrast headroom for a tint that always reads stronger than the row and focused tints.
const MIN_EMPHASIS_CONTRAST = 4;
const MIN_DIFF_SIGN_CONTRAST = 3;
const LIGHT_SURFACE_LUMINANCE = 0.45;

const FALLBACK_DIFF_COLORS = {
	dark: { added: "#5ecc71", removed: "#ff6762", modified: "#69b1ff" },
	light: { added: "#0dbe4e", removed: "#ff2e3f", modified: "#009fff" },
} as const;

const isLight = (background: string) => relativeLuminance(background) > LIGHT_SURFACE_LUMINANCE;

/** The appearance a theme derives to from its background alone, ahead of full derivation. */
export const appearanceForBackground = (background: string): Appearance =>
	isLight(background) ? "light" : "dark";

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
	minContrast = MIN_TEXT_CONTRAST,
}: {
	tintColor: string;
	background: string;
	foreground: string;
	preferredAmount: number;
	minContrast?: number;
}): string => {
	for (let amount = preferredAmount; amount >= 0.02; amount -= 0.02) {
		const candidate = blendHex(tintColor, background, amount);
		if (contrastRatio(foreground, candidate) >= minContrast) return candidate;
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

/** The inputs `buildThemeFromInputs` derives a full Theme from, bundled or custom. */
export type BuildThemeInputs = {
	id: string;
	label?: string;
	background: string;
	foreground?: string;
	diffColors?: BundledShikiThemeDiffColors;
	syntaxTheme?: string;
};

/** Derive one complete Revue theme from arbitrary derivation inputs, bundled or custom. */
export const buildThemeFromInputs = (inputs: BuildThemeInputs): Theme => {
	const editorBackground = inputs.background;
	const lightSurface = isLight(editorBackground);
	const fallbackDiffColors = FALLBACK_DIFF_COLORS[lightSurface ? "light" : "dark"];
	const diffColors = inputs.diffColors;
	const rowTint = lightSurface ? 0.12 : 0.2;
	const focusedTint = lightSurface ? 0.18 : 0.28;
	const emphasisTint = lightSurface ? 0.34 : 0.48;
	const selectedTint = lightSurface ? 0.18 : 0.25;

	const editorForeground = inputs.foreground;
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
	const emphasised = (tintColor: string) =>
		readableTintedBackground({
			tintColor,
			background: editorBackground,
			foreground: text,
			preferredAmount: emphasisTint,
			minContrast: MIN_EMPHASIS_CONTRAST,
		});

	return {
		id: inputs.id,
		label: inputs.label ?? inputs.id,
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
		addedEmphasisBg: emphasised(added),
		removedEmphasisBg: emphasised(removed),
		selectedHunk: blendHex(modified, editorBackground, selectedTint),
		addedSignColor: added,
		removedSignColor: removed,
		lineNumberFg: readableDimForeground(dimmed, editorBackground),
		badgeAdded: readableChromeColor(added, panel, panelAlt),
		badgeRemoved: readableChromeColor(removed, panel, panelAlt),
		badgeModified: readableChromeColor(modified, panel, panelAlt),
		badgeNeutral: readableDimForeground(dimmed, panelAlt),
		syntaxTheme: inputs.syntaxTheme ?? inputs.id,
	};
};

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
