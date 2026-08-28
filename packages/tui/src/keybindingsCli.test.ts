import { afterAll, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEffectiveKeymap, mergeKeymap, stripJsonComments } from "./keybindings.ts";
import {
	formatKeybindingsListing,
	generateKeybindingsTemplate,
	initKeybindingsFile,
} from "./keybindingsCli.ts";
import { expandShiftAliases, KEYMAP } from "./keymap.ts";

const tmpDirs: string[] = [];
afterAll(async () => {
	await Promise.all(tmpDirs.map((directory) => rm(directory, { recursive: true, force: true })));
});

const tmpPath = async (): Promise<string> => {
	const directory = await mkdtemp(join(tmpdir(), "revue-keybindings-cli-"));
	tmpDirs.push(directory);
	return join(directory, ".revue", "keybindings.json");
};

const TEMPLATE_ENTRY = /^\s*\/\/ ("[^"]+": \[[^\]]*\])$/gm;

const templateEntries = (template: string): string[] =>
	[...template.matchAll(TEMPLATE_ENTRY)].map((match) => match[1] ?? "");

/** Uncomments every entry line (adding a trailing comma) then removes the comma left dangling
 * before the closing brace. */
const uncommentAllEntries = (template: string): string =>
	templateEntries(template)
		.reduce((text, entry) => text.replace(`// ${entry}`, `${entry},`), template)
		.replace(/,(\s*})/, "$1");

const sameKeySet = (a: readonly string[], b: readonly string[]): boolean => {
	const expandedA = new Set(expandShiftAliases(a));
	const expandedB = new Set(expandShiftAliases(b));
	return expandedA.size === expandedB.size && [...expandedA].every((key) => expandedB.has(key));
};

test("the listing shows every action's id, description, and effective keys", () => {
	const listing = formatKeybindingsListing(KEYMAP, KEYMAP, []);
	expect(listing).toContain("line-up");
	expect(listing).toContain("Scroll up one visual row without moving the line cursor");
	expect(listing).toMatch(/line-up\s+↑/);
	expect(listing).toMatch(/previous-source-line\s+k/);
});

test("the listing flags an overridden action against its default", () => {
	const { keymap } = mergeKeymap(KEYMAP, { quit: "z" });
	const listing = formatKeybindingsListing(KEYMAP, keymap, []);
	expect(listing).toMatch(/quit\s+z\s+Quit \(Esc also works\) \(overridden, default: q\/Q\)/);
});

test("the listing shows the full default match set, not the display-only alias form", () => {
	const { keymap } = mergeKeymap(KEYMAP, { "page-up": "z" });
	const listing = formatKeybindingsListing(KEYMAP, keymap, []);
	expect(listing).toContain("(overridden, default: PgUp/b/Ctrl-b)");
});

test("the listing does not flag an unchanged value as overridden once shift aliases are re-added", () => {
	// Restating comments-last's own default verbatim expands "G" back to ["G", "shift+g"], which
	// must not read as a change — the registry and the override go through the same expansion.
	const { keymap, issues } = mergeKeymap(KEYMAP, { "comments-last": ["G", "end", ">"] });
	expect(issues).toEqual([]);
	const listing = formatKeybindingsListing(KEYMAP, keymap, []);
	expect(listing).not.toMatch(/comments-last\s+.*overridden/);
});

test("the listing shows page navigation as an ordinary rebindable action", () => {
	const listing = formatKeybindingsListing(KEYMAP, KEYMAP, []);
	expect(listing).toMatch(/previous-page\s+\[/);
	expect(listing).toMatch(/next-page\s+\]/);
	expect(listing).not.toContain("fixed, not rebindable");
});

test("the listing reports validation issues", () => {
	const listing = formatKeybindingsListing(KEYMAP, KEYMAP, [
		{ entry: "not-a-real-action", reason: 'unknown action "not-a-real-action"' },
	]);
	expect(listing).toContain("Issues:");
	expect(listing).toContain('not-a-real-action: unknown action "not-a-real-action"');
});

test("the template includes every action, since every action is now rebindable", () => {
	const template = generateKeybindingsTemplate(KEYMAP);
	for (const action of KEYMAP) expect(template).toContain(`"${action.id}"`);
});

test("the template's entries keep every validator-accepted key, including ctrl+ chords", () => {
	const template = generateKeybindingsTemplate(KEYMAP);
	// page-up/page-down's ctrl+b/ctrl+f fallbacks are valid override keys and must not be
	// silently dropped in favour of the shorter display form.
	expect(template).toContain('// "page-up": ["pageup","b","ctrl+b"]');
	expect(template).toContain('// "page-down": ["pagedown","space","ctrl+f"]');
});

test("uncommenting every template entry at once round-trips with no issues and reproduces the defaults", async () => {
	const template = generateKeybindingsTemplate(KEYMAP);
	const uncommented = uncommentAllEntries(template);
	expect(() => JSON.parse(stripJsonComments(uncommented))).not.toThrow();

	const path = await tmpPath();
	await Bun.write(path, uncommented);
	const { keymap, issues } = await loadEffectiveKeymap(path);
	expect(issues).toEqual([]);

	for (const action of KEYMAP) {
		const effective = keymap.find((candidate) => candidate.id === action.id);
		expect(sameKeySet(effective?.keys ?? [], action.keys)).toBe(true);
	}
});

test("uncommenting each template entry individually round-trips with no issues", () => {
	const template = generateKeybindingsTemplate(KEYMAP);
	for (const entry of templateEntries(template)) {
		const overrides = JSON.parse(`{${entry}}`);
		const { keymap, issues } = mergeKeymap(KEYMAP, overrides);
		expect(issues).toEqual([]);
		const id = Object.keys(overrides)[0];
		const action = KEYMAP.find((candidate) => candidate.id === id);
		const effective = keymap.find((candidate) => candidate.id === id);
		expect(sameKeySet(effective?.keys ?? [], action?.keys ?? [])).toBe(true);
	}
});

test("init writes the template to the given path, creating parent directories", async () => {
	const path = await tmpPath();
	const result = initKeybindingsFile(path, KEYMAP, false);
	expect(result.wrote).toBe(true);
	const written = await readFile(path, "utf8");
	expect(written).toBe(generateKeybindingsTemplate(KEYMAP));
});

test("init refuses to overwrite an existing file without --force", async () => {
	const path = await tmpPath();
	initKeybindingsFile(path, KEYMAP, false);
	const second = initKeybindingsFile(path, KEYMAP, false);
	expect(second.wrote).toBe(false);
});

test("init overwrites an existing file when forced", async () => {
	const path = await tmpPath();
	initKeybindingsFile(path, KEYMAP, false);
	const forced = initKeybindingsFile(path, KEYMAP, true);
	expect(forced.wrote).toBe(true);
});

test("init raises on an unwritable directory instead of writing", async () => {
	const directory = await mkdtemp(join(tmpdir(), "revue-keybindings-cli-"));
	tmpDirs.push(directory);
	await mkdir(join(directory, ".revue"));
	await chmod(join(directory, ".revue"), 0o500);
	try {
		expect(() =>
			initKeybindingsFile(join(directory, ".revue", "keybindings.json"), KEYMAP, false),
		).toThrow();
	} finally {
		await chmod(join(directory, ".revue"), 0o700);
	}
});
