/**
 * The single source of truth for context-level keyboard shortcuts: the
 * keyboard handler, keys surface and menu hints all derive their key labels
 * from here rather than hardcoding them independently.
 *
 * Out of scope by design: digit jumps 1-9, escape (the reserved dismiss/quit
 * hatch) and modal-internal navigation/text input (confirm-delete, the
 * pointer context menu, menu-bar arrow navigation, keys-surface scrolling
 * the theme picker and thread-draft composition). Those stay hardcoded in
 * the keyboard handler.
 *
 * Every derivation below takes the effective keymap as an (optional,
 * defaulted) argument rather than closing over a module-level constant, so a
 * future loader that merges user overrides can pass its own array through
 * without reworking these call sites.
 */

export type KeymapContext = "global" | "page" | "comments";

export type KeymapSection =
	| "Scrolling"
	| "Navigation"
	| "Files"
	| "Review"
	| "Copying"
	| "Views"
	| "Menus";

type KeymapActionDef<Id extends string> = {
	id: Id;
	description: string;
	/** Default keys in the grammar: lowercase named keys, `ctrl+`/`shift+` prefixes, uppercase literals for shifted characters. Shifted literals gain their `shift+` alias automatically. */
	keys: readonly string[];
	/** Keys shown in help/menu text; defaults to `keys`. Use to hold back aliases that would clutter the surface — a terminal-reporting duplicate (`G` and `shift+g`), or an alias serving a narrower audience than the overlay is written for. */
	displayKeys?: readonly string[];
	context: KeymapContext;
	/** Groups the action on the keys surface. Actions without a section are not shown there. */
	section?: KeymapSection;
};

