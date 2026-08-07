import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	defaultKeybindingsPath,
	isValidUserKey,
	loadEffectiveKeymap,
	mergeKeymap,
	stripJsonComments,
} from "./keybindings.ts";
import { KEYMAP, type KeymapAction, matchKeymapAction } from "./keymap.ts";

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

test("the key grammar rejects escape, digits, shifted letters, junk, and chord prefixes", () => {
	expect(isValidUserKey("escape")).toBe(false);
	expect(isValidUserKey("ctrl+escape")).toBe(false);
	expect(isValidUserKey("shift+escape")).toBe(false);
	expect(isValidUserKey("5")).toBe(false);
	expect(isValidUserKey("shift+j")).toBe(false);
	expect(isValidUserKey("banana")).toBe(false);
	expect(isValidUserKey("[c")).toBe(false);
	expect(isValidUserKey("[")).toBe(false);
	expect(isValidUserKey("]")).toBe(false);
});

test("an override replaces the full default key list for that action", () => {
	const { keymap, issues } = mergeKeymap(KEYMAP, { "toggle-comments": "O" });
	expect(issues).toEqual([]);
	const action = keymap.find((candidate) => candidate.id === "toggle-comments");
	// "shift+o" is added so the binding also matches terminals that report Shift+O as
	// {name: "o", shift: true} rather than {name: "O"} — mirroring the registry's own
	// dual-alias idiom (e.g. scroll-bottom: ["G", "shift+g"]).
	expect(action?.keys).toEqual(["O", "shift+o"]);
	expect(action?.displayKeys).toEqual(["O"]);
});

test("a freed default key becomes available to another action", () => {
	const { keymap, issues } = mergeKeymap(KEYMAP, {
		"toggle-comments": "O",
		"cycle-path-display": "o",
	});
	expect(issues).toEqual([]);
	expect(keymap.find((a) => a.id === "cycle-path-display")?.keys).toEqual(["o"]);
});

test("freeing a default key works regardless of which entry comes first in the file", () => {
	const { keymap, issues } = mergeKeymap(KEYMAP, {
		"cycle-path-display": "o",
		"toggle-comments": "O",
	});
	expect(issues).toEqual([]);
	expect(keymap.find((a) => a.id === "cycle-path-display")?.keys).toEqual(["o"]);
	expect(keymap.find((a) => a.id === "toggle-comments")?.keys).toEqual(["O", "shift+o"]);
});

test("duplicate keys within one override entry are deduplicated", () => {
	const { keymap, issues } = mergeKeymap(KEYMAP, { quit: ["z", "z"] });
	expect(issues).toEqual([]);
	expect(keymap.find((a) => a.id === "quit")?.keys).toEqual(["z"]);
});

test("a wrongly-typed value drops just that entry, not the whole file", () => {
	const { keymap, issues } = mergeKeymap(KEYMAP, { quit: 5, "toggle-comments": "O" });
	expect(issues).toEqual([
		{ entry: "quit", reason: '"quit" must be a key string or an array of key strings' },
	]);
	expect(keymap.find((a) => a.id === "quit")?.keys).toEqual(["q"]);
	expect(keymap.find((a) => a.id === "toggle-comments")?.keys).toEqual(["O", "shift+o"]);
});

test("a non-string entry inside an array is dropped with a reason", () => {
	const { issues } = mergeKeymap(KEYMAP, { quit: ["z", 5] });
	expect(issues).toEqual([{ entry: "quit", reason: '"quit" has a non-string key' }]);
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

test("two overrides claiming the same key: the earlier entry in the file wins", () => {
	const { keymap, issues } = mergeKeymap(KEYMAP, { quit: "z", "toggle-comments": "z" });
	expect(issues).toEqual([
		{ entry: "toggle-comments", reason: '"z" already bound to another action in this context' },
	]);
	expect(keymap.find((a) => a.id === "quit")?.keys).toEqual(["z"]);
	expect(keymap.find((a) => a.id === "toggle-comments")?.keys).toEqual(["o"]);
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

test("an unreadable existing file warns rather than silently using defaults", async () => {
	// A directory at the expected path can't be read as a file (EISDIR), unlike a genuinely
	// missing file (ENOENT) — the reviewer has a keybindings.json-shaped thing that isn't honoured.
	const path = await tmpPath();
	await mkdir(path);
	const { keymap, issues } = await loadEffectiveKeymap(path);
	expect(keymap).toEqual(KEYMAP as KeymapAction[]);
	expect(issues).toEqual([
		{ entry: "keybindings.json", reason: "could not read the file; using defaults" },
	]);
});

test("JSONC comments parse and a valid override takes effect", async () => {
	const path = await tmpPath(`{
  // remap quit to Q
  "quit": "Q"
}`);
	const { keymap, issues } = await loadEffectiveKeymap(path);
	expect(issues).toEqual([]);
	expect(keymap.find((a) => a.id === "quit")?.keys).toEqual(["Q", "shift+q"]);
});

test("an uppercase override matches both terminal reporting styles", () => {
	const { keymap } = mergeKeymap(KEYMAP, { quit: "Q" });
	expect(matchKeymapAction("page", { name: "Q" }, keymap)).toBe("quit");
	expect(matchKeymapAction("page", { name: "q", shift: true }, keymap)).toBe("quit");
});

test("an uppercase override doesn't leak onto whatever now owns the freed lowercase key", () => {
	const { keymap, issues } = mergeKeymap(KEYMAP, {
		"toggle-comments": "O",
		"cycle-path-display": "o",
	});
	expect(issues).toEqual([]);
	expect(matchKeymapAction("page", { name: "O" }, keymap)).toBe("toggle-comments");
	expect(matchKeymapAction("page", { name: "o", shift: true }, keymap)).toBe("toggle-comments");
	expect(matchKeymapAction("page", { name: "o" }, keymap)).toBe("cycle-path-display");
});

test("a ctrl override matches exactly and doesn't also fire on the bare key", () => {
	const { keymap, issues } = mergeKeymap(KEYMAP, { "toggle-sidebar": "ctrl+j" });
	expect(issues).toEqual([]);
	expect(matchKeymapAction("page", { name: "j", ctrl: true }, keymap)).toBe("toggle-sidebar");
	expect(matchKeymapAction("page", { name: "j" }, keymap)).toBe("line-down");
});

test("the default ctrl fallback keeps working alongside user overrides elsewhere", () => {
	const { keymap, issues } = mergeKeymap(KEYMAP, { quit: "z" });
	expect(issues).toEqual([]);
	// ctrl+d/ctrl+u aren't listed keys for half-page-down/up; they reach them by falling back
	// from the unmatched "ctrl+d"/"ctrl+u" candidate to the bare "d"/"u" candidate.
	expect(matchKeymapAction("page", { name: "d", ctrl: true }, keymap)).toBe("half-page-down");
	expect(matchKeymapAction("page", { name: "u", ctrl: true }, keymap)).toBe("half-page-up");
});

test("copying is one action, so narration and diff text share the one key", () => {
	const copying = KEYMAP.filter((action) => action.section === "Copying");
	expect(copying.map((action) => action.id)).toEqual(["copy-selection"]);
	expect(copying[0]?.keys).toEqual(["y"]);
});
