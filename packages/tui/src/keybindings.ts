import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { KEYMAP, type KeymapAction } from "./keymap.ts";

export const defaultKeybindingsPath = (): string => join(homedir(), ".revue", "keybindings.json");

/** Strips `//` and `/* *\/` comments outside of string literals, leaving valid JSON. */
export const stripJsonComments = (text: string): string => {
	let result = "";
	let inString = false;
	let index = 0;
	while (index < text.length) {
		const char = text[index];
		const next = text[index + 1];
		if (inString) {
			result += char;
			if (char === "\\") {
				result += next ?? "";
				index += 2;
				continue;
			}
			if (char === '"') inString = false;
			index += 1;
			continue;
		}
		if (char === '"') {
			inString = true;
			result += char;
			index += 1;
			continue;
		}
		if (char === "/" && next === "/") {
			while (index < text.length && text[index] !== "\n") index += 1;
			continue;
		}
		if (char === "/" && next === "*") {
			index += 2;
			while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
				if (text[index] === "\n") result += "\n";
				index += 1;
			}
			index += 2;
			continue;
		}
		result += char;
		index += 1;
	}
	return result;
};

const KeybindingsOverridesSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]));

export type KeybindingsOverrides = z.infer<typeof KeybindingsOverridesSchema>;

/** Every raw key name a reviewer can bind, keyed lowercase (escape is reserved and excluded). */
const NAMED_KEYS = new Set([
	"up",
	"down",
	"left",
	"right",
	"pageup",
	"pagedown",
	"home",
	"end",
	"insert",
	"delete",
	"backspace",
	"return",
	"tab",
	"space",
	"f1",
	"f2",
	"f3",
	"f4",
	"f5",
	"f6",
	"f7",
	"f8",
	"f9",
	"f10",
	"f11",
	"f12",
]);

const isReservedDigit = (base: string): boolean => /^[1-9]$/.test(base);

const isBareKey = (base: string): boolean => {
	if (base === "escape" || isReservedDigit(base)) return false;
	if (NAMED_KEYS.has(base)) return true;
	return base.length === 1 && !/\s/.test(base);
};

/** The key grammar: lowercase named keys, `ctrl+`/`shift+` prefixes, and single-character literals. */
export const isValidUserKey = (key: string): boolean => {
	if (key === "escape") return false;
	if (key.startsWith("ctrl+")) {
		const base = key.slice("ctrl+".length);
		if (base === "escape" || isReservedDigit(base)) return false;
		return /^[a-z]$/.test(base) || NAMED_KEYS.has(base);
	}
	if (key.startsWith("shift+")) {
		const base = key.slice("shift+".length);
		return base !== "escape" && NAMED_KEYS.has(base);
	}
	return isBareKey(key);
};

export type KeymapIssue = { entry: string; reason: string };

const contextsFor = (context: KeymapAction["context"]): readonly ("page" | "comments")[] => {
	if (context === "global") return ["page", "comments"];
	if (context === "page" || context === "comments") return [context];
	return [];
};

const claimsKey = (action: KeymapAction, context: "page" | "comments", key: string): boolean =>
	(action.context === context || action.context === "global") && action.keys.includes(key);

/** Applies user overrides onto the default registry, dropping any entry that would break the grammar or clash with another binding. */
export const mergeKeymap = (
	keymap: readonly KeymapAction[],
	overrides: KeybindingsOverrides,
): { keymap: KeymapAction[]; issues: KeymapIssue[] } => {
	const issues: KeymapIssue[] = [];
	const merged = keymap.map((action) => ({ ...action }));

	for (const [id, value] of Object.entries(overrides)) {
		const action = merged.find((candidate) => candidate.id === id);
		if (!action) {
			issues.push({ entry: id, reason: `unknown action "${id}"` });
			continue;
		}
		if (action.context === "chord") {
			issues.push({ entry: id, reason: `"${id}" cannot be rebound` });
			continue;
		}
		const keys = Array.isArray(value) ? value : [value];
		if (keys.length === 0) {
			issues.push({ entry: id, reason: `"${id}" has no keys` });
			continue;
		}
		const invalidKey = keys.find((key) => !isValidUserKey(key));
		if (invalidKey !== undefined) {
			issues.push({ entry: id, reason: `invalid key "${invalidKey}" for "${id}"` });
			continue;
		}
		const clashingKey = keys.find((key) =>
			contextsFor(action.context).some((context) =>
				merged.some((other) => other.id !== id && claimsKey(other, context, key)),
			),
		);
		if (clashingKey !== undefined) {
			issues.push({
				entry: id,
				reason: `"${clashingKey}" already bound to another action in this context`,
			});
			continue;
		}
		action.keys = keys;
		action.displayKeys = undefined;
	}

	return { keymap: merged, issues };
};

/** Reads `~/.revue/keybindings.json`, merges it onto the registry, and reports what was dropped. Never writes the file — it is reviewer-owned. */
export const loadEffectiveKeymap = async (
	path: string,
	keymap: readonly KeymapAction[] = KEYMAP,
): Promise<{ keymap: KeymapAction[]; issues: KeymapIssue[] }> => {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		return { keymap: [...keymap], issues: [] };
	}
	let overrides: KeybindingsOverrides;
	try {
		const parsed = KeybindingsOverridesSchema.safeParse(JSON.parse(stripJsonComments(raw)));
		if (!parsed.success) throw parsed.error;
		overrides = parsed.data;
	} catch {
		return {
			keymap: [...keymap],
			issues: [{ entry: "keybindings.json", reason: "malformed JSON; using defaults" }],
		};
	}
	return mergeKeymap(keymap, overrides);
};
