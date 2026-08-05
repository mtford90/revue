import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEffectiveKeymap, mergeKeymap, stripJsonComments } from "./keybindings.ts";
import {
	formatKeybindingsListing,
	generateKeybindingsTemplate,
	initKeybindingsFile,
} from "./keybindingsCli.ts";
import { KEYMAP } from "./keymap.ts";

const tmpDirs: string[] = [];
afterAll(async () => {
	await Promise.all(tmpDirs.map((directory) => rm(directory, { recursive: true, force: true })));
});

const tmpPath = async (): Promise<string> => {
	const directory = await mkdtemp(join(tmpdir(), "revue-keybindings-cli-"));
	tmpDirs.push(directory);
	return join(directory, ".revue", "keybindings.json");
};

test("the listing shows every action's id, description, and effective keys", () => {
	const listing = formatKeybindingsListing(KEYMAP, KEYMAP, []);
	expect(listing).toContain("line-up");
	expect(listing).toContain("Scroll up one line");
	expect(listing).toContain("k/↑");
});

test("the listing flags an overridden action against its default", () => {
	const { keymap } = mergeKeymap(KEYMAP, { quit: "z" });
	const listing = formatKeybindingsListing(KEYMAP, keymap, []);
	expect(listing).toMatch(/quit\s+z\s+Quit \(Esc also works\) \(overridden, default: q\)/);
});

test("the listing reports validation issues", () => {
	const listing = formatKeybindingsListing(KEYMAP, KEYMAP, [
		{ entry: "not-a-real-action", reason: 'unknown action "not-a-real-action"' },
	]);
	expect(listing).toContain("Issues:");
	expect(listing).toContain('not-a-real-action: unknown action "not-a-real-action"');
});

test("the template omits chord actions and includes every rebindable one", () => {
	const template = generateKeybindingsTemplate(KEYMAP);
	expect(template).not.toContain('"previous-page"');
	expect(template).toContain('// "quit": ["q"]');
});

test("uncommenting a single template entry round-trips through the real loader", async () => {
	const template = generateKeybindingsTemplate(KEYMAP);
	const uncommented = template.replace('// "quit": ["q"]', '"quit": ["z"]');
	const path = await tmpPath();
	await Bun.write(path, uncommented);
	const parsed = JSON.parse(stripJsonComments(uncommented));
	expect(parsed).toEqual({ quit: ["z"] });
	const { keymap, issues } = await loadEffectiveKeymap(path);
	expect(issues).toEqual([]);
	expect(keymap.find((action) => action.id === "quit")?.keys).toEqual(["z"]);
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