const KEYMAP_DEF = [
	{
		id: "open-menu",
		description: "Open the menu bar (File, Navigate, View, Help)",
		keys: ["f10", "f9"],
		context: "global",
		section: "Menus",
	},
	{
		id: "toggle-shortcut-help",
		description: "Show or hide the shortcuts list",
		keys: ["?", "f1"],
		context: "global",
		section: "Menus",
	},
	{
		id: "open-theme-picker",
		description: "Open the theme picker",
		keys: ["t"],
		context: "global",
		section: "Menus",
	},
	{
		id: "quit",
		description: "Quit (Esc also works)",
		keys: ["q", "Q"],
		displayKeys: ["q"],
		context: "global",
		section: "Menus",
	},
	{
		id: "reload",
		description: "Reload: re-prep the same scope and reopen the run",
		keys: ["ctrl+r", "f5"],
		context: "global",
		section: "Menus",
	},
	{
		id: "toggle-comments",
		description: "Comments: every thread in one list · enter jumps to it",
		keys: ["o"],
		context: "global",
		section: "Navigation",
	},
	{
		id: "previous-key-change",
		description: "Focus the previous key change",
		keys: ["{", "shift+f7"],
		context: "global",
		section: "Review",
	},
	{
		id: "next-key-change",
		description: "Focus the next key change",
		keys: ["}", "f7"],
		context: "global",
		section: "Review",
	},
	{
		id: "previous-page",
		description: "Previous page (prologue is page one)",
		keys: [","],
		context: "global",
		section: "Navigation",
	},
	{
		id: "next-page",
		description: "Next page (prologue is page one)",
		keys: ["."],
		context: "global",
		section: "Navigation",
	},
	{
		id: "line-up",
		description: "Scroll up one line",
		keys: ["k", "up", "ctrl+p", "ctrl+k"],
		displayKeys: ["k", "up"],
		context: "page",
		section: "Scrolling",
	},
	{
		id: "line-down",
		description: "Scroll down one line",
		keys: ["j", "down", "ctrl+n", "ctrl+e"],
		displayKeys: ["j", "down"],
		context: "page",
		section: "Scrolling",
	},
	{
		id: "half-page-up",
		description: "Scroll up half a page",
		keys: ["u", "ctrl+u"],
		context: "page",
		section: "Scrolling",
	},
	{
		id: "half-page-down",
		description: "Scroll down half a page",
		keys: ["d", "ctrl+d"],
		context: "page",
		section: "Scrolling",
	},
	{
		id: "page-up",
		description: "Scroll up a page",
		keys: ["pageup", "b", "ctrl+b"],
		displayKeys: ["b", "pageup"],
		context: "page",
		section: "Scrolling",
	},
	{
		id: "page-down",
		description: "Scroll down a page",
		keys: ["pagedown", "space", "ctrl+f"],
		displayKeys: ["space", "pagedown"],
		context: "page",
		section: "Scrolling",
	},
	{
		id: "scroll-top",
		description: "Scroll to the top",
		keys: ["g", "home", "<"],
		displayKeys: ["g", "home"],
		context: "page",
		section: "Scrolling",
	},
	{
		id: "scroll-bottom",
		description: "Scroll to the bottom",
		keys: ["G", "end", ">"],
		displayKeys: ["G", "end"],
		context: "page",
		section: "Scrolling",
	},
	{
		id: "next-unreviewed",
		description: "Jump to the next unreviewed chapter",
		keys: ["a"],
		context: "page",
		section: "Navigation",
	},
	{
		id: "toggle-all-files",
		description: "Diff: the whole diff without the narrative",
		keys: ["w"],
		context: "page",
		section: "Navigation",
	},
	{
		id: "next-file",
		description: "Focus the next file",
		keys: ["tab", "J"],
		context: "page",
		section: "Files",
	},
	{
		id: "previous-file",
		description: "Focus the previous file",
		keys: ["shift+tab", "K"],
		context: "page",
		section: "Files",
	},
	{
		id: "toggle-file-diff",
		description: "Toggle the focused file's diff",
		keys: ["return"],
		context: "page",
		section: "Files",
	},
	{
		id: "collapse-files",
		description: "Collapse all files",
		keys: ["c"],
		context: "page",
		section: "Files",
	},
	{
		id: "expand-files",
		description: "Expand all files",
		keys: ["e"],
		context: "page",
		section: "Files",
	},
	{
		id: "toggle-chapter-review",
		description: "Toggle the chapter reviewed",
		keys: ["x"],
		context: "page",
		section: "Review",
	},
	{
		id: "toggle-file-review",
		description: "Toggle the focused file reviewed",
		keys: ["f", "v"],
		context: "page",
		section: "Review",
	},
	{
		id: "toggle-key-change",
		description: "Toggle the focused key change",
		keys: ["r"],
		context: "page",
		section: "Review",
	},
	{
		id: "copy-selection",
		description: "Copy the highlighted selection",
		keys: ["y", "ctrl+insert"],
		displayKeys: ["y"],
		context: "page",
		section: "Copying",
	},
	{
		id: "toggle-sidebar",
		description: "Show or hide the sidebar; its narrative stacks above the diff",
		keys: ["s"],
		context: "page",
		section: "Views",
	},
	{
		id: "cycle-path-display",
		description: "Cycle path display: smart, tree, full",
		keys: ["p"],
		context: "page",
		section: "Views",
	},
	{
		id: "comments-select-files",
		description: "Switch to the Diff surface",
		keys: ["w"],
		context: "comments",
		section: "Navigation",
	},
	{
		id: "comments-previous",
		description: "Select the previous thread",
		keys: ["k", "up", "ctrl+p", "ctrl+k"],
		displayKeys: ["k", "up"],
		context: "comments",
		section: "Navigation",
	},
	{
		id: "comments-next",
		description: "Select the next thread",
		keys: ["j", "down", "ctrl+n", "ctrl+e"],
		displayKeys: ["j", "down"],
		context: "comments",
		section: "Navigation",
	},
	{
		id: "comments-first",
		description: "Select the first thread",
		keys: ["g", "home", "<"],
		displayKeys: ["g", "home"],
		context: "comments",
		section: "Navigation",
	},
	{
		id: "comments-last",
		description: "Select the last thread",
		keys: ["G", "end", ">"],
		displayKeys: ["G", "end"],
		context: "comments",
		section: "Navigation",
	},
	{
		id: "jump-to-thread",
		description: "Jump to the selected thread",
		keys: ["return", "right", "l"],
		displayKeys: ["return", "right"],
		context: "comments",
		section: "Navigation",
	},
] as const satisfies readonly KeymapActionDef<string>[];

