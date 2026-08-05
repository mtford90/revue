import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expandShiftAliases, isValidUserKey, type KeymapIssue } from "./keybindings.ts";
import { formatKeymapKeys, KEYMAP_SECTION_ORDER, type KeymapAction } from "./keymap.ts";

const COMMENTS_SECTION_TITLE = "Comments";

const sectionTitleFor = (action: KeymapAction): string => action.section ?? COMMENTS_SECTION_TITLE;

const groupBySection = (
	keymap: readonly KeymapAction[],
): { title: string; actions: KeymapAction[] }[] =>
	[...KEYMAP_SECTION_ORDER, COMMENTS_SECTION_TITLE]
		.map((title) => ({
			title,
			actions: keymap.filter((action) => sectionTitleFor(action) === title),
		}))
		.filter((section) => section.actions.length > 0);

/** The subset of an action's keys the grammar accepts as a user override — excludes alias
 * forms (`shift+g`, `shift+[`) the loader re-derives itself via `expandShiftAliases`. */
const matchingKeys = (action: KeymapAction): string[] => action.keys.filter(isValidUserKey);

const sameKeySet = (a: readonly string[], b: readonly string[]): boolean => {
	const expandedA = new Set(expandShiftAliases(a));
	const expandedB = new Set(expandShiftAliases(b));
	return expandedA.size === expandedB.size && [...expandedA].every((key) => expandedB.has(key));
};

const formatActionLine = (
	defaultAction: KeymapAction,
	effectiveAction: KeymapAction | undefined,
) => {
	const defaultDisplay = formatKeymapKeys(matchingKeys(defaultAction));
	const effectiveKeys = effectiveAction?.displayKeys ?? effectiveAction?.keys ?? defaultAction.keys;
	const overridden = Boolean(
		effectiveAction && !sameKeySet(effectiveAction.keys, defaultAction.keys),
	);
	const overrideNote = overridden ? ` (overridden, default: ${defaultDisplay})` : "";
	const chordNote = defaultAction.context === "chord" ? " (fixed, not rebindable)" : "";
	return `  ${defaultAction.id.padEnd(24)} ${formatKeymapKeys(effectiveKeys).padEnd(16)} ${defaultAction.description}${overrideNote}${chordNote}`;
};

/** Lists every registry action grouped by section, marking overridden bindings and reporting validation issues. */
export const formatKeybindingsListing = (
	defaults: readonly KeymapAction[],
	effective: readonly KeymapAction[],
	issues: readonly KeymapIssue[],
): string => {
	const effectiveById = new Map(effective.map((action) => [action.id, action]));
	const sections = groupBySection(defaults).flatMap(({ title, actions }) => [
		`${title}:`,
		...actions.map((action) => formatActionLine(action, effectiveById.get(action.id))),
		"",
	]);
	const issueLines =
		issues.length > 0
			? ["Issues:", ...issues.map((issue) => `  ${issue.entry}: ${issue.reason}`), ""]
			: [];
	return [...sections, ...issueLines].join("\n").trimEnd();
};

const TEMPLATE_HEADER = `// revue keybindings
//
// Override defaults by uncommenting a line below and editing its keys. Each entry
// is "action-id": "key" or "action-id": ["key", "key"] — an override replaces the
// action's full default key list, it does not add to it.
//
// Key grammar:
//   lowercase named keys   up down left right pageup pagedown home end insert
//                          delete backspace return tab space f1-f12
//   ctrl+ prefix           ctrl+a, ctrl+f, ...
//   single-character keys  j, {, ?, ...
//   shifted letters        G (not shift+g)
//   shift+ prefix          only for named/special keys, e.g. shift+tab
//
// Reserved, cannot be bound: escape, [ and ] (chord prefixes), digits 1-9 (direct
// key-change shortcuts). Chord actions (page navigation) cannot be rebound and are
// omitted below.
//
// Invalid or conflicting entries are dropped with a warning; the rest of the file
// still applies. If uncommenting more than one entry, add a comma between them.
// Run \`revue keybindings\` to see the effective bindings and any issues.
`;

/** Generates a fully-commented JSONC starter file from the live registry, so it can never drift. */
export const generateKeybindingsTemplate = (keymap: readonly KeymapAction[]): string => {
	const rebindable = keymap.filter((action) => action.context !== "chord");
	const body = groupBySection(rebindable)
		.map(({ title, actions }) =>
			[
				`  // ${title}`,
				...actions.flatMap((action) => [
					`  // ${action.description}`,
					`  // "${action.id}": ${JSON.stringify(matchingKeys(action))}`,
				]),
			].join("\n"),
		)
		.join("\n\n");
	return `${TEMPLATE_HEADER}\n{\n${body}\n}\n`;
};

export type InitResult = { path: string; wrote: true } | { path: string; wrote: false };

/** Writes the starter keybindings template to `path`, refusing to overwrite an existing file unless `force`. */
export const initKeybindingsFile = (
	path: string,
	keymap: readonly KeymapAction[],
	force: boolean,
): InitResult => {
	if (existsSync(path) && !force) return { path, wrote: false };
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, generateKeybindingsTemplate(keymap), "utf8");
	return { path, wrote: true };
};
