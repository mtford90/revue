// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI menus use pointer handlers on renderables.
// biome-ignore-all lint/a11y/useKeyWithMouseEvents: Keyboard operation is routed by the menu controller.
import type { MouseEvent as OpenTUIMouseEvent } from "@opentui/core";
import { useState } from "react";
import { KEYMAP, type KeymapAction, keymapHint } from "./keymap.ts";
import type { DiffLayoutPreference, SidebarPreference } from "./layout.ts";
import type { PathDisplayMode } from "./pathDisplay.ts";
import type { FileDisplayPreference } from "./preferences.ts";
import { useTheme } from "./theme.ts";

export type MenuId = "file" | "navigate" | "view" | "help";

export type MenuEntry =
	| {
			kind: "item";
			label: string;
			hint?: string;
			checked?: boolean;
			disabled?: boolean;
			action: () => void;
	  }
	| { kind: "separator"; id: string };

type MenuSpec = { id: MenuId; label: string; left: number; width: number };

const MENU_LABELS: Record<MenuId, string> = {
	file: "File",
	navigate: "Navigate",
	view: "View",
	help: "Help",
};
export const MENU_ORDER = Object.keys(MENU_LABELS) as MenuId[];

const menuSpecs = MENU_ORDER.reduce<MenuSpec[]>((specs, id) => {
	const previous = specs.at(-1);
	const width = MENU_LABELS[id].length + 2;
	specs.push({
		id,
		label: MENU_LABELS[id],
		left: previous ? previous.left + previous.width : 1,
		width,
	});
	return specs;
}, []);

const DIFF_PREFERENCES: { preference: DiffLayoutPreference; label: string }[] = [
	{ preference: "auto", label: "Diff layout: auto" },
	{ preference: "split", label: "Diff layout: split" },
	{ preference: "stacked", label: "Diff layout: stacked" },
];

const FILE_DISPLAY_PREFERENCES: { preference: FileDisplayPreference; label: string }[] = [
	{ preference: "all", label: "File display: all" },
	{ preference: "focused", label: "File display: focused" },
];

const PATH_DISPLAY_PREFERENCES: { preference: PathDisplayMode; label: string }[] = [
	{ preference: "smart", label: "Paths: smart" },
	{ preference: "tree", label: "Paths: tree" },
	{ preference: "full", label: "Paths: full" },
];

const SIDEBAR_PREFERENCES: { preference: SidebarPreference; label: string }[] = [
	{ preference: "auto", label: "Sidebar: auto" },
	{ preference: "shown", label: "Sidebar: shown" },
	{ preference: "hidden", label: "Sidebar: hidden" },
];

export const selectable = (
	entry: MenuEntry | undefined,
): entry is Extract<MenuEntry, { kind: "item" }> => entry?.kind === "item" && !entry.disabled;

export const nextMenuItemIndex = (entries: MenuEntry[], current: number, delta: number) => {
	if (!entries.length) return 0;
	for (let distance = 1; distance <= entries.length; distance += 1) {
		const candidate = (current + distance * delta + entries.length) % entries.length;
		if (selectable(entries[candidate])) return candidate;
	}
	return 0;
};

const menuEntryWidth = (entry: MenuEntry, showHints: boolean) => {
	if (entry.kind === "separator") return 8;
	const prefix = entry.checked === undefined ? "  " : "[x] ";
	const hint = showHints && entry.hint ? ` ${entry.hint}` : "";
	return prefix.length + entry.label.length + hint.length;
};

const menuWidth = (entries: MenuEntry[], showHints: boolean) =>
	Math.max(18, ...entries.map((entry) => menuEntryWidth(entry, showHints) + 2));