export type KeymapActionId = (typeof KEYMAP_DEF)[number]["id"];

export type KeymapAction = KeymapActionDef<KeymapActionId>;

/** Shifted punctuation whose base key a terminal reports alongside the shift flag. */
const SHIFT_PUNCTUATION_BASE: Record<string, string> = { "{": "[", "}": "]" };

const shiftAliasFor = (key: string): string | undefined => {
	if (/^[A-Z]$/.test(key)) return `shift+${key.toLowerCase()}`;
	const base = SHIFT_PUNCTUATION_BASE[key];
	return base ? `shift+${base}` : undefined;
};

/**
 * Some terminals report a shifted keystroke as the literal shifted character (`"G"`, `"{"`); others
 * report the base key with a shift flag (`{name: "g", shift: true}`, which `matchKeymapAction`
 * turns into the `"shift+g"` candidate). Both forms are needed for a binding to be reliable
 * everywhere, so they are derived rather than left to whoever writes the entry.
 */
export const expandShiftAliases = (keys: readonly string[]): string[] => {
	const expanded = new Set<string>();
	for (const key of keys) {
		expanded.add(key);
		const alias = shiftAliasFor(key);
		if (alias) expanded.add(alias);
	}
	return [...expanded];
};

/** Adds the derived shift aliases, keeping the authored list as `displayKeys` so the overlay shows each keystroke once. */
const expandAction = (action: KeymapAction): KeymapAction => {
	const keys = expandShiftAliases(action.keys);
	if (keys.length === action.keys.length) return action;
	return { ...action, keys, displayKeys: action.displayKeys ?? action.keys };
};

export const KEYMAP: readonly KeymapAction[] = KEYMAP_DEF.map(expandAction);

const stripModifier = (key: string) => key.replace(/^(ctrl|shift)\+/, "");

/** `preventDefault`/`stopPropagation` gate: every raw key name the app owns, plus the fixed keys outside the registry. */
export const deriveAppKeys = (keymap: readonly KeymapAction[] = KEYMAP): Set<string> =>
	new Set([...keymap.flatMap((action) => action.keys.map(stripModifier)), "escape"]);

const keymapActionsForContext = (context: KeymapContext, keymap: readonly KeymapAction[]) =>
	keymap.filter((action) => action.context === context || action.context === "global");

const keyCandidates = ({
	name,
	ctrl,
	shift,
}: {
	name: string;
	ctrl?: boolean;
	shift?: boolean;
}) => {
	if (ctrl) return [`ctrl+${name}`, name];
	if (shift) return [`shift+${name}`, name];
	return [name];
};

/** Resolves a raw key event to the action ID it triggers in the given context, if any. */
export const matchKeymapAction = (
	context: KeymapContext,
	key: { name: string; ctrl?: boolean; shift?: boolean },
	keymap: readonly KeymapAction[] = KEYMAP,
): KeymapActionId | undefined => {
	if (!key.name) return undefined;
	const actions = keymapActionsForContext(context, keymap);
	const candidates = keyCandidates(key);
	for (const candidate of candidates) {
		const match = actions.find((action) => action.keys.includes(candidate));
		if (match) return match.id;
	}
	return undefined;
};

