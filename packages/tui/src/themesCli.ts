import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { OVERRIDABLE_THEME_SLOTS, THEMES, type Theme } from "@revue/theme";
import { mergeCustomThemes, type ThemeIssue } from "./themes.ts";

const APPEARANCE_ORDER = ["dark", "light"] as const;

const groupByAppearance = (themes: readonly Theme[]): { title: string; themes: Theme[] }[] =>
	APPEARANCE_ORDER.map((appearance) => ({
		title: appearance,
		themes: themes.filter((theme) => theme.appearance === appearance),
	})).filter((group) => group.themes.length > 0);

const BUNDLED_IDS = new Set(THEMES.map((theme) => theme.id));

const formatThemeLine = (theme: Theme, customIds: ReadonlySet<string>) => {
	const labelNote = theme.label !== theme.id ? ` (${theme.label})` : "";
	const marker = customIds.has(theme.id)
		? BUNDLED_IDS.has(theme.id)
			? " (customised)"
			: " (custom)"
		: "";
	return `  ${theme.id}${labelNote}${marker}`;
};

/** Lists every merged theme grouped by appearance, marking custom and shadowed bundled ids. */
export const formatThemesListing = ({
	customThemes,
	issues,
}: {
	customThemes: readonly Theme[];
	issues: readonly ThemeIssue[];
}): string => {
	const { themes, customIds } = mergeCustomThemes(customThemes);
	const sections = groupByAppearance(themes).flatMap(({ title, themes: groupThemes }) => [
		`${title}:`,
		...groupThemes.map((theme) => formatThemeLine(theme, customIds)),
		"",
	]);
	const issueLines =
		issues.length > 0
			? ["Issues:", ...issues.map((issue) => `  ${issue.entry}: ${issue.reason}`), ""]
			: [];
	return [...sections, ...issueLines].join("\n").trimEnd();
};

const TEMPLATE_HEADER = `// revue theme
//
// Defines a custom theme by deriving it from a background/foreground pair (or a bundled
// theme via "extends"), then optionally pinning individual colour slots with "overrides".
// Run \`revue themes\` to see the merged list of bundled and custom themes.
//
// Derivation inputs:
//   background, foreground   #rgb or #rrggbb; a background is required unless "extends" is set
//   diffColors.added/removed/modified   optional; fall back to the extends base's diff colours,
//                                        then the derived defaults
//
// extends: the id of a bundled theme to derive from, e.g. "ayu-dark". Run \`revue themes\` for
// the full list of bundled ids. Any of the derivation inputs above may still be set alongside
// "extends" to override just that input before deriving.
//
// overrides: pins specific colour slots verbatim on the derived theme, after derivation. Accepted
// slot names:
${OVERRIDABLE_THEME_SLOTS.map((slot) => `//   ${slot}`).join("\n")}
//
// Colours are #rgb or #rrggbb. Validation is lenient: a malformed file drops the whole theme, an
// unknown extends drops the whole theme, but a bad colour, syntax theme, or override slot just
// drops that one key and falls back to its default — see \`revue themes\` and the TUI keys surface
// for details on any dropped entries. Themes are read once at startup.
`;

const TEMPLATE_BODY = `{
  "extends": "ayu-dark"
  // "overrides": {
  //   "accent": "#ff8800"
  // }
}
`;

/** Generates a fully-commented JSONC starter file documenting the custom theme grammar. */
export const generateThemesTemplate = (_name: string): string =>
	`${TEMPLATE_HEADER}\n${TEMPLATE_BODY}`;

/** A theme name must be a bare filename stem: no path separators, and no leading dot. */
export const isValidThemeName = (name: string): boolean =>
	!name.startsWith(".") && !/[/\\]/.test(name);

export type InitResult = { path: string; wrote: true } | { path: string; wrote: false };

/** Writes the starter theme template to `path`, refusing to overwrite an existing file unless `force`. */
export const initThemesFile = (path: string, name: string, force: boolean): InitResult => {
	if (existsSync(path) && !force) return { path, wrote: false };
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, generateThemesTemplate(name), "utf8");
	return { path, wrote: true };
};