export const buildAppMenus = ({
	canMovePrevious,
	canMoveNext,
	canChangeFiles,
	canMoveNextUnreviewed,
	allFiles,
	canToggleAllFiles,
	toggleAllFiles,
	commentsSurface,
	toggleComments,
	showHelp,
	fileDisplay,
	pathDisplay,
	sidebarPreference,
	diffPreference,
	lineNumbers,
	changeMarkers,
	splitReachable,
	setFileDisplay,
	setPathDisplay,
	setSidebarPreference,
	setDiffPreference,
	setLineNumbers,
	setChangeMarkers,
	requestQuit,
	requestReload,
	requestSendFeedback,
	movePrevious,
	moveNext,
	moveNextUnreviewed,
	collapseFiles,
	expandFiles,
	toggleHelp,
	chooseTheme,
	themeLabel,
	keymap = KEYMAP,
}: {
	canMovePrevious: boolean;
	canMoveNext: boolean;
	canChangeFiles: boolean;
	canMoveNextUnreviewed: boolean;
	allFiles: boolean;
	canToggleAllFiles: boolean;
	toggleAllFiles: () => void;
	commentsSurface: boolean;
	toggleComments: () => void;
	showHelp: boolean;
	fileDisplay: FileDisplayPreference;
	pathDisplay: PathDisplayMode;
	sidebarPreference: SidebarPreference;
	diffPreference: DiffLayoutPreference;
	lineNumbers: boolean;
	changeMarkers: boolean;
	splitReachable: boolean;
	setFileDisplay: (preference: FileDisplayPreference) => void;
	setPathDisplay: (preference: PathDisplayMode) => void;
	setSidebarPreference: (preference: SidebarPreference) => void;
	setDiffPreference: (preference: DiffLayoutPreference) => void;
	setLineNumbers: (visible: boolean) => void;
	setChangeMarkers: (visible: boolean) => void;
	requestQuit: () => void;
	requestReload: () => void;
	requestSendFeedback: () => void;
	movePrevious: () => void;
	moveNext: () => void;
	moveNextUnreviewed: () => void;
	collapseFiles: () => void;
	expandFiles: () => void;
	toggleHelp: () => void;
	chooseTheme: () => void;
	themeLabel: string;
	keymap?: readonly KeymapAction[];
}): Record<MenuId, MenuEntry[]> => ({
	file: [
		{
			kind: "item",
			label: "Send feedback to agent",
			hint: keymapHint("send-to-agent", keymap),
			action: requestSendFeedback,
		},
		{
			kind: "item",
			label: "Reload",
			hint: keymapHint("reload", keymap),
			action: requestReload,
		},
		{ kind: "item", label: "Quit", hint: keymapHint("quit", keymap), action: requestQuit },
	],
	navigate: [
		{
			kind: "item",
			label: "Previous page",
			hint: keymapHint("previous-page", keymap),
			disabled: !canMovePrevious,
			action: movePrevious,
		},
		{
			kind: "item",
			label: "Next page",
			hint: keymapHint("next-page", keymap),
			disabled: !canMoveNext,
			action: moveNext,
		},
		{ kind: "separator", id: "page-navigation" },
		{
			kind: "item",
			label: "Next unreviewed chapter",
			hint: keymapHint("next-unreviewed", keymap),
			disabled: !canMoveNextUnreviewed,
			action: moveNextUnreviewed,
		},
		{ kind: "separator", id: "surfaces" },
		{
			kind: "item",
			label: "Diff",
			hint: keymapHint("toggle-all-files", keymap),
			checked: allFiles,
			disabled: !canToggleAllFiles,
			action: toggleAllFiles,
		},
		{
			kind: "item",
			label: "Comments",
			hint: keymapHint("toggle-comments", keymap),
			checked: commentsSurface,
			action: toggleComments,
		},
	],
	view: [
		{
			kind: "item",
			label: "Line numbers",
			checked: lineNumbers,
			action: () => setLineNumbers(!lineNumbers),
		},
		{
			kind: "item",
			label: "Change markers (+/-)",
			checked: changeMarkers,
			action: () => setChangeMarkers(!changeMarkers),
		},
		{ kind: "separator", id: "diff-chrome" },
		...FILE_DISPLAY_PREFERENCES.map(
			({ preference, label }): MenuEntry => ({
				kind: "item",
				label,
				checked: fileDisplay === preference,
				action: () => setFileDisplay(preference),
			}),
		),
		{ kind: "separator", id: "file-display" },
		...PATH_DISPLAY_PREFERENCES.map(
			({ preference, label }): MenuEntry => ({
				kind: "item",
				label,
				checked: pathDisplay === preference,
				action: () => setPathDisplay(preference),
			}),
		),
		{ kind: "separator", id: "path-display" },
		...DIFF_PREFERENCES.map(
			({ preference, label }): MenuEntry => ({
				kind: "item",
				label:
					preference === "split" && !splitReachable ? `${label} (needs a wider terminal)` : label,
				checked: diffPreference === preference,
				action: () => setDiffPreference(preference),
			}),
		),
		{ kind: "separator", id: "diff-layout" },
		...SIDEBAR_PREFERENCES.map(
			({ preference, label }): MenuEntry => ({
				kind: "item",
				label,
				checked: sidebarPreference === preference,
				action: () => setSidebarPreference(preference),
			}),
		),
		{ kind: "separator", id: "sidebar" },
		{
			kind: "item",
			label: "Collapse files",
			hint: keymapHint("collapse-files", keymap),
			disabled: !canChangeFiles,
			action: collapseFiles,
		},
		{
			kind: "item",
			label: "Expand files",
			hint: keymapHint("expand-files", keymap),
			disabled: !canChangeFiles,
			action: expandFiles,
		},
		{ kind: "separator", id: "theme" },
		{
			kind: "item",
			label: `Theme: ${themeLabel}`,
			hint: keymapHint("open-theme-picker", keymap),
			action: chooseTheme,
		},
	],
	help: [
		{
			kind: "item",
			label: "Keyboard shortcuts",
			hint: keymapHint("toggle-shortcut-help", keymap),
			checked: showHelp,
			action: toggleHelp,
		},
	],
});

