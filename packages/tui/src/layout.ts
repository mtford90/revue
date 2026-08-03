import type { DiffFileInput, DiffLayout } from "@revue/diff-renderer";

export type SidebarPreference = "auto" | "shown" | "hidden";
export type DiffLayoutPreference = "auto" | "split" | "stacked";

const CHAPTER_PANEL_MIN_WIDTH = 28;
const CHAPTER_PANEL_DEFAULT_WIDTH_FRACTION = 0.3;
const CHAPTER_PANEL_MAX_WIDTH_FRACTION = 0.5;
const MIN_CHAPTER_PANEL_TERMINAL_WIDTH = Math.ceil(
	CHAPTER_PANEL_MIN_WIDTH / CHAPTER_PANEL_MAX_WIDTH_FRACTION,
);
const MIN_CONTENT_WIDTH = 20;
const MIN_SPLIT_DIFF_WIDTH = 80;
/**
 * The panel only earns its columns while the diff beside it could still go
 * side-by-side. Below that it is taking room from the thing under review.
 */
const MIN_USEFUL_CONTENT_WIDTH = MIN_SPLIT_DIFF_WIDTH;
const CONTENT_CHROME_WIDTH = 4;

const panelWidthBounds = (terminalWidth: number) => ({
	min: CHAPTER_PANEL_MIN_WIDTH,
	max: Math.max(
		CHAPTER_PANEL_MIN_WIDTH,
		Math.floor(terminalWidth * CHAPTER_PANEL_MAX_WIDTH_FRACTION),
	),
});

export const resolvePanelWidth = (terminalWidth: number, requestedWidth: number) => {
	const { min, max } = panelWidthBounds(terminalWidth);
	return Math.min(max, Math.max(min, requestedWidth));
};

export const defaultPanelWidth = (terminalWidth: number) =>
	resolvePanelWidth(
		terminalWidth,
		Math.round(terminalWidth * CHAPTER_PANEL_DEFAULT_WIDTH_FRACTION),
	);

const contentWidthFor = (terminalWidth: number, sidebarWidth: number) =>
	Math.max(MIN_CONTENT_WIDTH, terminalWidth - sidebarWidth - CONTENT_CHROME_WIDTH);

export type ResolvedLayout = {
	showSidebar: boolean;
	sidebarWidth: number;
	contentWidth: number;
	splitFits: boolean;
	/** Whether asking for a split would seat one, sidebar yielding included. */
	splitReachable: boolean;
};

type LayoutRequest = {
	terminalWidth: number;
	requestedSidebarWidth: number;
	sidebar: SidebarPreference;
	diff: DiffLayoutPreference;
};

const settle = ({ terminalWidth, requestedSidebarWidth, sidebar, diff }: LayoutRequest) => {
	const sidebarWidth = resolvePanelWidth(terminalWidth, requestedSidebarWidth);
	const roomForSidebar = terminalWidth >= MIN_CHAPTER_PANEL_TERMINAL_WIDTH;
	// Measured against the default width, not the requested one, so dragging the
	// divider can never make the panel vanish out from under the pointer. The
	// chapter's narrative stacks above the diff when the panel is away, so this
	// only decides whether two columns are worth it — not whether it is readable.
	const worthSidebar =
		contentWidthFor(terminalWidth, defaultPanelWidth(terminalWidth)) >= MIN_USEFUL_CONTENT_WIDTH;
	const wanted = sidebar === "hidden" ? false : sidebar === "shown" ? true : worthSidebar;
	// An asked-for split outranks a sidebar the reviewer never asked for: over a
	// wide band of terminal widths, yielding the panel is the only way to seat
	// two panes at all. An explicit sidebar preference is never overridden.
	const yieldToSplit =
		wanted &&
		sidebar === "auto" &&
		diff === "split" &&
		contentWidthFor(terminalWidth, sidebarWidth) < MIN_SPLIT_DIFF_WIDTH &&
		contentWidthFor(terminalWidth, 0) >= MIN_SPLIT_DIFF_WIDTH;
	const showSidebar = wanted && roomForSidebar && !yieldToSplit;
	const contentWidth = contentWidthFor(terminalWidth, showSidebar ? sidebarWidth : 0);
	return {
		showSidebar,
		sidebarWidth,
		contentWidth,
		splitFits: contentWidth >= MIN_SPLIT_DIFF_WIDTH,
	};
};

/**
 * The sidebar and a side-by-side diff compete for the same columns, so both
 * preferences have to be settled together against one width budget.
 */
export const resolveLayout = (request: LayoutRequest): ResolvedLayout => {
	const resolved = settle(request);
	return {
		...resolved,
		splitReachable:
			request.diff === "split"
				? resolved.splitFits
				: settle({ ...request, diff: "split" }).splitFits,
	};
};

/**
 * Under `auto`, side-by-side only earns its half of the terminal when both
 * sides have changed lines; a new or deleted file would otherwise face a blank
 * pane. An explicit preference skips that test.
 */
export const layoutForFile = ({
	file,
	preference,
	splitFits,
}: {
	file: DiffFileInput;
	preference: DiffLayoutPreference;
	splitFits: boolean;
}): DiffLayout => {
	if (preference === "stacked" || !splitFits) return "stack";
	if (preference === "split") return "split";
	const changes = file.metadata.hunks.flatMap((hunk) => hunk.hunkContent);
	const deletions = changes.reduce(
		(total, change) => total + (change.type === "context" ? 0 : change.deletions),
		0,
	);
	const additions = changes.reduce(
		(total, change) => total + (change.type === "context" ? 0 : change.additions),
		0,
	);
	return deletions > 0 && additions > 0 ? "split" : "stack";
};
