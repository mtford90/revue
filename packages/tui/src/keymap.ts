/**
 * The single source of truth for context-level keyboard shortcuts: the
 * keyboard handler, help overlay and menu hints all derive their key labels
 * from here rather than hardcoding them independently.
 *
 * Out of scope by design: digit jumps 1-9, escape (the reserved dismiss/quit
 * hatch) and modal-internal navigation/text input (confirm-delete, the
 * pointer context menu, menu-bar arrow navigation, help-overlay scrolling,
 * the theme picker and thread-draft composition). Those stay hardcoded in
 * the keyboard handler.
 *
 * Every derivation below takes the effective keymap as an (optional,
 * defaulted) argument rather than closing over a module-level constant, so a
 * future loader that merges user overrides can pass its own array through
 * without reworking these call sites.
 */

export type KeymapContext = "global" | "page" | "comments" | "chord";

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
	/** Default keys in the grammar: lowercase named keys, `ctrl+`/`shift+` prefixes, uppercase literals for shifted characters. */
	keys: readonly string[];
	/** Keys shown in help/menu text; defaults to `keys`. Use when `keys` carries a terminal-reporting alias that would otherwise display twice (e.g. `G` and `shift+g` for the same keystroke). */
	displayKeys?: readonly string[];
	context: KeymapContext;
	/** Groups the action for the help overlay. Actions without a section are not shown there. */
	section?: KeymapSection;
};

const KEYMAP_DEF = [
	{
		id: "open-menu",
		description: "Open the menu bar (File, Navigate, View, Help)",
		keys: ["f10"],
		context: "global",
		section: "Menus",
	},
	{
		id: "toggle-shortcut-help",
		description: "Show or hide the shortcuts overlay",
		keys: ["?"],
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
		keys: ["q"],
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
		keys: ["{", "shift+["],
		displayKeys: ["{"],
		context: "global",
		section: "Review",
	},
	{
		id: "next-key-change",
		description: "Focus the next key change",
		keys: ["}", "shift+]"],
		displayKeys: ["}"],
		context: "global",
		section: "Review",
	},
	{
		id: "previous-page",
		description: "Previous page (prologue is page one)",
		keys: ["[c"],
		context: "chord",
		section: "Navigation",
	},
	{
		id: "next-page",
		description: "Next page (prologue is page one)",
		keys: ["]c"],
		context: "chord",
		section: "Navigation",
	},
	{
		id: "line-up",
		description: "Scroll up one line",
		keys: ["k", "up"],
		context: "page",
		section: "Scrolling",
	},
	{
		id: "line-down",
		description: "Scroll down one line",
		keys: ["j", "down"],
		context: "page",
		section: "Scrolling",
	},
	{
		id: "half-page-up",
		description: "Scroll up half a page",
		keys: ["u"],
		context: "page",
		section: "Scrolling",
	},
	{
		id: "half-page-down",
		description: "Scroll down half a page",
		keys: ["d"],
		context: "page",
		section: "Scrolling",
	},
	{
		id: "page-up",
		description: "Scroll up a page",
		keys: ["pageup", "b", "ctrl+b"],
		displayKeys: ["pageup", "b"],
		context: "page",
		section: "Scrolling",
	},
	{
		id: "page-down",
		description: "Scroll down a page",
		keys: ["pagedown", "space", "ctrl+f"],
		displayKeys: ["pagedown", "space"],
		context: "page",
		section: "Scrolling",
	},
	{
		id: "scroll-top",
		description: "Scroll to the top",
		keys: ["g"],
		context: "page",
		section: "Scrolling",
	},
	{
		id: "scroll-bottom",
		description: "Scroll to the bottom",
		keys: ["G", "shift+g"],
		displayKeys: ["G"],
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
		description: "All files: the whole diff without the story",
		keys: ["w"],
		context: "page",
		section: "Navigation",
	},
	{
		id: "focus-file",
		description: "Focus the next/previous file",
		keys: ["tab", "shift+tab"],
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
		keys: ["f"],
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
		keys: ["y"],
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
		description: "Switch to the Files surface",
		keys: ["w"],
		context: "comments",
	},
	{
		id: "comments-previous",
		description: "Select the previous thread",
		keys: ["k", "up"],
		context: "comments",
	},
	{
		id: "comments-next",
		description: "Select the next thread",
		keys: ["j", "down"],
		context: "comments",
	},
	{
		id: "comments-first",
		description: "Select the first thread",
		keys: ["g"],
		context: "comments",
	},
	{
		id: "comments-last",
		description: "Select the last thread",
		keys: ["G"],
		context: "comments",
	},
	{
		id: "jump-to-thread",
		description: "Jump to the selected thread",
		keys: ["return"],
		context: "comments",
	},
] as const satisfies readonly KeymapActionDef<string>[];