const KEY_LABELS: Record<string, string> = {
	up: "↑",
	down: "↓",
	right: "→",
	pageup: "PgUp",
	pagedown: "PgDn",
	home: "Home",
	end: "End",
	insert: "Ins",
	return: "Enter",
	space: "Space",
	escape: "Esc",
	tab: "Tab",
	f1: "F1",
	f5: "F5",
	f7: "F7",
	f9: "F9",
	f10: "F10",
};

export const formatKeymapKey = (key: string): string => {
	if (key.startsWith("ctrl+")) return `Ctrl-${formatKeymapKey(key.slice("ctrl+".length))}`;
	if (key.startsWith("shift+")) return `Shift-${formatKeymapKey(key.slice("shift+".length))}`;
	return KEY_LABELS[key] ?? key;
};

export const formatKeymapKeys = (keys: readonly string[]) => keys.map(formatKeymapKey).join("/");

/** The first default key for an action, for compact display such as menu hints. */
export const keymapHint = (
	id: KeymapActionId,
	keymap: readonly KeymapAction[] = KEYMAP,
): string | undefined => keymap.find((action) => action.id === id)?.keys[0];

export const KEYMAP_SECTION_ORDER: KeymapSection[] = [
	"Scrolling",
	"Navigation",
	"Files",
	"Review",
	"Copying",
	"Views",
	"Menus",
];

/**
 * Non-keyboard advisory notes that belong alongside a section but aren't registry actions. They
 * carry a context for the same reason actions do: a note about the line-number gutter is a lie on
 * a surface that has no gutter.
 */
const KEYMAP_NOTES: readonly { section: KeymapSection; context: KeymapContext; text: string }[] = [
	{
		section: "Navigation",
		context: "page",
		text: "pointer: the strip under the menu bar, or the sidebar index",
	},
	{
		section: "Files",
		context: "page",
		text: "click a ⋯ band to reveal unchanged lines around a hunk",
	},
	{
		section: "Review",
		context: "page",
		text: "1-9 direct · pointer: click/drag the line-number gutter to start a thread",
	},
	{ section: "Copying", context: "page", text: "drag over code to select it" },
	{
		section: "Copying",
		context: "page",
		text: "right-click a line for copy text, copy path, copy link, comment",
	},
	{
		section: "Copying",
		context: "page",
		text: "ctrl-y path:line · ctrl-g GitHub link, while a thread is open",
	},
	{ section: "Copying", context: "page", text: "links need a GitHub remote and a committed side" },
	{ section: "Views", context: "global", text: "F10 → View toggles Patch / read-only Semantic" },
	{
		section: "Views",
		context: "global",
		text: "F10 → View sets diff layout: auto, split or stacked",
	},
	{
		section: "Views",
		context: "global",
		text: "key-change anchors work in both views; Semantic remains read-only",
	},
	{
		section: "Menus",
		context: "global",
		text: "every alias, including the ones hidden here: revue keybindings",
	},
];

/** The surfaces a reviewer can actually be on; `global` is a property of an action, never a place. */
export type KeymapSurface = Exclude<KeymapContext, "global">;

export const KEYMAP_SURFACE_LABELS: Record<KeymapSurface, string> = {
	page: "Narrative & diff",
	comments: "Comments",
};

/** Keyed by where you are: the action that carries you off it, for the `Elsewhere` heading. */
export const KEYMAP_SURFACE_ROUTES: Record<KeymapSurface, KeymapActionId> = {
	page: "toggle-comments",
	comments: "comments-select-files",
};

export type KeymapRow = {
	id: KeymapActionId;
	/** Formatted key labels, the primary first. */
	keys: string[];
	description: string;
};

export type KeymapScope = "here" | "elsewhere";

export type KeymapGroup = {
	scope: KeymapScope;
	title: KeymapSection;
	rows: KeymapRow[];
	notes: string[];
};

/** Global actions fire on every surface, so they belong wherever the reviewer currently is. */
const scopeOf = (context: KeymapContext, here: KeymapSurface): KeymapScope =>
	context === "global" || context === here ? "here" : "elsewhere";

