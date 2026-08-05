import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { THEMES } from "@revue/theme";
import { loadCustomThemes, parseCustomTheme } from "./themes.ts";
import {
	formatThemesListing,
	generateThemesTemplate,
	initThemesFile,
	isValidThemeName,
} from "./themesCli.ts";

const tmpDirs: string[] = [];
afterAll(async () => {
	await Promise.all(tmpDirs.map((directory) => rm(directory, { recursive: true, force: true })));
});

const tmpDir = async (): Promise<string> => {
	const directory = await mkdtemp(join(tmpdir(), "revue-themes-cli-"));
	tmpDirs.push(directory);
	return directory;
};

test("the listing shows every bundled theme grouped by appearance", async () => {
	const { themes } = await loadCustomThemes(join(await tmpDir(), "themes"));
	const listing = formatThemesListing({ customThemes: themes, issues: [] });
	expect(listing).toContain("dark:");
	expect(listing).toContain("light:");
	expect(listing).toContain("ayu-dark");
});

test("the listing marks a pure custom theme as (custom)", async () => {
	const dir = await tmpDir();
	await writeFile(join(dir, "my-theme.json"), '{"background":"#101010"}', "utf8");
	const { themes, issues } = await loadCustomThemes(dir);
	const listing = formatThemesListing({ customThemes: themes, issues });
	expect(listing).toMatch(/my-theme.*\(custom\)/);
});

test("the listing marks a shadowed bundled theme as (customised), shown once", async () => {
	const dir = await tmpDir();
	await writeFile(
		join(dir, "ayu-dark.json"),
		'{"extends":"ayu-dark","overrides":{"accent":"#ff0000"}}',
		"utf8",
	);
	const { themes, issues } = await loadCustomThemes(dir);
	const listing = formatThemesListing({ customThemes: themes, issues });
	const occurrences = listing.split("\n").filter((line) => line.includes("ayu-dark"));
	expect(occurrences.length).toBe(1);
	expect(occurrences[0]).toContain("(customised)");
});

test("the listing reports validation issues from a broken file", async () => {
	const dir = await tmpDir();
	await writeFile(join(dir, "broken.json"), "{not json", "utf8");
	const { themes, issues } = await loadCustomThemes(dir);
	expect(issues.length).toBeGreaterThan(0);
	const listing = formatThemesListing({ customThemes: themes, issues });
	expect(listing).toContain("Issues:");
	expect(listing).toContain("broken: malformed JSON; theme ignored");
});

test("the template ships an active extends and documents overrides with a commented worked example", () => {
	const template = generateThemesTemplate("my-theme");
	expect(template).toContain('"extends": "ayu-dark"');
	expect(template).toContain('  // "overrides": {');
});

test("a freshly-written template parses cleanly as an ayu-dark clone", () => {
	const template = generateThemesTemplate("my-theme");
	const { theme, issues } = parseCustomTheme("my-theme", template);
	expect(issues).toEqual([]);
	expect(theme).toBeDefined();
	const ayuDark = THEMES.find((candidate) => candidate.id === "ayu-dark");
	expect(theme?.background).toBe(ayuDark?.background);
});

test("uncommenting the template's remaining example entries round-trips with no issues", () => {
	const template = generateThemesTemplate("my-theme");
	const uncommented = template
		.replace('"extends": "ayu-dark"', '"extends": "ayu-dark",')
		.replace('  // "overrides": {', '  "overrides": {')
		.replace('  //   "accent": "#ff8800"', '    "accent": "#ff8800"')
		.replace("  // }", "  }");
	const { theme, issues } = parseCustomTheme("my-theme", uncommented);
	expect(issues).toEqual([]);
	expect(theme).toBeDefined();
	expect(theme?.accent).toBe("#ff8800");
});

test("isValidThemeName rejects path separators and leading dots", () => {
	expect(isValidThemeName("my-theme")).toBe(true);
	expect(isValidThemeName("../evil")).toBe(false);
	expect(isValidThemeName("nested/name")).toBe(false);
	expect(isValidThemeName("nested\\name")).toBe(false);
	expect(isValidThemeName(".hidden")).toBe(false);
});

test("init writes the template to the given path, creating parent directories", async () => {
	const dir = await tmpDir();
	const path = join(dir, ".revue", "themes", "my-theme.json");
	const result = initThemesFile(path, "my-theme", false);
	expect(result.wrote).toBe(true);
	const written = await readFile(path, "utf8");
	expect(written).toBe(generateThemesTemplate("my-theme"));
});

test("init refuses to overwrite an existing file without --force", async () => {
	const dir = await tmpDir();
	const path = join(dir, "my-theme.json");
	initThemesFile(path, "my-theme", false);
	const second = initThemesFile(path, "my-theme", false);
	expect(second.wrote).toBe(false);
});

test("init overwrites an existing file when forced", async () => {
	const dir = await tmpDir();
	const path = join(dir, "my-theme.json");
	initThemesFile(path, "my-theme", false);
	const forced = initThemesFile(path, "my-theme", true);
	expect(forced.wrote).toBe(true);
});
