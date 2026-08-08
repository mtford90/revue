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

/** How much of the diff a partial narrative covers. Null at full depth: full is the baseline. */
export type NarrativeCoverage = { label: string; narrated: number; total: number };

/**
 * A zoomed-out run says so permanently, so the segment only sheds under real pressure: the
 * word `hunks` once the thread count has already gone, then the segment once the files count
 * and the context have gone too.
 */
export function coverageSegment(
	coverage: NarrativeCoverage | null,
	terminalWidth: number,
): string | null {
	if (!coverage || terminalWidth < TINY_BAR_WIDTH) return null;
	const counts = `${coverage.narrated}/${coverage.total}`;
	const hunks = terminalWidth < NARROW_BAR_WIDTH ? "" : " hunks";
	return ` ${coverage.label} · ${counts}${hunks} `;
}

export function StatusBar({
	context,
	reviewedFiles,
	totalFiles,
	coverage,
	openThreads,
	viewMode,
	notice,
	terminalWidth,
}: {
	context: string;
	reviewedFiles: number;
	totalFiles: number;
	coverage: NarrativeCoverage | null;
	openThreads: number;
	viewMode: "patch" | "semantic";
	notice: StatusNotice | null;
	terminalWidth: number;
}) {
	const theme = useTheme();
	const arrows = powerlineArrows(process.env);
	const wide = terminalWidth >= WIDE_BAR_WIDTH;
	const narrow = terminalWidth < NARROW_BAR_WIDTH;
	const tiny = terminalWidth < TINY_BAR_WIDTH;
	const bar = gauge(reviewedFiles, totalFiles, GAUGE_WIDTH);
	const coverageText = coverageSegment(coverage, terminalWidth);
	const boundary = bar.indexOf("▱");
	const filled = boundary === -1 ? bar : bar.slice(0, boundary);
	const empty = boundary === -1 ? "" : bar.slice(boundary);
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
			{tiny ? null : (
				<text flexShrink={0} fg={theme.text} bg={theme.panel}>
					{` ${reviewedFiles}/${totalFiles} files `}
				</text>
			)}
			{coverageText ? (
				<text flexShrink={0} fg={theme.muted} bg={theme.panel}>
					{coverageText}
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
				) : null}
			</box>
			{arrows ? (
				<text flexShrink={0} fg={theme.panelAlt}>
					{LEFT_ARROW}
				</text>
			) : null}
			{!narrow && openThreads > 0 ? (
				<text flexShrink={0} fg={theme.badgeModified} bg={theme.panelAlt}>
					{` ${openThreads} ${openThreads === 1 ? "thread" : "threads"} │`}
				</text>
			) : null}
			{narrow ? null : (
				<text flexShrink={0} fg={theme.muted} bg={theme.panelAlt}>
					{` ${viewMode === "patch" ? "Patch" : "Semantic"} │`}
				</text>
			)}
			<text flexShrink={0} fg={theme.muted} bg={theme.panelAlt}>
				{tiny ? " ? · q " : " ? help · q quit "}
			</text>
		</box>
	);
}
