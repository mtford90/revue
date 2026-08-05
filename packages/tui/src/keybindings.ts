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

// Values are validated per entry in mergeKeymap rather than in the schema, so a single
// wrongly-typed entry (e.g. `{"quit": 5}`) drops just that entry instead of the whole file.
const KeybindingsOverridesSchema = z.record(z.string(), z.unknown());

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

/** The `[c`/`]c` chord lives outside the registry and dispatches on the raw `[`/`]` keys before anything else runs. */
const RESERVED_CHORD_PREFIXES = new Set(["[", "]"]);

const isReservedDigit = (base: string): boolean => /^[1-9]$/.test(base);

const isBareKey = (base: string): boolean => {
	if (base === "escape" || isReservedDigit(base) || RESERVED_CHORD_PREFIXES.has(base)) return false;
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

/**
 * Some terminals report a shifted keystroke as the literal shifted character (`"G"`, `"{"`); others
 * report the base key with a shift flag (`{name: "g", shift: true}`, which `matchKeymapAction`
 * turns into the `"shift+g"` candidate). The default registry lists both forms for its own shifted
 * bindings (`scroll-bottom: ["G", "shift+g"]`); user overrides get the same alias expansion here so
 * a rebind is equally reliable on either terminal style.
 */
const SHIFT_PUNCTUATION_BASE: Record<string, string> = { "{": "[", "}": "]" };

const shiftAliasFor = (key: string): string | undefined => {
	if (/^[A-Z]$/.test(key)) return `shift+${key.toLowerCase()}`;
	const base = SHIFT_PUNCTUATION_BASE[key];
	return base ? `shift+${base}` : undefined;
};

const expandShiftAliases = (keys: readonly string[]): string[] => {
	const expanded = new Set<string>();
	for (const key of keys) {
		expanded.add(key);
		const alias = shiftAliasFor(key);
		if (alias) expanded.add(alias);
	}
	return [...expanded];
};

export type KeymapIssue = { entry: string; reason: string };

type Candidate = { id: string; rawKeys: string[]; keys: string[] };

/** The two non-chord contexts a key can be claimed in; `global` actions participate in both. */
const CONTEXTS = ["page", "comments"] as const;

/** Validates one override entry against the grammar, independent of any other entry. */
const readCandidate = (
	keymap: readonly KeymapAction[],
	id: string,
	value: unknown,
): { candidate: Candidate } | { issue: KeymapIssue } => {
	const action = keymap.find((candidate) => candidate.id === id);
	if (!action) return { issue: { entry: id, reason: `unknown action "${id}"` } };
	if (action.context === "chord") {
		return { issue: { entry: id, reason: `"${id}" cannot be rebound` } };
	}
	if (typeof value !== "string" && !Array.isArray(value)) {
		return {
			issue: { entry: id, reason: `"${id}" must be a key string or an array of key strings` },
		};
	}
	const rawValues = Array.isArray(value) ? value : [value];
	if (rawValues.some((entry) => typeof entry !== "string")) {
		return { issue: { entry: id, reason: `"${id}" has a non-string key` } };
	}
	const rawKeys = [...new Set(rawValues as string[])];
	if (rawKeys.length === 0) return { issue: { entry: id, reason: `"${id}" has no keys` } };
	const invalidKey = rawKeys.find((key) => !isValidUserKey(key));
	if (invalidKey !== undefined) {
		return { issue: { entry: id, reason: `invalid key "${invalidKey}" for "${id}"` } };
	}
	return { candidate: { id, rawKeys, keys: expandShiftAliases(rawKeys) } };
};

const buildKeyOwners = (
	actions: readonly KeymapAction[],
	context: "page" | "comments",
): Map<string, string[]> => {
	const owners = new Map<string, string[]>();
	for (const action of actions) {
		if (action.context !== context && action.context !== "global") continue;
		for (const key of action.keys) owners.set(key, [...(owners.get(key) ?? []), action.id]);
	}
	return owners;
};

/**
 * Resolves grammar-valid candidates against the registry and each other. Replaces are applied to
 * every candidate at once before conflicts are checked, so a key freed by one override is
 * immediately available to another regardless of which entry appears first in the file — the only
 * remaining source of conflict is a genuine clash that survives every replace.
 */
const resolveConflicts = (
	defaults: readonly KeymapAction[],
	candidates: readonly Candidate[],
): { keymap: KeymapAction[]; issues: KeymapIssue[] } => {
	const order = candidates.map((candidate) => candidate.id);
	const rawById = new Map(candidates.map((candidate) => [candidate.id, candidate.rawKeys]));
	let active = new Map(candidates.map((candidate) => [candidate.id, candidate.keys]));
	const reasons = new Map<string, string>();

	const buildEffective = (action: KeymapAction): KeymapAction => {
		const keys = active.get(action.id);
		if (!keys) return action;
		const raw = rawById.get(action.id) ?? keys;
		return { ...action, keys, displayKeys: keys.length > raw.length ? raw : undefined };
	};

	while (true) {
		const proposed = defaults.map(buildEffective);
		const losers = new Set<string>();
		for (const context of CONTEXTS) {
			for (const [key, ids] of buildKeyOwners(proposed, context)) {
				if (ids.length <= 1) continue;
				const overridden = ids.filter((id) => active.has(id));
				if (overridden.length === 0) continue;
				const untouchedOwner = ids.some((id) => !active.has(id));
				const survivors = untouchedOwner
					? []
					: [[...overridden].sort((a, b) => order.indexOf(a) - order.indexOf(b))[0]];
				for (const id of overridden) {
					if (survivors.includes(id)) continue;
					losers.add(id);
					if (!reasons.has(id)) {
						reasons.set(id, `"${key}" already bound to another action in this context`);
					}
				}
			}
		}
		if (losers.size === 0) {
			return {
				keymap: proposed,
				issues: order
					.filter((id) => reasons.has(id))
					.map((id) => ({ entry: id, reason: reasons.get(id) ?? "" })),
			};
		}
		active = new Map([...active].filter(([id]) => !losers.has(id)));
	}
};

/** Applies user overrides onto the default registry, dropping any entry that would break the grammar or clash with another binding. */
export const mergeKeymap = (
	keymap: readonly KeymapAction[],
	overrides: KeybindingsOverrides,
): { keymap: KeymapAction[]; issues: KeymapIssue[] } => {
	const issues: KeymapIssue[] = [];
	const candidates: Candidate[] = [];

	for (const [id, value] of Object.entries(overrides)) {
		const result = readCandidate(keymap, id, value);
		if ("issue" in result) issues.push(result.issue);
		else candidates.push(result.candidate);
	}

	const resolved = resolveConflicts(keymap, candidates);
	return { keymap: resolved.keymap, issues: [...issues, ...resolved.issues] };
};

/** Reads `~/.revue/keybindings.json`, merges it onto the registry, and reports what was dropped. Never writes the file — it is reviewer-owned. */
export const loadEffectiveKeymap = async (
	path: string,
	keymap: readonly KeymapAction[] = KEYMAP,
): Promise<{ keymap: KeymapAction[]; issues: KeymapIssue[] }> => {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException | undefined)?.code;
		if (code === "ENOENT") return { keymap: [...keymap], issues: [] };
		return {
			keymap: [...keymap],
			issues: [{ entry: "keybindings.json", reason: "could not read the file; using defaults" }],
		};
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