export type KeymapActionId = (typeof KEYMAP_DEF)[number]["id"];

export type KeymapAction = KeymapActionDef<KeymapActionId>;

export const KEYMAP: readonly KeymapAction[] = KEYMAP_DEF;

const stripModifier = (key: string) => key.replace(/^(ctrl|shift)\+/, "");

/** `preventDefault`/`stopPropagation` gate: every raw key name the app owns, plus the fixed keys outside the registry. */
export const deriveAppKeys = (keymap: readonly KeymapAction[] = KEYMAP): Set<string> =>
	new Set([
		...keymap
			.filter((action) => action.context !== "chord")
			.flatMap((action) => action.keys.map(stripModifier)),
		"escape",
		// The chord prefixes stay hardcoded outside the registry, so their raw
		// keys must always be preventDefaulted, even if a user rebinds
		// previous/next-key-change away from the shift+[/shift+] aliases that
		// otherwise bring them in.
		"[",
		"]",
	]);

const keymapActionsForContext = (
	context: Exclude<KeymapContext, "chord">,
	keymap: readonly KeymapAction[],
) => keymap.filter((action) => action.context === context || action.context === "global");

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
	context: Exclude<KeymapContext, "chord">,
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
	pageup: "PgUp",
	pagedown: "PgDn",
	return: "Enter",
	space: "Space",
	escape: "Esc",
	tab: "Tab",
	f10: "F10",
};

const formatKeymapKey = (key: string): string => {
	if (key.startsWith("ctrl+")) return `Ctrl-${formatKeymapKey(key.slice("ctrl+".length))}`;
	if (key.startsWith("shift+")) return `Shift-${formatKeymapKey(key.slice("shift+".length))}`;
	return KEY_LABELS[key] ?? key;
};

const formatKeymapKeys = (keys: readonly string[]) => keys.map(formatKeymapKey).join("/");

/** The first default key for an action, for compact display such as menu hints. */
export const keymapHint = (
	id: KeymapActionId,
	keymap: readonly KeymapAction[] = KEYMAP,
): string | undefined => keymap.find((action) => action.id === id)?.keys[0];

const KEYMAP_SECTION_ORDER: KeymapSection[] = [
	"Scrolling",
	"Navigation",
	"Files",
	"Review",
	"Copying",
	"Views",
	"Menus",
];

/** Non-keyboard advisory notes that belong alongside a section but aren't registry actions. */
const KEYMAP_SECTION_NOTES: Partial<Record<KeymapSection, string[]>> = {
	Navigation: ["pointer: the strip under the menu bar, or the sidebar index"],
	Files: ["click a ⋯ band to reveal unchanged lines around a hunk"],
	Review: ["1-9 direct · pointer: click/drag the line-number gutter to start a thread"],
	Copying: [
		"drag over code to select it",
		"right-click a line for copy text, copy path, copy link, comment",
		"ctrl-y path:line · ctrl-g GitHub link, while a thread is open",
		"links need a GitHub remote and a committed side",
	],
	Views: [
		"F10 → View toggles Patch / read-only Semantic",
		"F10 → View sets diff layout: auto, split or stacked",
		"key-change anchors work in both views; Semantic remains read-only",
	],
};

/** Groups registry actions into the help overlay's sections, generating each shortcut's display line. */
export const keymapSections = (
	keymap: readonly KeymapAction[] = KEYMAP,
): { title: KeymapSection; lines: string[] }[] =>
	KEYMAP_SECTION_ORDER.map((title) => ({
		title,
		lines: [
			...keymap
				.filter((action) => action.section === title)
				.map(
					(action) =>
						`${formatKeymapKeys(action.displayKeys ?? action.keys)} ${action.description} (${action.id})`,
				),
			...(KEYMAP_SECTION_NOTES[title] ?? []),
		],
	})).filter((section) => section.lines.length > 0);
