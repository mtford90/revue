import type { DiffFileInput } from "@revue/diff";

// GitHub-style incremental context expansion. Each gap between hunks (and above
// the first / below the last) is a numbered boundary; revealing lines widens the
// synthesised patch, which re-parses through the ordinary rendering pipeline.

export const CONTEXT_STEP = 20;

export type ExpandAction = "up" | "down" | "all";

export type BoundaryExpansion = { up: number; down: number };

/** Revealed context per boundary: 0 sits above the first hunk, hunkCount below the last. */
export type FileExpansion = Map<number, BoundaryExpansion>;

type HunkMetadata = DiffFileInput["metadata"]["hunks"][number];

export const splitFileLines = (text: string): string[] => {
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
};

/** First new-file line the hunk occupies; a pure deletion anchors to the line after its position. */
const newTop = (hunk: HunkMetadata): number =>
	hunk.additionCount ? hunk.additionStart : hunk.additionStart + 1;

/** Last new-file line the hunk occupies; below newTop when the hunk adds nothing. */
const newBottom = (hunk: HunkMetadata): number =>
	hunk.additionStart + Math.max(0, hunk.additionCount - 1);

const oldTop = (hunk: HunkMetadata): number =>
	hunk.deletionCount ? hunk.deletionStart : hunk.deletionStart + 1;

/** Unrevealed unchanged lines left inside a boundary's gap, in new-file coordinates. */
export function remainingGap(
	hunks: readonly HunkMetadata[],
	expansion: FileExpansion | undefined,
	totalNewLines: number,
	boundary: number,
): number {
	const first = hunks[0];
	const last = hunks[hunks.length - 1];
	if (!first || !last) return 0;
	const gap =
		boundary === 0
			? newTop(first) - 1
			: boundary === hunks.length
				? totalNewLines - newBottom(last)
				: (() => {
						const above = hunks[boundary - 1];
						const below = hunks[boundary];
						return above && below ? newTop(below) - newBottom(above) - 1 : 0;
					})();
	const revealed = expansion?.get(boundary) ?? { up: 0, down: 0 };
	return Math.max(0, gap - revealed.up - revealed.down);
}

/**
 * The controls a boundary offers: directional steps while the gap is large,
 * a single reveal-everything action once one click would close it.
 */
export function boundaryActions(
	hunks: readonly HunkMetadata[],
	expansion: FileExpansion | undefined,
	totalNewLines: number,
	boundary: number,
): ExpandAction[] {
	const remaining = remainingGap(hunks, expansion, totalNewLines, boundary);
	if (remaining <= 0) return [];
	if (remaining <= CONTEXT_STEP) return ["all"];
	const actions: ExpandAction[] = [];
	if (boundary > 0) actions.push("down");
	if (boundary < hunks.length) actions.push("up");
	return actions;
}

/** Apply one expander click; `up` reveals the bottom of the gap, `down` its top. */
export function expandBoundary(
	hunks: readonly HunkMetadata[],
	expansion: FileExpansion | undefined,
	totalNewLines: number,
	boundary: number,
	action: ExpandAction,
): FileExpansion {
	const remaining = remainingGap(hunks, expansion, totalNewLines, boundary);
	const current = expansion?.get(boundary) ?? { up: 0, down: 0 };
	const step = action === "all" ? remaining : Math.min(CONTEXT_STEP, remaining);
	// "all" must land on a side a hunk actually renders: below the last hunk only
	// `down` exists; everywhere else the lower hunk absorbs the gap upward.
	const next: BoundaryExpansion =
		action === "down" || (action === "all" && boundary === hunks.length)
			? { ...current, down: current.down + step }
			: { ...current, up: current.up + step };
	const result = new Map(expansion ?? []);
	result.set(boundary, next);
	return result;
}

const stripEol = (line: string | undefined): string => (line ?? "").replace(/\r?\n$/, "");

/** The hunk's original unified body, reconstructed from Pierre's parsed groups. */
const hunkBody = (file: DiffFileInput, hunk: HunkMetadata): string[] => {
	const { deletionLines, additionLines } = file.metadata;
	const body: string[] = [];
	for (const content of hunk.hunkContent) {
		if (content.type === "context") {
			for (let index = 0; index < content.lines; index += 1) {
				body.push(` ${stripEol(additionLines[content.additionLineIndex + index])}`);
			}
		} else {
			for (let index = 0; index < content.deletions; index += 1) {
				body.push(`-${stripEol(deletionLines[content.deletionLineIndex + index])}`);
			}
			for (let index = 0; index < content.additions; index += 1) {
				body.push(`+${stripEol(additionLines[content.additionLineIndex + index])}`);
			}
		}
	}
	return body;
};

/**
 * The file's patch with each hunk widened by its revealed context. Context comes
 * from the pinned new blob; unchanged regions exist identically in both versions,
 * so old line numbers follow from the hunk's own offset. Hunks never merge — a
 * fully revealed gap simply leaves two hunks touching.
 */
export function expandedPatchText({
	file,
	newLines,
	expansion,
}: {
	file: DiffFileInput;
	newLines: readonly string[];
	expansion: FileExpansion;
}): string {
	const path = file.path ?? file.metadata.name;
	const oldPath = file.previousPath ?? path;
	const out: string[] = [`--- a/${oldPath}`, `+++ b/${path}`];
	for (const [index, hunk] of file.metadata.hunks.entries()) {
		const upExtent = expansion.get(index)?.up ?? 0;
		const downExtent = expansion.get(index + 1)?.down ?? 0;
		const oldCount = hunk.deletionCount + upExtent + downExtent;
		const additionCount = hunk.additionCount + upExtent + downExtent;
		const oldStart = oldCount ? oldTop(hunk) - upExtent : hunk.deletionStart;
		const additionStart = additionCount ? newTop(hunk) - upExtent : hunk.additionStart;
		out.push(
			`@@ -${oldStart},${oldCount} +${additionStart},${additionCount} @@${hunk.hunkContext ? ` ${hunk.hunkContext}` : ""}`,
		);
		for (let line = newTop(hunk) - upExtent; line < newTop(hunk); line += 1) {
			out.push(` ${newLines[line - 1] ?? ""}`);
		}
		out.push(...hunkBody(file, hunk));
		for (let line = newBottom(hunk) + 1; line <= newBottom(hunk) + downExtent; line += 1) {
			out.push(` ${newLines[line - 1] ?? ""}`);
		}
	}
	return `${out.join("\n")}\n`;
}
