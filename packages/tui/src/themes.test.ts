import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_DARK_THEME_ID, isBundledShikiThemeId, resolveTheme, THEMES } from "@revue/theme";
import {
	defaultThemesDir,
	loadCustomThemes,
	mergeCustomThemes,
	parseCustomTheme,
} from "./themes.ts";

const tmpDirs: string[] = [];
afterAll(async () => {
	await Promise.all(tmpDirs.map((directory) => rm(directory, { recursive: true, force: true })));
});

const tmpThemesDir = async (): Promise<string> => {
	const directory = await mkdtemp(join(tmpdir(), "revue-themes-"));
	tmpDirs.push(directory);
	return directory;
};

test("custom theme files live under the user's home", () => {
	expect(defaultThemesDir()).toBe(join(homedir(), ".revue", "themes"));
});

test("a theme with a background and no extends derives directly", () => {
	const { theme, issues } = parseCustomTheme("solarpunk", `{ "background": "#101820" }`);
	expect(issues).toEqual([]);
	expect(theme).toMatchObject({ id: "solarpunk", label: "solarpunk", appearance: "dark" });
	expect(isBundledShikiThemeId(theme?.syntaxTheme)).toBe(true);
});

test("extends resolves against a bundled theme and an override pins a slot verbatim", () => {
	const { theme, issues } = parseCustomTheme(
		"dracula-ish",
		`{
			"extends": "dracula",
			"label": "Dracula, ish",
			"overrides": { "accent": "#ff00ff" }
		}`,
	);
	expect(issues).toEqual([]);
	const dracula = THEMES.find((candidate) => candidate.id === "dracula");
	expect(theme).toMatchObject({
		id: "dracula-ish",
		label: "Dracula, ish",
		background: dracula?.background,
		accent: "#ff00ff",
		syntaxTheme: "dracula",
	});
});

test("JSONC comments are stripped before parsing", () => {
	const { theme, issues } = parseCustomTheme(
		"commented",
		`{
			// derive from dracula
			"extends": "dracula" /* trailing */
		}`,
	);
	expect(issues).toEqual([]);
	expect(theme?.id).toBe("commented");
});

test("malformed JSON drops the whole theme", () => {
	const { theme, issues } = parseCustomTheme("broken", "{ not json");
	expect(theme).toBeUndefined();
	expect(issues).toEqual([{ entry: "broken", reason: "malformed JSON; theme ignored" }]);
});

test("a non-object root drops the whole theme", () => {
	const { theme, issues } = parseCustomTheme("bad-shape", `["not", "an", "object"]`);
	expect(theme).toBeUndefined();
	expect(issues).toEqual([{ entry: "bad-shape", reason: "malformed theme file; ignored" }]);
});

test("an unknown extends drops the whole theme", () => {
	const { theme, issues } = parseCustomTheme("ghost", `{ "extends": "not-a-real-theme" }`);
	expect(theme).toBeUndefined();
	expect(issues).toEqual([
		{ entry: "ghost", reason: 'unknown extends "not-a-real-theme"; theme ignored' },
	]);
});

test("no background and no extends cannot derive, so the whole theme drops", () => {
	const { theme, issues } = parseCustomTheme("rootless", `{ "label": "Rootless" }`);
	expect(theme).toBeUndefined();
	expect(issues).toEqual([
		{ entry: "rootless", reason: "needs a background or extends; theme ignored" },
	]);
});

test("an invalid background with no extends reports the specific colour issue, not the generic one", () => {
	const { theme, issues } = parseCustomTheme("bad-background", `{ "background": "not-a-colour" }`);
	expect(theme).toBeUndefined();
	expect(issues).toEqual([
		{
			entry: "bad-background.background",
			reason: 'invalid colour "not-a-colour" for "background"; ignored',
		},
	]);
});

test("shorthand #rgb colours derive identically to their #rrggbb expansions", () => {
	const shorthand = parseCustomTheme("shorthand", `{ "background": "#fff", "foreground": "#000" }`);
	const expanded = parseCustomTheme(
		"shorthand",
		`{ "background": "#ffffff", "foreground": "#000000" }`,
	);
	expect(shorthand.issues).toEqual([]);
	expect(shorthand.theme).toEqual(expanded.theme);
	expect(shorthand.theme?.background).toBe("#ffffff");
	expect(shorthand.theme?.appearance).toBe("light");
});

test("shorthand diffColors derive identically to their expansions", () => {
	const shorthand = parseCustomTheme(
		"shorthand-diff",
		`{ "background": "#101010", "diffColors": { "added": "#0f0", "removed": "#f00", "modified": "#00f" } }`,
	);
	const expanded = parseCustomTheme(
		"shorthand-diff",
		`{ "background": "#101010", "diffColors": { "added": "#00ff00", "removed": "#ff0000", "modified": "#0000ff" } }`,
	);
	expect(shorthand.issues).toEqual([]);
	expect(shorthand.theme).toEqual(expanded.theme);
});

