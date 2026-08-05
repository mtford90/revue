import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	defaultKeybindingsPath,
	isValidUserKey,
	loadEffectiveKeymap,
	mergeKeymap,
	stripJsonComments,
} from "./keybindings.ts";
import { KEYMAP, type KeymapAction } from "./keymap.ts";

const tmpDirs: string[] = [];
afterAll(async () => {
	await Promise.all(tmpDirs.map((directory) => rm(directory, { recursive: true, force: true })));
});

const tmpPath = async (contents?: string): Promise<string> => {
	const directory = await mkdtemp(join(tmpdir(), "revue-keybindings-"));
	tmpDirs.push(directory);
	const path = join(directory, "keybindings.json");
	if (contents !== undefined) await writeFile(path, contents, "utf8");
	return path;
};

test("keybinding overrides live in the user's home", () => {
	expect(defaultKeybindingsPath()).toBe(join(homedir(), ".revue", "keybindings.json"));
});

test("strips line and block comments without touching string content", () => {
	const source = `{
  // rebind quit
  "quit": "x", /* inline */
  "line-up": "http://example.com" // trailing
}`;
	const stripped = stripJsonComments(source);
	expect(() => JSON.parse(stripped)).not.toThrow();
	expect(JSON.parse(stripped)).toEqual({ quit: "x", "line-up": "http://example.com" });
});

test("the key grammar accepts named keys, ctrl chords, and shifted literals", () => {
	expect(isValidUserKey("up")).toBe(true);
	expect(isValidUserKey("pageup")).toBe(true);
	expect(isValidUserKey("f10")).toBe(true);
	expect(isValidUserKey("x")).toBe(true);
	expect(isValidUserKey("X")).toBe(true);
	expect(isValidUserKey("?")).toBe(true);
	expect(isValidUserKey("{")).toBe(true);
	expect(isValidUserKey("ctrl+j")).toBe(true);
	expect(isValidUserKey("shift+tab")).toBe(true);
});

test("the key grammar rejects escape, digits, shifted letters, and junk", () => {
	expect(isValidUserKey("escape")).toBe(false);
	expect(isValidUserKey("ctrl+escape")).toBe(false);
	expect(isValidUserKey("shift+escape")).toBe(false);
	expect(isValidUserKey("5")).toBe(false);
	expect(isValidUserKey("shift+j")).toBe(false);
	expect(isValidUserKey("banana")).toBe(false);
	expect(isValidUserKey("[c")).toBe(false);
});

test("an override replaces the full default key list for that action", () => {
	const { keymap, issues } = mergeKeymap(KEYMAP, { "toggle-comments": "O" });
	expect(issues).toEqual([]);
	const action = keymap.find((candidate) => candidate.id === "toggle-comments");
	expect(action?.keys).toEqual(["O"]);
});

test("a freed default key becomes available to another action", () => {
	const { keymap, issues } = mergeKeymap(KEYMAP, {
		"toggle-comments": "O",
		"cycle-path-display": "o",
	});
	expect(issues).toEqual([]);
	expect(keymap.find((a) => a.id === "cycle-path-display")?.keys).toEqual(["o"]);
});

test("an unknown action is dropped with a warning, defaults kept", () => {
	const { keymap, issues } = mergeKeymap(KEYMAP, { "not-a-real-action": "z" });
	expect(issues).toEqual([
		{ entry: "not-a-real-action", reason: 'unknown action "not-a-real-action"' },
	]);
	expect(keymap).toEqual(KEYMAP as KeymapAction[]);
});

test("an invalid key string is dropped, the action keeps its defaults", () => {
	const { keymap, issues } = mergeKeymap(KEYMAP, { "toggle-comments": "escape" });
	expect(issues).toEqual([
		{ entry: "toggle-comments", reason: 'invalid key "escape" for "toggle-comments"' },
	]);
	expect(keymap.find((a) => a.id === "toggle-comments")?.keys).toEqual(["o"]);
});

test("a chord action cannot be rebound", () => {
	const { keymap, issues } = mergeKeymap(KEYMAP, { "previous-page": "p" });
	expect(issues).toEqual([{ entry: "previous-page", reason: '"previous-page" cannot be rebound' }]);
	expect(keymap.find((a) => a.id === "previous-page")?.keys).toEqual(["[c"]);
});

test("a same-context conflict is dropped in favour of the earlier binding", () => {
	// line-up already owns "k" in the page context; claiming it for another page action clashes.
	const { keymap, issues } = mergeKeymap(KEYMAP, { "toggle-sidebar": "k" });
	expect(issues).toEqual([
		{ entry: "toggle-sidebar", reason: '"k" already bound to another action in this context' },
	]);
	expect(keymap.find((a) => a.id === "toggle-sidebar")?.keys).toEqual(["s"]);
});

test("a global override that clashes with a page-context default is dropped", () => {
	// "quit" is global; "j" already belongs to line-up/line-down in the page context.
	const { keymap, issues } = mergeKeymap(KEYMAP, { quit: "j" });
	expect(issues).toEqual([
		{ entry: "quit", reason: '"j" already bound to another action in this context' },
	]);
	expect(keymap.find((a) => a.id === "quit")?.keys).toEqual(["q"]);
});

test("escape cannot be assigned as an override value", () => {
	const { issues } = mergeKeymap(KEYMAP, { "toggle-shortcut-help": "escape" });
	expect(issues[0]?.reason).toContain("invalid key");
});

test("escape is not a configurable action id, so it cannot be unbound either", () => {
	const { keymap, issues } = mergeKeymap(KEYMAP, { escape: "e" });
	expect(issues).toEqual([{ entry: "escape", reason: 'unknown action "escape"' }]);
	expect(keymap).toEqual(KEYMAP as KeymapAction[]);
});

test("a missing file falls back to defaults with no warning", async () => {
	const path = await tmpPath();
	const { keymap, issues } = await loadEffectiveKeymap(path);
	expect(issues).toEqual([]);
	expect(keymap).toEqual(KEYMAP as KeymapAction[]);
});

test("malformed JSON falls back to defaults with a warning", async () => {
	const path = await tmpPath("{ not json");
	const { keymap, issues } = await loadEffectiveKeymap(path);
	expect(keymap).toEqual(KEYMAP as KeymapAction[]);
	expect(issues).toEqual([{ entry: "keybindings.json", reason: "malformed JSON; using defaults" }]);
});

test("JSONC comments parse and a valid override takes effect", async () => {
	const path = await tmpPath(`{
  // remap quit to Q
  "quit": "Q"
}`);
	const { keymap, issues } = await loadEffectiveKeymap(path);
	expect(issues).toEqual([]);
	expect(keymap.find((a) => a.id === "quit")?.keys).toEqual(["Q"]);
});
