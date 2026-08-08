// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI dialogs use pointer handlers on renderables.
// biome-ignore-all lint/a11y/useKeyWithMouseEvents: Keyboard operation is routed by the app shell.
import type { MouseEvent as OpenTUIMouseEvent } from "@opentui/core";
import { THEME_IDS, type Theme } from "@revue/theme";
import { useTheme } from "./theme.ts";

/** A custom theme is "customised" when it shadows a bundled id, "custom" otherwise. */
const themeBadge = (id: string, customThemeIds: ReadonlySet<string>): string | undefined => {
	if (!customThemeIds.has(id)) return undefined;
	return THEME_IDS.includes(id) ? " (customised)" : " (custom)";
};

const MIN_WIDTH = 34;
const MAX_WIDTH = 52;
const MIN_ROWS = 4;
const MAX_HEIGHT = 24;
// Border, title, the two help rows, and the overflow row all sit outside the list window.
const CHROME_ROWS = 7;

const pickerHeight = (terminalHeight: number) =>
	Math.min(Math.max(MIN_ROWS + CHROME_ROWS, terminalHeight - 4), MAX_HEIGHT);

/** Keep the selected row inside a fixed-height window without jumping to the edges. */
const windowStart = (selectedIndex: number, count: number, rows: number) => {
	if (count <= rows) return 0;
	const centred = selectedIndex - Math.floor(rows / 2);
	return Math.min(Math.max(centred, 0), count - rows);
};

export function ThemePicker({
	themes,
	customThemeIds = new Set(),
	selectedIndex,
	activeThemeIds,
	followTerminal,
	terminalWidth,
	terminalHeight,
	onPick,
	onToggleFollowTerminal,
}: {
	themes: readonly Theme[];
	/** Ids sourced from `~/.revue/themes`, marked "(custom)" or "(customised)" in the list. */
	customThemeIds?: ReadonlySet<string>;
	selectedIndex: number;
	/** Both halves of a followed pair, or the single pinned theme. */
	activeThemeIds: ReadonlySet<string>;
	followTerminal: boolean;
	terminalWidth: number;
	terminalHeight: number;
	onPick: (index: number) => void;
	onToggleFollowTerminal: () => void;
}) {
	const theme = useTheme();
	const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, terminalWidth - 8));
	const height = pickerHeight(terminalHeight);
	const rows = Math.max(MIN_ROWS, height - CHROME_ROWS);
	const start = windowStart(selectedIndex, themes.length, rows);
	const visible = themes.slice(start, start + rows);
	const remaining = themes.length - start - visible.length;
	const selectedAppearance = themes[selectedIndex]?.appearance;

	return (
		<box
			position="absolute"
			top={Math.max(1, Math.floor((terminalHeight - height) / 2))}
			left={Math.max(0, Math.floor((terminalWidth - width) / 2))}
			width={width}
			height={height}
			zIndex={60}
			border
			borderColor={theme.accent}
			backgroundColor={theme.panel}
			flexDirection="column"
			paddingLeft={1}
			paddingRight={1}
			title=" Theme "
			onMouseDown={(event: OpenTUIMouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			<text fg={theme.muted} wrapMode="none" truncate>
				↑/↓ preview · enter accept · esc cancel
			</text>
			<text
				wrapMode="none"
				truncate
				fg={theme.muted}
				onMouseUp={(event: OpenTUIMouseEvent) => {
					event.stopPropagation();
					onToggleFollowTerminal();
				}}
			>
				a follow terminal:{" "}
				<span fg={followTerminal ? theme.badgeAdded : theme.muted}>
					{followTerminal ? "on" : "off"}
				</span>
				{followTerminal ? ` · enter → ${selectedAppearance} theme` : ""}
			</text>
			{visible.map((candidate, offset) => {
				const index = start + offset;
				const selected = index === selectedIndex;
				const active = activeThemeIds.has(candidate.id);
				return (
					<box
						key={candidate.id}
						height={1}
						width="100%"
						flexDirection="row"
						backgroundColor={selected ? theme.accentMuted : undefined}
						onMouseUp={(event: OpenTUIMouseEvent) => {
							event.stopPropagation();
							onPick(index);
						}}
					>
						<text
							flexShrink={0}
							fg={selected ? theme.accent : active ? theme.badgeAdded : theme.border}
						>
							{selected ? "▸" : active ? "✓" : " "}{" "}
						</text>
						<text
							flexGrow={1}
							minWidth={0}
							wrapMode="none"
							truncate
							fg={selected ? theme.text : theme.muted}
						>
							{candidate.label}
							{themeBadge(candidate.id, customThemeIds) ?? ""}
						</text>
						<text flexShrink={0} fg={theme.muted}>
							{candidate.appearance}
						</text>
					</box>
				);
			})}
			{remaining > 0 ? <text fg={theme.muted}>… {remaining} more</text> : null}
		</box>
	);
}

export const ThemePickerBackdrop = ({ onClose }: { onClose: () => void }) => (
	<box
		position="absolute"
		top={0}
		left={0}
		width="100%"
		height="100%"
		zIndex={55}
		shouldFill={false}
		onMouseDown={(event: OpenTUIMouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			onClose();
		}}
	/>
);