test("a shorthand override pins the expanded colour in the rendered theme", () => {
	const { theme, issues } = parseCustomTheme(
		"shorthand-override",
		`{ "extends": "dracula", "overrides": { "accent": "#f0f" } }`,
	);
	expect(issues).toEqual([]);
	expect(theme?.accent).toBe("#ff00ff");
});

test("the emphasis slots round-trip as overrides without loader changes", () => {
	const { theme, issues } = parseCustomTheme(
		"emphasis-override",
		`{ "extends": "dracula", "overrides": { "addedEmphasisBg": "#0a3d0a", "removedEmphasisBg": "#3d0a0a" } }`,
	);
	expect(issues).toEqual([]);
	expect(theme?.addedEmphasisBg).toBe("#0a3d0a");
	expect(theme?.removedEmphasisBg).toBe("#3d0a0a");
});

test("a light background defaults its syntax theme to ayu-light rather than ayu-dark", () => {
	const { theme, issues } = parseCustomTheme("light-default", `{ "background": "#ffffff" }`);
	expect(issues).toEqual([]);
	expect(theme?.syntaxTheme).toBe("ayu-light");
});

test("a dark background defaults its syntax theme to ayu-dark", () => {
	const { theme, issues } = parseCustomTheme("dark-default", `{ "background": "#000000" }`);
	expect(issues).toEqual([]);
	expect(theme?.syntaxTheme).toBe("ayu-dark");
});

test("extends still wins the syntax theme default over the background's own appearance", () => {
	const { theme, issues } = parseCustomTheme(
		"extends-default",
		`{ "extends": "ayu-light", "background": "#000000" }`,
	);
	expect(issues).toEqual([]);
	expect(theme?.syntaxTheme).toBe("ayu-light");
});

test("a wrong-typed background drops only that key rather than the whole file", () => {
	const { theme, issues } = parseCustomTheme("bad-background-type", `{ "background": 123 }`);
	expect(theme).toBeUndefined();
	expect(issues).toEqual([
		{
			entry: "bad-background-type.background",
			reason: 'invalid colour 123 for "background"; ignored',
		},
	]);
});

test("a wrong-typed label drops only that key and falls back to the theme id", () => {
	const { theme, issues } = parseCustomTheme(
		"bad-label-type",
		`{ "background": "#101010", "label": 5 }`,
	);
	expect(theme?.label).toBe("bad-label-type");
	expect(issues).toEqual([
		{ entry: "bad-label-type.label", reason: '"label" must be a string; ignored' },
	]);
});

test("a wrong-typed extends drops the whole theme, since extends is structural", () => {
	const { theme, issues } = parseCustomTheme("bad-extends-type", `{ "extends": 5 }`);
	expect(theme).toBeUndefined();
	expect(issues).toEqual([
		{ entry: "bad-extends-type", reason: '"extends" must be a string; theme ignored' },
	]);
});

test("a wrong-typed diffColors drops only that key and falls back to the extends base", () => {
	const { theme, issues } = parseCustomTheme(
		"bad-diff-colors-type",
		`{ "extends": "dracula", "diffColors": "not an object" }`,
	);
	const dracula = THEMES.find((candidate) => candidate.id === "dracula");
	expect(theme?.addedSignColor).toEqual(dracula?.addedSignColor);
	expect(issues).toEqual([
		{ entry: "bad-diff-colors-type.diffColors", reason: '"diffColors" must be an object; ignored' },
	]);
});

test("a wrong-typed overrides entry drops only that override key", () => {
	const { theme, issues } = parseCustomTheme(
		"bad-override-type",
		`{ "extends": "dracula", "overrides": { "accent": 123 } }`,
	);
	const dracula = THEMES.find((candidate) => candidate.id === "dracula");
	expect(theme?.accent).toBe(dracula?.accent);
	expect(issues).toEqual([
		{
			entry: "bad-override-type.overrides.accent",
			reason: 'invalid colour 123 for "accent"; ignored',
		},
	]);
});

test("a non-object overrides value drops the overrides key entirely", () => {
	const { theme, issues } = parseCustomTheme(
		"bad-overrides-shape",
		`{ "background": "#101010", "overrides": "not an object" }`,
	);
	expect(theme).toBeDefined();
	expect(issues).toEqual([
		{ entry: "bad-overrides-shape.overrides", reason: '"overrides" must be an object; ignored' },
	]);
});

