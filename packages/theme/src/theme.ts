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

/** Look one theme up by id; a custom theme shadows the bundled theme sharing its id. */
const namedTheme = (themeId: string, extraThemes: readonly Theme[] | undefined) =>
	extraThemeById(extraThemes, themeId) ?? themeById(themeId);

/**
 * Resolve a named theme; absence uses Ayu Dark, and an unknown name the Ayu theme for the
 * terminal's appearance. `extraThemes` shadow bundled themes that share an id.
 */
export const resolveTheme = (
	requested: string | undefined,
	appearance?: Appearance | null,
	extraThemes?: readonly Theme[],
): Theme => {
	if (requested === undefined) return defaultTheme(null);
	return namedTheme(requested, extraThemes) ?? defaultTheme(appearance);
};

/** The id standing for "whichever half of the pair matches the terminal" rather than one theme. */
export const FOLLOW_TERMINAL = "auto";

/**
 * What the reviewer painted with: either one pinned theme, or a light/dark pair the terminal's
 * own background chooses between.
 */
export type ThemeChoice = {
	/** A pinned theme id; `auto` or absence follows the terminal instead. */
	themeId?: string;
	/** The halves the terminal chooses between; absence uses the Ayu default for that appearance. */
	lightThemeId?: string;
	darkThemeId?: string;
};

/** The pinned id, or nothing when the choice defers to the terminal. */
const pinnedThemeId = (themeId: string | undefined): string | undefined =>
	themeId === undefined || themeId === FOLLOW_TERMINAL ? undefined : themeId;

/** Whether a stored or requested theme id follows the terminal rather than pinning one theme. */
export const followsTerminal = (themeId: string | undefined): boolean =>
	pinnedThemeId(themeId) === undefined;

/** The half of the pair the terminal asks for; an unreported appearance takes the dark half. */
export const pairedThemeId = (
	choice: ThemeChoice,
	appearance: Appearance | null | undefined,
): string =>
	appearance === "light"
		? (choice.lightThemeId ?? DEFAULT_LIGHT_THEME_ID)
		: (choice.darkThemeId ?? DEFAULT_DARK_THEME_ID);

/**
 * The theme to paint with. A pinned theme wins outright; otherwise the terminal's appearance
 * picks a half of the pair. Ids that no longer name a theme fall back to the Ayu defaults, so a
 * deleted custom theme leaves the reviewer readable rather than unstyled.
 */
export const resolveThemeChoice = (
	choice: ThemeChoice,
	appearance?: Appearance | null,
	extraThemes?: readonly Theme[],
): Theme => {
	const pinned = pinnedThemeId(choice.themeId);
	return (
		(pinned === undefined ? undefined : namedTheme(pinned, extraThemes)) ??
		namedTheme(pairedThemeId(choice, appearance), extraThemes) ??
		defaultTheme(appearance)
	);
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
