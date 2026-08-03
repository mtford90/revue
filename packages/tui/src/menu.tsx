// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI menus use pointer handlers on renderables.
// biome-ignore-all lint/a11y/useKeyWithMouseEvents: Keyboard operation is routed by the menu controller.
import type { MouseEvent as OpenTUIMouseEvent } from "@opentui/core";
import { useState } from "react";
import { theme } from "./theme.ts";

export type MenuId = "file" | "view";

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

const MENU_LABELS: Record<MenuId, string> = { file: "File", view: "View" };
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

const selectable = (entry: MenuEntry | undefined): entry is Extract<MenuEntry, { kind: "item" }> =>
	entry?.kind === "item" && !entry.disabled;

const nextMenuItemIndex = (entries: MenuEntry[], current: number, delta: number) => {
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
	showHelp,
	viewMode,
	semanticLoading,
	requestQuit,
	movePrevious,
	moveNext,
	moveNextUnreviewed,
	collapseFiles,
	expandFiles,
	toggleHelp,
	showPatch,
	showSemantic,
}: {
	canMovePrevious: boolean;
	canMoveNext: boolean;
	canChangeFiles: boolean;
	canMoveNextUnreviewed: boolean;
	showHelp: boolean;
	viewMode: "patch" | "semantic";
	semanticLoading: boolean;
	requestQuit: () => void;
	movePrevious: () => void;
	moveNext: () => void;
	moveNextUnreviewed: () => void;
	collapseFiles: () => void;
	expandFiles: () => void;
	toggleHelp: () => void;
	showPatch: () => void;
	showSemantic: () => void;
}): Record<MenuId, MenuEntry[]> => ({
	file: [{ kind: "item", label: "Quit", hint: "q", action: requestQuit }],
	view: [
		{
			kind: "item",
			label: "Patch view",
			checked: viewMode === "patch",
			action: showPatch,
		},
		{
			kind: "item",
			label: semanticLoading ? "Semantic diff (loading...)" : "Semantic diff (read-only)",
			checked: viewMode === "semantic",
			disabled: semanticLoading,
			action: showSemantic,
		},
		{ kind: "separator", id: "view-mode" },
		{
			kind: "item",
			label: "Previous page",
			hint: "[c",
			disabled: !canMovePrevious,
			action: movePrevious,
		},
		{
			kind: "item",
			label: "Next page",
			hint: "]c",
			disabled: !canMoveNext,
			action: moveNext,
		},
		{
			kind: "item",
			label: "Next unreviewed chapter",
			hint: "a",
			disabled: !canMoveNextUnreviewed,
			action: moveNextUnreviewed,
		},
		{ kind: "separator", id: "chapter-navigation" },
		{
			kind: "item",
			label: "Collapse files",
			hint: "c",
			disabled: !canChangeFiles,
			action: collapseFiles,
		},
		{
			kind: "item",
			label: "Expand files",
			hint: "e",
			disabled: !canChangeFiles,
			action: expandFiles,
		},
		{ kind: "separator", id: "file-display" },
		{
			kind: "item",
			label: "Keyboard shortcuts",
			hint: "?",
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

const VIEW_LABELS: Record<"patch" | "semantic", string> = {
	patch: "Patch view",
	semantic: "Semantic view (read-only)",
};

const MENU_BAR_WIDTH = menuSpecs.reduce((total, spec) => total + spec.width, 0);

export const MenuBar = ({
	activeMenuId,
	terminalWidth,
	viewMode,
	onHover,
	onToggle,
	onClose,
}: {
	activeMenuId: MenuId | null;
	terminalWidth: number;
	viewMode: "patch" | "semantic";
	onHover: (id: MenuId) => void;
	onToggle: (id: MenuId) => void;
	onClose: () => void;
}) => {
	const viewLabel = VIEW_LABELS[viewMode];
	// A passive indicator, not a third menu: only shown when it can sit against
	// the right edge with a gap the menu titles can't close.
	const showViewLabel = terminalWidth - 2 - MENU_BAR_WIDTH >= viewLabel.length + 2;
	return (
		<box
			height={1}
			width="100%"
			flexShrink={0}
			flexDirection="row"
			backgroundColor={theme.surface}
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
						backgroundColor={active ? theme.accent : theme.surface}
						onMouseDown={stopMouse}
						onMouseUp={(event) => {
							stopMouse(event);
							onToggle(spec.id);
						}}
						onMouseOver={() => onHover(spec.id)}
					>
						<text fg={active ? theme.base : theme.text}>{` ${spec.label} `}</text>
					</box>
				);
			})}
			<box flexGrow={1} minWidth={0} height={1} flexDirection="row" justifyContent="flex-end">
				{showViewLabel ? (
					<text flexShrink={0} fg={theme.dim} wrapMode="none">
						{viewLabel}
					</text>
				) : null}
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
	const left = Math.max(1, Math.min(spec.left, terminalWidth - width - 1));
	return (
		<box
			position="absolute"
			top={1}
			left={left}
			width={width}
			height={entries.length + 2}
			zIndex={40}
			border
			borderColor={theme.dim}
			backgroundColor={theme.base}
			flexDirection="column"
			onMouseDown={stopMouse}
		>
			{entries.map((entry, index) =>
				entry.kind === "separator" ? (
					<text key={`${activeMenuId}:separator:${entry.id}`} fg={theme.surface}>
						{"─".repeat(Math.max(1, width - 2))}
					</text>
				) : (
					<box
						key={`${activeMenuId}:${entry.label}`}
						height={1}
						width="100%"
						backgroundColor={selectedIndex === index ? theme.surface : theme.base}
						onMouseOver={() => {
							if (!entry.disabled) onHover(index);
						}}
						onMouseUp={(event) => {
							stopMouse(event);
							onSelect(entry);
						}}
					>
						<text fg={entry.disabled ? theme.dim : theme.text} wrapMode="none" truncate>
							{itemText(entry, width - 2, showHints)}
						</text>
					</box>
				),
			)}
		</box>
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