const toRow = (action: KeymapAction): KeymapRow => ({
	id: action.id,
	keys: (action.displayKeys ?? action.keys).map(formatKeymapKey),
	description: action.description,
});

/** The help surface's list: every action, grouped by section, split into what fires here and what doesn't. */
export const keymapGroups = (
	here: KeymapSurface,
	keymap: readonly KeymapAction[] = KEYMAP,
): KeymapGroup[] =>
	(["here", "elsewhere"] as const).flatMap((scope) =>
		KEYMAP_SECTION_ORDER.map((title) => ({
			scope,
			title,
			rows: keymap
				.filter((action) => action.section === title && scopeOf(action.context, here) === scope)
				.map(toRow),
			notes: KEYMAP_NOTES.filter(
				(note) => note.section === title && scopeOf(note.context, here) === scope,
			).map((note) => note.text),
		})).filter((group) => group.rows.length > 0 || group.notes.length > 0),
	);

export type KeymapMatch = KeymapRow & { scope: KeymapScope; section: KeymapSection };

/** Lower sorts first: an exact key beats a key prefix beats the description beats the id, and here beats elsewhere. */
const matchScore = (row: KeymapMatch, query: string): number | undefined => {
	const keys = row.keys.map((key) => key.toLowerCase());
	const elsewhere = row.scope === "elsewhere" ? 10 : 0;
	if (keys.includes(query)) return elsewhere;
	if (keys.some((key) => key.startsWith(query))) return elsewhere + 1;
	const description = row.description.toLowerCase();
	if (description.startsWith(query)) return elsewhere + 2;
	if (description.includes(query)) return elsewhere + 3;
	if (row.id.includes(query)) return elsewhere + 4;
	return undefined;
};

/** The filtered flat list: groups collapse, so each row carries the section and scope it came from. */
export const searchKeymap = (
	here: KeymapSurface,
	query: string,
	keymap: readonly KeymapAction[] = KEYMAP,
): KeymapMatch[] => {
	const needle = query.trim().toLowerCase();
	if (!needle) return [];
	return keymapGroups(here, keymap)
		.flatMap((group) =>
			group.rows.map((row) => ({ ...row, scope: group.scope, section: group.title })),
		)
		.flatMap((row) => {
			const score = matchScore(row, needle);
			return score === undefined ? [] : [{ row, score }];
		})
		.sort((a, b) => a.score - b.score)
		.map(({ row }) => row);
};

/**
 * The handful of actions the status bar names. Curated rather than ranked: the bar has room for a
 * few, and an action's description is written for the help surface, not for a one-line strip.
 */
const FOOTER_HINTS: readonly {
	context: KeymapSurface;
	ids: readonly KeymapActionId[];
	label: string;
}[] = [
	{ context: "page", ids: ["line-down", "line-up"], label: "move" },
	{ context: "page", ids: ["toggle-file-diff"], label: "open" },
	{ context: "page", ids: ["toggle-chapter-review"], label: "reviewed" },
	{ context: "page", ids: ["next-page"], label: "page" },
	{ context: "page", ids: ["toggle-comments"], label: "comments" },
	{ context: "comments", ids: ["comments-next", "comments-previous"], label: "move" },
	{ context: "comments", ids: ["jump-to-thread"], label: "jump" },
	{ context: "comments", ids: ["comments-select-files"], label: "files" },
];

/** Status-bar hints for a surface, most useful first. Keys come from the keymap so a rebind shows. */
export const footerHints = (
	context: KeymapSurface,
	keymap: readonly KeymapAction[] = KEYMAP,
): { keys: string; label: string }[] =>
	FOOTER_HINTS.filter((hint) => hint.context === context).flatMap((hint) => {
		const keys = hint.ids
			.flatMap((id) => {
				const key = keymapHint(id, keymap);
				return key ? [formatKeymapKey(key)] : [];
			})
			.join("/");
		return keys ? [{ keys, label: hint.label }] : [];
	});
