import type { DiffChromeWidths, DiffPlanStyles } from "@revue/diff";
import type { Theme } from "@revue/theme";

/** Map Revue's application theme into the engine's presentation-neutral style slots. */
export const diffPlanStyles = (theme: Theme): DiffPlanStyles => ({
	text: theme.text,
	contextBackground: theme.contextBg,
	additionBackground: theme.addedBg,
	deletionBackground: theme.removedBg,
	additionFocusedBackground: theme.addedContentBg,
	deletionFocusedBackground: theme.removedContentBg,
	selectedHunkBackground: theme.selectedHunk,
	intralineAdditionBackground: theme.addedEmphasisBg,
	intralineDeletionBackground: theme.removedEmphasisBg,
});

export const OPENTUI_DIFF_CHROME: DiffChromeWidths = {
	focusMarker: 1,
	attachmentMarker: 3,
	sign: 3,
	edge: 1,
	divider: 1,
	minimumCode: 8,
};
