import type { DecorationAnchor, DiffFileInput, DiffSide, RangeDecoration } from "./types.ts";

export function rangeToHunkIndex(
	file: DiffFileInput,
	range: Pick<RangeDecoration, "side" | "startLine" | "endLine">,
): number {
	return file.metadata.hunks.findIndex((hunk) => {
		const start = range.side === "additions" ? hunk.additionStart : hunk.deletionStart;
		const count = range.side === "additions" ? hunk.additionCount : hunk.deletionCount;
		if (count === 0) return false;
		return range.startLine <= start + count - 1 && range.endLine >= start;
	});
}

export function applicableDecorations(
	file: DiffFileInput,
	decorations: readonly RangeDecoration[],
): RangeDecoration[] {
	const path = file.path ?? file.metadata.name;
	return decorations.filter(
		(range) =>
			range.filePath === path &&
			Number.isInteger(range.startLine) &&
			Number.isInteger(range.endLine) &&
			range.startLine > 0 &&
			range.endLine >= range.startLine &&
			rangeToHunkIndex(file, range) >= 0,
	);
}

export function findFocusedDecorationAnchor(
	file: DiffFileInput,
	decorations: readonly RangeDecoration[],
	focusedDecorationId: string,
): DecorationAnchor | null {
	for (const range of applicableDecorations(file, decorations)) {
		if (range.id !== focusedDecorationId && range.focusId !== focusedDecorationId) continue;
		const hunkIndex = rangeToHunkIndex(file, range);
		const hunk = file.metadata.hunks[hunkIndex];
		if (!hunk) continue;
		const sideStart = range.side === "additions" ? hunk.additionStart : hunk.deletionStart;
		return {
			decorationId: range.id,
			focusId: range.focusId ?? range.id,
			fileId: file.id,
			filePath: file.path ?? file.metadata.name,
			hunkIndex,
			side: range.side,
			lineNumber: Math.max(range.startLine, sideStart),
		};
	}
	return null;
}

export function decorationsAtLine(
	decorations: readonly RangeDecoration[],
	side: DiffSide,
	lineNumber: number | undefined,
): RangeDecoration[] {
	if (lineNumber === undefined) return [];
	return decorations.filter(
		(range) => range.side === side && range.startLine <= lineNumber && lineNumber <= range.endLine,
	);
}
