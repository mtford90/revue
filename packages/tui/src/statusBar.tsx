import { useTheme } from "./theme.ts";

/**
 * The powerline arrows live in Unicode's Private Use Area, so only terminals
 * known to bundle the glyphs get them; everyone else gets flush segments.
 */
export function powerlineArrows(env: Record<string, string | undefined>): boolean {
	const program = env.TERM_PROGRAM?.toLowerCase() ?? "";
	if (["ghostty", "wezterm", "iterm.app"].includes(program)) return true;
	return (env.TERM ?? "").includes("kitty");
}

export function gauge(reviewed: number, total: number, width: number): string {
	if (total <= 0) return "▱".repeat(width);
	const ratio = reviewed / total;
	const exact = ratio * width;
	// A gauge that shows empty despite progress, or full despite remaining
	// work, reads as broken — clamp the rounding away from both edges.
	const filled =
		reviewed === total
			? width
			: Math.min(width - 1, Math.max(reviewed > 0 ? 1 : 0, Math.round(exact)));
	return "▰".repeat(filled) + "▱".repeat(width - filled);
}

const RIGHT_ARROW = "";
const LEFT_ARROW = "";
const GAUGE_WIDTH = 8;
const WIDE_BAR_WIDTH = 76;
const NARROW_BAR_WIDTH = 56;
const TINY_BAR_WIDTH = 40;

export type StatusNotice = { text: string; tone: "success" | "error" };

/**
 * Hints shed whole from the right rather than truncating, because half a hint teaches nothing.
 * Silent on a narrow bar: the segments to its left have already started shedding by then.
 */
export const hintText = (
	hints: readonly { keys: string; label: string }[],
	{ narrow, budget }: { narrow: boolean; budget: number },
) => {
	if (narrow) return "";
	const kept: string[] = [];
	for (const hint of hints) {
		const next = [...kept, `${hint.keys} ${hint.label}`];
		if (next.join(" · ").length + 1 > budget) break;
		kept.push(`${hint.keys} ${hint.label}`);
	}
	return kept.length === 0 ? "" : ` ${kept.join(" · ")}`;
};

/** What the bar names for the current surface: a few keys, and the pair that never leaves. */
export type StatusHints = { keys: string; label: string }[];

export function StatusBar({
	context,
	reviewedFiles,
	totalFiles,
	openThreads,
	notice,
	hints: hintList = [],
	helpKey = "?",
	quitKey = "q",
	terminalWidth,
}: {
	context: string;
	reviewedFiles: number;
	totalFiles: number;
	openThreads: number;
	notice: StatusNotice | null;
	hints?: StatusHints;
	helpKey?: string;
	quitKey?: string;
	terminalWidth: number;
}) {
	const theme = useTheme();
	const arrows = powerlineArrows(process.env);
	const wide = terminalWidth >= WIDE_BAR_WIDTH;
	const narrow = terminalWidth < NARROW_BAR_WIDTH;
	const tiny = terminalWidth < TINY_BAR_WIDTH;
	const bar = gauge(reviewedFiles, totalFiles, GAUGE_WIDTH);
	const boundary = bar.indexOf("▱");
	const filled = boundary === -1 ? bar : bar.slice(0, boundary);
	const empty = boundary === -1 ? "" : bar.slice(boundary);
	const filesText = tiny ? "" : ` ${reviewedFiles}/${totalFiles} files `;
	const threadsText =
		!narrow && openThreads > 0
			? ` ${openThreads} ${openThreads === 1 ? "thread" : "threads"} │`
			: "";
	const tailText = tiny ? ` ${helpKey} · ${quitKey} ` : ` ${helpKey} help · ${quitKey} quit `;
	const spent =
		" revue ".length +
		(tiny ? 0 : context.length + 2) +
		(wide ? bar.length + 1 : 0) +
		filesText.length +
		threadsText.length +
		tailText.length +
		(arrows ? 4 : 0);
	const hints = hintText(hintList, { narrow, budget: terminalWidth - spent });
	return (
		<box height={1} width="100%" flexShrink={0} flexDirection="row">
			<text flexShrink={0} fg={theme.background} bg={theme.accent}>
				{" revue "}
			</text>
			{arrows ? (
				<text flexShrink={0} fg={theme.accent} bg={tiny ? theme.background : theme.panelAlt}>
					{RIGHT_ARROW}
				</text>
			) : null}
			{tiny ? null : (
				<text
					flexShrink={1}
					minWidth={0}
					wrapMode="none"
					truncate
					fg={theme.text}
					bg={theme.panelAlt}
				>
					{` ${context} `}
				</text>
			)}
			{arrows && !tiny ? (
				<text flexShrink={0} fg={theme.panelAlt} bg={theme.panel}>
					{RIGHT_ARROW}
				</text>
			) : null}
			{wide ? (
				<text flexShrink={0} fg={theme.accent} bg={theme.panel}>
					{` ${filled}`}
				</text>
			) : null}
			{wide ? (
				<text flexShrink={0} fg={theme.muted} bg={theme.panel}>
					{empty}
				</text>
			) : null}
			{filesText ? (
				<text flexShrink={0} fg={theme.text} bg={theme.panel}>
					{filesText}
				</text>
			) : null}
			{arrows && !tiny ? (
				<text flexShrink={0} fg={theme.panel}>
					{RIGHT_ARROW}
				</text>
			) : null}
			<box flexGrow={1} minWidth={0} height={1} flexDirection="row">
				{notice ? (
					<text
						flexShrink={1}
						minWidth={0}
						wrapMode="none"
						truncate
						fg={notice.tone === "success" ? theme.badgeAdded : theme.badgeRemoved}
					>
						{` ${notice.text}`}
					</text>
				) : (
					// Hints yield the whole region to a notice rather than stacking beside it.
					<text flexShrink={1} minWidth={0} wrapMode="none" truncate fg={theme.muted}>
						{hints}
					</text>
				)}
			</box>
			{arrows ? (
				<text flexShrink={0} fg={theme.panelAlt}>
					{LEFT_ARROW}
				</text>
			) : null}
			{threadsText ? (
				<text flexShrink={0} fg={theme.badgeModified} bg={theme.panelAlt}>
					{threadsText}
				</text>
			) : null}
			<text flexShrink={0} fg={theme.muted} bg={theme.panelAlt}>
				{tailText}
			</text>
		</box>
	);
}