export const useMenuController = (menus: Record<MenuId, MenuEntry[]>) => {
	const [activeMenuId, setActiveMenuId] = useState<MenuId | null>(null);
	const [activeItemIndex, setActiveItemIndex] = useState(0);
	const close = () => setActiveMenuId(null);
	const open = (id: MenuId) => {
		setActiveMenuId(id);
		setActiveItemIndex(nextMenuItemIndex(menus[id], -1, 1));
	};
	const toggle = (id: MenuId) => (activeMenuId === id ? close() : open(id));
	const switchMenu = (delta: number) => {
		const current = activeMenuId ? MENU_ORDER.indexOf(activeMenuId) : 0;
		open(MENU_ORDER[(current + delta + MENU_ORDER.length) % MENU_ORDER.length] ?? "file");
	};
	const move = (delta: number) => {
		if (!activeMenuId) return;
		setActiveItemIndex((current) => nextMenuItemIndex(menus[activeMenuId], current, delta));
	};
	const activate = (entry = activeMenuId ? menus[activeMenuId][activeItemIndex] : undefined) => {
		if (!selectable(entry)) return;
		entry.action();
		close();
	};
	return {
		activeEntries: activeMenuId ? menus[activeMenuId] : [],
		activeItemIndex,
		activeMenuId,
		activate,
		close,
		move,
		open,
		setActiveItemIndex,
		switchMenu,
		toggle,
	};
};

const stopMouse = (event: OpenTUIMouseEvent) => {
	event.preventDefault();
	event.stopPropagation();
};

export type ReviewSurface = "story" | "files" | "comments";
const SURFACE_LABELS: Record<ReviewSurface, string> = {
	story: "Narrative",
	files: "Diff",
	comments: "Comments",
};
const SURFACES: readonly ReviewSurface[] = ["story", "files", "comments"];

/** The Comments tab wears its open-thread count so triage state reads from anywhere. */
const surfaceTabs = (
	surfaces: readonly ReviewSurface[],
	openThreads: number,
): { id: ReviewSurface; label: string }[] =>
	surfaces.map((id) => ({
		id,
		label:
			id === "comments" && openThreads > 0
				? `${SURFACE_LABELS[id]} · ${openThreads}`
				: SURFACE_LABELS[id],
	}));

const surfaceTabsWidth = (tabs: { label: string }[]) =>
	tabs.reduce((total, { label }) => total + label.length + 2, 0);

