// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI dialogs use pointer handlers on renderables.
// biome-ignore-all lint/a11y/useKeyWithMouseEvents: Keyboard operation is routed by the app shell.
import type { MouseEvent as OpenTUIMouseEvent } from "@opentui/core";
import type { HostTerminal } from "./host.ts";
import { useTheme } from "./theme.ts";

const MIN_WIDTH = 34;
const MAX_WIDTH = 52;
const MIN_ROWS = 3;
const MAX_HEIGHT = 20;
// Border, title, the help row, and the overflow row all sit outside the list window.
const CHROME_ROWS = 4;

const pickerHeight = (terminalHeight: number) =>
	Math.min(Math.max(MIN_ROWS + CHROME_ROWS, terminalHeight - 4), MAX_HEIGHT);

/** Keep the selected row inside a fixed-height window without jumping to the edges. */
const windowStart = (selectedIndex: number, count: number, rows: number) => {
	if (count <= rows) return 0;
	const centred = selectedIndex - Math.floor(rows / 2);
	return Math.min(Math.max(centred, 0), count - rows);
};

export function AgentTerminalPicker({
	candidates,
	selectedIndex,
	terminalWidth,
	terminalHeight,
	onPick,
}: {
	/** Sanitised titles, most recent output first — the controller already sorts these. */
	candidates: readonly HostTerminal[];
	selectedIndex: number;
	terminalWidth: number;
	terminalHeight: number;
	onPick: (index: number) => void;
}) {
	const theme = useTheme();
	const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, terminalWidth - 8));
	const height = pickerHeight(terminalHeight);
	const rows = Math.max(MIN_ROWS, height - CHROME_ROWS);
	const start = windowStart(selectedIndex, candidates.length, rows);
	const visible = candidates.slice(start, start + rows);
	const remaining = candidates.length - start - visible.length;

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
			title=" Send to… "
			onMouseDown={(event: OpenTUIMouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			<text fg={theme.muted} wrapMode="none" truncate>
				↑/↓ select · enter send · esc cancel
			</text>
			{visible.map((candidate, offset) => {
				const index = start + offset;
				const selected = index === selectedIndex;
				return (
					<box
						key={candidate.handle}
						height={1}
						width="100%"
						flexDirection="row"
						backgroundColor={selected ? theme.accentMuted : undefined}
						onMouseUp={(event: OpenTUIMouseEvent) => {
							event.stopPropagation();
							onPick(index);
						}}
					>
						<text flexShrink={0} fg={selected ? theme.accent : theme.border}>
							{selected ? "▸" : " "}{" "}
						</text>
						<text
							flexGrow={1}
							minWidth={0}
							wrapMode="none"
							truncate
							fg={selected ? theme.text : theme.muted}
						>
							{candidate.title}
						</text>
					</box>
				);
			})}
			{remaining > 0 ? <text fg={theme.muted}>… {remaining} more</text> : null}
		</box>
	);
}

export const AgentTerminalPickerBackdrop = ({ onClose }: { onClose: () => void }) => (
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