test("an invalid colour drops only that key and falls back to the extends base", () => {
	const { theme, issues } = parseCustomTheme(
		"bad-foreground",
		`{ "extends": "dracula", "foreground": "not-a-colour" }`,
	);
	const dracula = THEMES.find((candidate) => candidate.id === "dracula");
	expect(theme?.text).toEqual(dracula?.text);
	expect(issues).toEqual([
		{
			entry: "bad-foreground.foreground",
			reason: 'invalid colour "not-a-colour" for "foreground"; ignored',
		},
	]);
});

test("an invalid syntaxTheme drops only that key and falls back to the extends base", () => {
	const { theme, issues } = parseCustomTheme(
		"bad-syntax",
		`{ "extends": "dracula", "syntaxTheme": "not-a-shiki-theme" }`,
	);
	expect(theme?.syntaxTheme).toBe("dracula");
	expect(issues).toEqual([
		{
			entry: "bad-syntax.syntaxTheme",
			reason: '"not-a-shiki-theme" is not a bundled Shiki theme; ignored',
		},
	]);
});

test("an unknown override slot drops only that key", () => {
	const { theme, issues } = parseCustomTheme(
		"bad-slot",
		`{ "extends": "dracula", "overrides": { "notASlot": "#ffffff" } }`,
	);
	expect(theme).toBeDefined();
	expect(issues).toEqual([
		{ entry: "bad-slot.overrides.notASlot", reason: 'unknown override slot "notASlot"; ignored' },
	]);
});

test("an invalid override colour drops only that key", () => {
	const { theme, issues } = parseCustomTheme(
		"bad-override-colour",
		`{ "extends": "dracula", "overrides": { "accent": "not-a-colour" } }`,
	);
	const dracula = THEMES.find((candidate) => candidate.id === "dracula");
	expect(theme?.accent).toBe(dracula?.accent);
	expect(issues).toEqual([
		{
			entry: "bad-override-colour.overrides.accent",
			reason: 'invalid colour "not-a-colour" for "accent"; ignored',
		},
	]);
});

test("mergeCustomThemes shadows a same-id bundled theme once and appends pure custom themes", () => {
	const shadow = parseCustomTheme(
		"dracula",
		`{ "extends": "dracula", "label": "Dracula (mine)" }`,
	).theme;
	const pure = parseCustomTheme("solarpunk", `{ "background": "#101820" }`).theme;
	if (!shadow || !pure) throw new Error("expected both themes to derive");

	const { themes, customIds } = mergeCustomThemes([shadow, pure]);
	expect(themes).toHaveLength(THEMES.length + 1);
	expect(themes.filter((theme) => theme.id === "dracula")).toEqual([shadow]);
	expect(themes.at(-1)).toBe(pure);
	expect(customIds).toEqual(new Set(["dracula", "solarpunk"]));
});

test("loadCustomThemes reads every *.json theme and reports a broken file without dropping the rest", async () => {
	const dir = await tmpThemesDir();
	await writeFile(join(dir, "dracula-ish.json"), `{ "extends": "dracula" }`, "utf8");
	await writeFile(join(dir, "broken.json"), "{ not json", "utf8");
	await writeFile(join(dir, "notes.txt"), "ignored, not a theme file", "utf8");

	const { themes, issues } = await loadCustomThemes(dir);
	expect(themes.map((theme) => theme.id)).toEqual(["dracula-ish"]);
	expect(issues).toEqual([{ entry: "broken", reason: "malformed JSON; theme ignored" }]);
});

test("a missing themes directory is silent", async () => {
	const dir = join(await tmpThemesDir(), "does-not-exist");
	const { themes, issues } = await loadCustomThemes(dir);
	expect(themes).toEqual([]);
	expect(issues).toEqual([]);
});

test("a broken preferred theme resolves to the default without any preference file involved", async () => {
	const dir = await tmpThemesDir();
	await writeFile(join(dir, "broken.json"), "{ not json", "utf8");
	const { themes, issues } = await loadCustomThemes(dir);
	expect(issues).toEqual([{ entry: "broken", reason: "malformed JSON; theme ignored" }]);

	expect(resolveTheme("broken", null, themes).id).toBe(DEFAULT_DARK_THEME_ID);
});

test("a missing preferred custom theme id resolves to the default", () => {
	expect(resolveTheme("does-not-exist", null, []).id).toBe(DEFAULT_DARK_THEME_ID);
});

test("the guide's custom-theme worked example parses cleanly through the real loader", async () => {
	const guide = await readFile(join(import.meta.dir, "../../../docs/guide.md"), "utf8");
	const match = guide.match(/```jsonc\n\/\/ ~\/\.revue\/themes\/my-ayu\.json\n([\s\S]*?)```/);
	const worked = match?.[1];
	if (!worked) throw new Error("guide.md's my-ayu.json worked example was not found");

	const { theme, issues } = parseCustomTheme("my-ayu", worked);
	expect(issues).toEqual([]);
	expect(theme?.accent).toBe("#ff9940");
});