/** Narrow terminals shed detail in stages: first the thread count, then down to initials. */
const fitSurfaceTabs = (
	surfaces: readonly ReviewSurface[],
	openThreads: number,
	available: number,
) =>
	[
		surfaceTabs(surfaces, openThreads),
		surfaceTabs(surfaces, 0),
		surfaces.map((id) => ({ id, label: SURFACE_LABELS[id].slice(0, 1) })),
	].find((tabs) => available >= surfaceTabsWidth(tabs) + 2);

const MENU_BAR_WIDTH = menuSpecs.reduce((total, spec) => total + spec.width, 0);

export const MenuBar = ({
	activeMenuId,
	terminalWidth,
	surface,
	hasStory,
	openThreads,
	onSelectSurface,
	onHover,
	onToggle,
	onClose,
}: {
	activeMenuId: MenuId | null;
	terminalWidth: number;
	surface: ReviewSurface;
	/** False for a chapterless run, where the story tab has nothing to show. */
	hasStory: boolean;
	openThreads: number;
	onSelectSurface: (surface: ReviewSurface) => void;
	onHover: (id: MenuId) => void;
	onToggle: (id: MenuId) => void;
	onClose: () => void;
}) => {
	const theme = useTheme();
	const surfaces = hasStory ? SURFACES : SURFACES.filter((id) => id !== "story");
	const tabs = fitSurfaceTabs(surfaces, openThreads, terminalWidth - 2 - MENU_BAR_WIDTH) ?? [];
	const surfaceBarWidth = surfaceTabsWidth(tabs);
	const showSurfaces = tabs.length > 0;
	const surfaceSlack = terminalWidth - 2 - MENU_BAR_WIDTH - surfaceBarWidth;
	const surfacePad = Math.min(
		Math.max(0, Math.floor((terminalWidth - surfaceBarWidth) / 2) - 1 - MENU_BAR_WIDTH),
		surfaceSlack,
	);
	return (
		<box
			height={1}
			width="100%"
			flexShrink={0}
			flexDirection="row"
			backgroundColor={theme.panelAlt}
			paddingLeft={1}
			paddingRight={1}
			zIndex={50}
			onMouseDown={(event) => {
				stopMouse(event);
				onClose();
			}}
		>
			{menuSpecs.map((spec) => {
				const active = activeMenuId === spec.id;
				return (
					<box
						key={spec.id}
						height={1}
						width={spec.width}
						flexShrink={0}
						backgroundColor={active ? theme.accent : theme.panelAlt}
						onMouseDown={stopMouse}
						onMouseUp={(event) => {
							stopMouse(event);
							onToggle(spec.id);
						}}
						onMouseOver={() => onHover(spec.id)}
					>
						<text fg={active ? theme.background : theme.text}>{` ${spec.label} `}</text>
					</box>
				);
			})}
			<box flexGrow={1} minWidth={0} height={1} flexDirection="row">
				{showSurfaces ? <box height={1} width={surfacePad} flexShrink={0} /> : null}
				{showSurfaces
					? tabs.map(({ id, label }) => {
							const active = surface === id;
							return (
								<box
									key={id}
									height={1}
									flexShrink={0}
									backgroundColor={active ? theme.accent : theme.panelAlt}
									onMouseDown={stopMouse}
									onMouseUp={(event) => {
										stopMouse(event);
										onSelectSurface(id);
									}}
								>
									<text fg={active ? theme.background : theme.muted}>{` ${label} `}</text>
								</box>
							);
						})
					: null}
			</box>
		</box>
	);
};

const itemText = (
	entry: Extract<MenuEntry, { kind: "item" }>,
	width: number,
	showHints: boolean,
) => {
	const prefix = entry.checked === undefined ? "  " : entry.checked ? "[x] " : "[ ] ";
	const hint = showHints ? (entry.hint ?? "") : "";
	const hintSpace = hint ? hint.length + 1 : 0;
	const labelWidth = Math.max(0, width - prefix.length - hintSpace);
	const label = entry.label.slice(0, labelWidth).padEnd(labelWidth);
	return `${prefix}${label}${hint ? ` ${hint}` : ""}`;
};

