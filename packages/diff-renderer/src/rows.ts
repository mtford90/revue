import { applicableDecorations, decorationsAtLine } from "./decorations.ts";
import { highlightedLines } from "./highlight.ts";
import { sanitizeTerminalLine, sanitizeTerminalSpans } from "./terminalText.ts";
import type {
	DiffCell,
	DiffFile,
	DiffLayout,
	DiffRow,
	DiffSide,
	RangeDecoration,
	RenderSpan,
} from "./types.ts";

const cleanLine = (line: string | undefined) =>
	sanitizeTerminalLine((line ?? "").replace(/\r?\n$/, "")).replaceAll("\t", "  ");

function makeCell({
	kind,
	text,
	spans,
	oldLineNumber,
	newLineNumber,
	decorations,
	focusedDecorationId,
}: {
	kind: DiffCell["kind"];
	text?: string;
	spans?: RenderSpan[];
	oldLineNumber?: number;
	newLineNumber?: number;
	decorations: readonly RangeDecoration[];
	focusedDecorationId?: string;
}): DiffCell {
	const oldRanges = decorationsAtLine(decorations, "deletions", oldLineNumber);
	const newRanges = decorationsAtLine(decorations, "additions", newLineNumber);
	const isFocused = (range: RangeDecoration) =>
		focusedDecorationId !== undefined &&
		(range.id === focusedDecorationId || range.focusId === focusedDecorationId);
	const safeText = cleanLine(text);
	return {
		kind,
		text: safeText,
		spans: spans?.length ? sanitizeTerminalSpans(spans) : safeText ? [{ text: safeText }] : [],
		oldLineNumber,
		newLineNumber,
		decorations: {
			deletions: oldRanges.map((range) => range.id),
			additions: newRanges.map((range) => range.id),
		},
		focusedSides: [
			oldRanges.some(isFocused) ? "deletions" : undefined,
			newRanges.some(isFocused) ? "additions" : undefined,
		].filter(Boolean) as DiffSide[],
	};
}

const emptyCell = (): DiffCell => ({
	kind: "empty",
	text: "",
	spans: [],
	decorations: {},
	focusedSides: [],
});

function headerText(hunk: DiffFile["metadata"]["hunks"][number]) {
	return (
		hunk.hunkSpecs ??
		`@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@${hunk.hunkContext ? ` ${hunk.hunkContext}` : ""}`
	);
}

/** Expand Pierre metadata into stable split or stack rows with old/new identities. */
export function buildDiffRows(
	file: DiffFile,
	layout: DiffLayout,
	decorations: readonly RangeDecoration[] = [],
	focusedDecorationId?: string,
): DiffRow[] {
	const rows: DiffRow[] = [];
	const ranges = applicableDecorations(file, decorations);
	const highlighted = highlightedLines(file);

	for (const [hunkIndex, hunk] of file.metadata.hunks.entries()) {
		rows.push({
			type: "hunk-header",
			key: `${file.id}:header:${hunkIndex}`,
			hunkIndex,
			text: headerText(hunk),
		});
		let deletionIndex = hunk.deletionLineIndex;
		let additionIndex = hunk.additionLineIndex;
		let oldLine = hunk.deletionStart;
		let newLine = hunk.additionStart;

		for (const content of hunk.hunkContent) {
			if (content.type === "context") {
				for (let offset = 0; offset < content.lines; offset += 1) {
					const common = {
						kind: "context" as const,
						text: file.metadata.additionLines[additionIndex + offset],
						spans: highlighted?.additions[additionIndex + offset],
						oldLineNumber: oldLine + offset,
						newLineNumber: newLine + offset,
						decorations: ranges,
						focusedDecorationId,
					};
					if (layout === "split") {
						rows.push({
							type: "split-line",
							key: `${file.id}:split:${hunkIndex}:context:${deletionIndex + offset}:${additionIndex + offset}`,
							hunkIndex,
							old: makeCell({ ...common, newLineNumber: undefined }),
							new: makeCell({ ...common, oldLineNumber: undefined }),
						});
					} else {
						rows.push({
							type: "stack-line",
							key: `${file.id}:stack:${hunkIndex}:context:${additionIndex + offset}`,
							hunkIndex,
							cell: makeCell(common),
						});
					}
				}
				deletionIndex += content.lines;
				additionIndex += content.lines;
				oldLine += content.lines;
				newLine += content.lines;
				continue;
			}

			if (layout === "split") {
				for (let offset = 0; offset < Math.max(content.deletions, content.additions); offset += 1) {
					rows.push({
						type: "split-line",
						key: `${file.id}:split:${hunkIndex}:change:${deletionIndex + offset}:${additionIndex + offset}`,
						hunkIndex,
						old:
							offset < content.deletions
								? makeCell({
										kind: "deletion",
										text: file.metadata.deletionLines[deletionIndex + offset],
										spans: highlighted?.deletions[deletionIndex + offset],
										oldLineNumber: oldLine + offset,
										decorations: ranges,
										focusedDecorationId,
									})
								: emptyCell(),
						new:
							offset < content.additions
								? makeCell({
										kind: "addition",
										text: file.metadata.additionLines[additionIndex + offset],
										spans: highlighted?.additions[additionIndex + offset],
										newLineNumber: newLine + offset,
										decorations: ranges,
										focusedDecorationId,
									})
								: emptyCell(),
					});
				}
			} else {
				for (let offset = 0; offset < content.deletions; offset += 1) {
					rows.push({
						type: "stack-line",
						key: `${file.id}:stack:${hunkIndex}:deletion:${deletionIndex + offset}`,
						hunkIndex,
						cell: makeCell({
							kind: "deletion",
							text: file.metadata.deletionLines[deletionIndex + offset],
							spans: highlighted?.deletions[deletionIndex + offset],
							oldLineNumber: oldLine + offset,
							decorations: ranges,
							focusedDecorationId,
						}),
					});
				}
				for (let offset = 0; offset < content.additions; offset += 1) {
					rows.push({
						type: "stack-line",
						key: `${file.id}:stack:${hunkIndex}:addition:${additionIndex + offset}`,
						hunkIndex,
						cell: makeCell({
							kind: "addition",
							text: file.metadata.additionLines[additionIndex + offset],
							spans: highlighted?.additions[additionIndex + offset],
							newLineNumber: newLine + offset,
							decorations: ranges,
							focusedDecorationId,
						}),
					});
				}
			}
			deletionIndex += content.deletions;
			additionIndex += content.additions;
			oldLine += content.deletions;
			newLine += content.additions;
		}
	}
	return rows;
}
