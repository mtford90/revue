import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	applyOverrides,
	type BundledThemeInputs,
	buildThemeFromInputs,
	bundledThemeInputs,
	CustomThemeFileSchema,
	DEFAULT_DARK_THEME_ID,
	isBundledShikiThemeId,
	OVERRIDABLE_THEME_SLOTS,
	type OverridableThemeSlot,
	THEMES,
	type Theme,
	type ThemeOverrides,
} from "@revue/theme";
import { stripJsonComments } from "./keybindings.ts";

export const defaultThemesDir = (): string => join(homedir(), ".revue", "themes");

export type ThemeIssue = { entry: string; reason: string };

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const isValidColor = (value: string): boolean => HEX_COLOR.test(value);

/** A colour slot: falls back to `fallback` when absent, or when invalid (with an issue). */
const readColor = (
	id: string,
	slot: string,
	value: string | undefined,
	fallback: string | undefined,
	issues: ThemeIssue[],
): string | undefined => {
	if (value === undefined) return fallback;
	if (isValidColor(value)) return value;
	issues.push({
		entry: `${id}.${slot}`,
		reason: `invalid colour "${value}" for "${slot}"; ignored`,
	});
	return fallback;
};

const readDiffColors = (
	id: string,
	file: { added?: string; removed?: string; modified?: string } | undefined,
	base: { added?: string; removed?: string; modified?: string } | undefined,
	issues: ThemeIssue[],
) => {
	if (!file && !base) return undefined;
	return {
		added: readColor(id, "diffColors.added", file?.added, base?.added, issues),
		removed: readColor(id, "diffColors.removed", file?.removed, base?.removed, issues),
		modified: readColor(id, "diffColors.modified", file?.modified, base?.modified, issues),
	};
};

const readSyntaxTheme = (
	id: string,
	value: string | undefined,
	base: string | undefined,
	issues: ThemeIssue[],
): string => {
	if (value === undefined) return base ?? DEFAULT_DARK_THEME_ID;
	if (isBundledShikiThemeId(value)) return value;
	issues.push({
		entry: `${id}.syntaxTheme`,
		reason: `"${value}" is not a bundled Shiki theme; ignored`,
	});
	return base ?? DEFAULT_DARK_THEME_ID;
};

const readOverrides = (
	id: string,
	raw: Record<string, string> | undefined,
	issues: ThemeIssue[],
): ThemeOverrides => {
	if (!raw) return {};
	const slots: readonly string[] = OVERRIDABLE_THEME_SLOTS;
	const overrides: ThemeOverrides = {};
	for (const [slot, value] of Object.entries(raw)) {
		if (!slots.includes(slot)) {
			issues.push({
				entry: `${id}.overrides.${slot}`,
				reason: `unknown override slot "${slot}"; ignored`,
			});
			continue;
		}
		if (!isValidColor(value)) {
			issues.push({
				entry: `${id}.overrides.${slot}`,
				reason: `invalid colour "${value}" for "${slot}"; ignored`,
			});
			continue;
		}
		overrides[slot as OverridableThemeSlot] = value;
	}
	return overrides;
};

/**
 * Parse one custom theme file: strip comments, validate shape, resolve `extends` against the
 * bundled derivation inputs, derive via the shared theme core, then apply verbatim overrides. A
 * malformed file or unknown `extends` drops the whole theme; a bad colour, syntax theme, or
 * override slot drops just that key and falls back to the `extends` base where one exists.
 */
export const parseCustomTheme = (
	id: string,
	text: string,
): { theme?: Theme; issues: ThemeIssue[] } => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripJsonComments(text));
	} catch {
		return { issues: [{ entry: id, reason: "malformed JSON; theme ignored" }] };
	}
	const result = CustomThemeFileSchema.safeParse(parsed);
	if (!result.success) return { issues: [{ entry: id, reason: "malformed theme file; ignored" }] };
	const file = result.data;

	let base: BundledThemeInputs | undefined;
	if (file.extends !== undefined) {
		if (!isBundledShikiThemeId(file.extends)) {
			return {
				issues: [{ entry: id, reason: `unknown extends "${file.extends}"; theme ignored` }],
			};
		}
		base = bundledThemeInputs(file.extends);
	}

	const issues: ThemeIssue[] = [];
	const background = readColor(id, "background", file.background, base?.background, issues);
	if (background === undefined) {
		return { issues: [{ entry: id, reason: "needs a background or extends; theme ignored" }] };
	}
	const foreground = readColor(id, "foreground", file.foreground, base?.foreground, issues);
	const diffColors = readDiffColors(id, file.diffColors, base?.diffColors, issues);
	const syntaxTheme = readSyntaxTheme(id, file.syntaxTheme, base?.syntaxTheme, issues);

	const derived = buildThemeFromInputs({
		id,
		label: file.label,
		background,
		foreground,
		diffColors,
		syntaxTheme,
	});
	const overrides = readOverrides(id, file.overrides, issues);
	return { theme: applyOverrides(derived, overrides), issues };
};

const THEME_FILE_SUFFIX = ".json";

/**
 * Reads every `*.json` theme in `dir`, one theme per file named by its id. Reviewer-owned and
 * never written by the app; a missing directory is silent.
 */
export const loadCustomThemes = async (
	dir: string,
): Promise<{ themes: Theme[]; issues: ThemeIssue[] }> => {
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException | undefined)?.code;
		if (code === "ENOENT") return { themes: [], issues: [] };
		return { themes: [], issues: [{ entry: dir, reason: "could not read the themes directory" }] };
	}

	const themes: Theme[] = [];
	const issues: ThemeIssue[] = [];
	for (const entry of entries.filter((name) => name.endsWith(THEME_FILE_SUFFIX)).sort()) {
		const id = entry.slice(0, -THEME_FILE_SUFFIX.length);
		let text: string;
		try {
			text = await readFile(join(dir, entry), "utf8");
		} catch {
			issues.push({ entry: id, reason: "could not read the file; theme ignored" });
			continue;
		}
		const result = parseCustomTheme(id, text);
		issues.push(...result.issues);
		if (result.theme) themes.push(result.theme);
	}
	return { themes, issues };
};

/**
 * Bundled themes merged with custom ones for the picker: a custom theme shares its slot with a
 * same-id bundled theme (customised in place, shown once) or is appended (pure custom).
 */
export const mergeCustomThemes = (
	customThemes: readonly Theme[],
): { themes: Theme[]; customIds: ReadonlySet<string> } => {
	const customById = new Map(customThemes.map((theme) => [theme.id, theme]));
	const shadowed = THEMES.map((theme) => customById.get(theme.id) ?? theme);
	const extra = customThemes
		.filter((theme) => !THEMES.some((bundled) => bundled.id === theme.id))
		.sort((a, b) => a.id.localeCompare(b.id));
	return { themes: [...shadowed, ...extra], customIds: new Set(customById.keys()) };
};