const MenuPanel = ({
	entries,
	selectedIndex,
	keyPrefix,
	top,
	left,
	width,
	showHints,
	onHover,
	onSelect,
}: {
	entries: MenuEntry[];
	selectedIndex: number;
	keyPrefix: string;
	top: number;
	left: number;
	width: number;
	showHints: boolean;
	onHover: (index: number) => void;
	onSelect: (entry: MenuEntry) => void;
}) => {
	const theme = useTheme();
	return (
		<box
			position="absolute"
			top={top}
			left={left}
			width={width}
			height={entries.length + 2}
			zIndex={40}
			border
			borderColor={theme.muted}
			backgroundColor={theme.background}
			flexDirection="column"
			onMouseDown={stopMouse}
		>
			{entries.map((entry, index) =>
				entry.kind === "separator" ? (
					<text key={`${keyPrefix}:separator:${entry.id}`} fg={theme.border}>
						{"─".repeat(Math.max(1, width - 2))}
					</text>
				) : (
					<box
						key={`${keyPrefix}:${entry.label}`}
						height={1}
						width="100%"
						backgroundColor={selectedIndex === index ? theme.panelAlt : theme.background}
						onMouseOver={() => {
							if (!entry.disabled) onHover(index);
						}}
						onMouseUp={(event) => {
							stopMouse(event);
							onSelect(entry);
						}}
					>
						<text fg={entry.disabled ? theme.muted : theme.text} wrapMode="none" truncate>
							{itemText(entry, width - 2, showHints)}
						</text>
					</box>
				),
			)}
		</box>
	);
};

export const MenuDropdown = ({
	activeMenuId,
	entries,
	selectedIndex,
	terminalWidth,
	onHover,
	onSelect,
}: {
	activeMenuId: MenuId;
	entries: MenuEntry[];
	selectedIndex: number;
	terminalWidth: number;
	onHover: (index: number) => void;
	onSelect: (entry: MenuEntry) => void;
}) => {
	const spec = menuSpecs.find((candidate) => candidate.id === activeMenuId) ?? menuSpecs[0];
	if (!spec) return null;
	const showHints = terminalWidth >= 60;
	const width = Math.min(menuWidth(entries, showHints), Math.max(8, terminalWidth - 2));
	return (
		<MenuPanel
			entries={entries}
			selectedIndex={selectedIndex}
			keyPrefix={activeMenuId}
			top={1}
			left={Math.max(1, Math.min(spec.left, terminalWidth - width - 1))}
			width={width}
			showHints={showHints}
			onHover={onHover}
			onSelect={onSelect}
		/>
	);
};

/** The same entry list as a menu-bar dropdown, seated wherever the pointer opened it. */
export const ContextMenu = ({
	entries,
	selectedIndex,
	position,
	terminalWidth,
	terminalHeight,
	onHover,
	onSelect,
}: {
	entries: MenuEntry[];
	selectedIndex: number;
	position: { x: number; y: number };
	terminalWidth: number;
	terminalHeight: number;
	onHover: (index: number) => void;
	onSelect: (entry: MenuEntry) => void;
}) => {
	const showHints = terminalWidth >= 60;
	const width = Math.min(menuWidth(entries, showHints), Math.max(8, terminalWidth - 2));
	const height = entries.length + 2;
	return (
		<MenuPanel
			entries={entries}
			selectedIndex={selectedIndex}
			keyPrefix="context"
			top={Math.max(1, Math.min(position.y, terminalHeight - height))}
			left={Math.max(0, Math.min(position.x, terminalWidth - width))}
			width={width}
			showHints={showHints}
			onHover={onHover}
			onSelect={onSelect}
		/>
	);
};

export const MenuBackdrop = ({ onClose }: { onClose: () => void }) => (
	<box
		position="absolute"
		top={1}
		left={0}
		width="100%"
		height="100%"
		zIndex={30}
		shouldFill={false}
		onMouseDown={(event) => {
			stopMouse(event);
			onClose();
		}}
		onMouseUp={stopMouse}
	/>
);
