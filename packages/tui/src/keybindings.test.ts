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
import {
	footerHints,
	KEYMAP,
	type KeymapAction,
	keymapGroups,
	matchKeymapAction,
	searchKeymap,
} from "./keymap.ts";

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

test("the bracket keys are ordinary bindable keys now the chord is retired", () => {
	expect(isValidUserKey("[")).toBe(true);
	expect(isValidUserKey("]")).toBe(true);
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
	expect(keymap.find((a) => a.id === "quit")?.keys).toEqual(["q", "Q", "shift+q"]);
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

test("page navigation is rebindable now it is an ordinary global action", () => {
	const { keymap, issues } = mergeKeymap(KEYMAP, { "previous-page": "[" });
	expect(issues).toEqual([]);
	expect(keymap.find((a) => a.id === "previous-page")?.keys).toEqual(["["]);
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
	expect(keymap.find((a) => a.id === "quit")?.keys).toEqual(["q", "Q", "shift+q"]);
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
	expect(copying[0]?.keys).toEqual(["y", "ctrl+insert"]);
});

test("no key is claimed twice within a context", () => {
	for (const context of ["page", "comments"] as const) {
		const owners = new Map<string, string[]>();
		for (const action of KEYMAP) {
			if (action.context !== context && action.context !== "global") continue;
			for (const key of action.keys) owners.set(key, [...(owners.get(key) ?? []), action.id]);
		}
		const clashes = [...owners].filter(([, ids]) => ids.length > 1);
		expect(clashes).toEqual([]);
	}
});

test("every declared key resolves back to the action that declared it", () => {
	const asEvent = (key: string) => {
		if (key.startsWith("ctrl+")) return { name: key.slice("ctrl+".length), ctrl: true };
		if (key.startsWith("shift+")) return { name: key.slice("shift+".length), shift: true };
		return { name: key };
	};
	for (const context of ["page", "comments"] as const) {
		for (const action of KEYMAP) {
			if (action.context !== context && action.context !== "global") continue;
			for (const key of action.keys) {
				expect(matchKeymapAction(context, asEvent(key))).toBe(action.id);
			}
		}
	}
});

test("the search keys stay unbound so they are not quietly spent", () => {
	for (const context of ["page", "comments"] as const) {
		expect(matchKeymapAction(context, { name: "/" })).toBeUndefined();
		expect(matchKeymapAction(context, { name: "n" })).toBeUndefined();
		expect(matchKeymapAction(context, { name: "n", shift: true })).toBeUndefined();
	}
});

test("the bracket keys stay unbound now the chapter chord is retired", () => {
	// Retiring the chord frees [ and ]; leaving them unbound is the decision that makes
	// a stray "]c" merely collapse files rather than do something worse.
	for (const context of ["page", "comments"] as const) {
		expect(matchKeymapAction(context, { name: "[" })).toBeUndefined();
		expect(matchKeymapAction(context, { name: "]" })).toBeUndefined();
	}
});

test("shifted letters match without the registry spelling out the alias", () => {
	// The §1 bug: comments-last declared only "G", so Shift-G fell through to comments-first.
	expect(matchKeymapAction("comments", { name: "g", shift: true })).toBe("comments-last");
	expect(matchKeymapAction("comments", { name: "g" })).toBe("comments-first");
	expect(matchKeymapAction("page", { name: "g", shift: true })).toBe("scroll-bottom");
	expect(matchKeymapAction("page", { name: "j", shift: true })).toBe("next-file");
	expect(matchKeymapAction("page", { name: "k", shift: true })).toBe("previous-file");
});

test("page navigation is global, so it resolves on the comments surface too", () => {
	for (const context of ["page", "comments"] as const) {
		expect(matchKeymapAction(context, { name: "," })).toBe("previous-page");
		expect(matchKeymapAction(context, { name: "." })).toBe("next-page");
	}
});

test("every action reaches the keys surface, on one side of the split or the other", () => {
	// A missing section used to mean an action was silently invisible, which is how the Comments
	// surface ended up documenting none of its own keys.
	for (const surface of ["page", "comments"] as const) {
		const listed = keymapGroups(surface).flatMap((group) => group.rows.map((row) => row.id));
		expect(new Set(listed).size).toBe(listed.length);
		expect(new Set(listed)).toEqual(new Set(KEYMAP.map((action) => action.id)));
	}
});

const keyEvent = (key: string) =>
	key.startsWith("ctrl+")
		? { name: key.slice(5), ctrl: true }
		: key.startsWith("shift+")
			? { name: key.slice(6), shift: true }
			: { name: key };

test("Here means the key fires on this surface and Elsewhere means it does not", () => {
	// The split is the whole point of the surface, so it is checked against the matcher rather
	// than against the context field it was derived from.
	for (const surface of ["page", "comments"] as const) {
		for (const group of keymapGroups(surface)) {
			for (const row of group.rows) {
				const action = KEYMAP.find((candidate) => candidate.id === row.id);
				const fires = (action?.keys ?? []).some(
					(key) => matchKeymapAction(surface, keyEvent(key)) === row.id,
				);
				expect({ id: row.id, surface, fires }).toEqual({
					id: row.id,
					surface,
					fires: group.scope === "here",
				});
			}
		}
	}
});

test("the filter matches keys, descriptions and ids, and ranks what fires here first", () => {
	expect(searchKeymap("page", "quit").map((match) => match.id)).toEqual(["quit"]);
	expect(searchKeymap("page", "").length).toBe(0);

	// `j` is line-down here and comments-next elsewhere; the one that fires sorts first.
	const [first] = searchKeymap("comments", "j");
	expect(first?.id).toBe("comments-next");
	expect(first?.scope).toBe("here");

	expect(searchKeymap("page", "cycle-path").map((match) => match.id)).toEqual([
		"cycle-path-display",
	]);
	expect(searchKeymap("page", "no-such-thing")).toEqual([]);
});

test("the footer names each surface's own keys, and follows a rebind", () => {
	expect(footerHints("page")).toContainEqual({ keys: "j/k", label: "move" });
	expect(footerHints("comments")).toContainEqual({ keys: "Enter", label: "jump" });
	expect(footerHints("comments").map((hint) => hint.label)).not.toContain("comments");

	const { keymap } = mergeKeymap(KEYMAP, { "toggle-comments": "C" });
	expect(footerHints("page", keymap)).toContainEqual({ keys: "C", label: "comments" });
});
