import type { DiffSelection } from "@revue/diff";
import type { DiffInlineAttachmentPlacement } from "@revue/diff-opentui";

export type SelectionSideClass = "old" | "new" | "mixed";

/** One shared side classification for draft wording and inline thread placement. */
export const classifySelectionSides = (selection: DiffSelection): SelectionSideClass => {
	const old = selection.ranges.some((range) => range.side === "deletions");
	const current = selection.ranges.some((range) => range.side === "additions");
	if (old && current) return "mixed";
	return old ? "old" : "new";
};

export const selectionSideLabel = (selection: DiffSelection): string => {
	switch (classifySelectionSides(selection)) {
		case "old":
			return "old lines";
		case "new":
			return "new lines";
		case "mixed":
			return "old + new lines";
	}
};

export const selectionAttachmentPlacement = (
	selection: DiffSelection,
): DiffInlineAttachmentPlacement => {
	switch (classifySelectionSides(selection)) {
		case "old":
			return "deletions";
		case "new":
			return "additions";
		case "mixed":
			return "full";
	}
};
