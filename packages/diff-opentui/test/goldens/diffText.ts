type Edit = { sign: " " | "-" | "+"; text: string };

type Lcs = { lengths: Int32Array; columns: number };

const at = ({ lengths, columns }: Lcs, row: number, column: number): number =>
	lengths[row * columns + column] ?? 0;

/** Longest-common-subsequence lengths over lines; goldens are small enough for O(n*m). */
const lcs = (left: readonly string[], right: readonly string[]): Lcs => {
	const columns = right.length + 1;
	const table: Lcs = { lengths: new Int32Array((left.length + 1) * columns), columns };
	for (let row = left.length - 1; row >= 0; row -= 1) {
		for (let column = right.length - 1; column >= 0; column -= 1) {
			table.lengths[row * columns + column] =
				left[row] === right[column]
					? at(table, row + 1, column + 1) + 1
					: Math.max(at(table, row + 1, column), at(table, row, column + 1));
		}
	}
	return table;
};

const editScript = (left: readonly string[], right: readonly string[]): Edit[] => {
	const table = lcs(left, right);
	const edits: Edit[] = [];
	let row = 0;
	let column = 0;
	while (row < left.length || column < right.length) {
		const takeLeft =
			row < left.length &&
			(column === right.length || at(table, row + 1, column) >= at(table, row, column + 1));
		if (row < left.length && column < right.length && left[row] === right[column]) {
			edits.push({ sign: " ", text: left[row] ?? "" });
			row += 1;
			column += 1;
		} else if (takeLeft) {
			edits.push({ sign: "-", text: left[row] ?? "" });
			row += 1;
		} else {
			edits.push({ sign: "+", text: right[column] ?? "" });
			column += 1;
		}
	}
	return edits;
};

const CONTEXT_LINES = 2;

const nearChange = (edits: readonly Edit[], index: number): boolean =>
	edits
		.slice(Math.max(0, index - CONTEXT_LINES), index + CONTEXT_LINES + 1)
		.some((edit) => edit.sign !== " ");

/**
 * A unified diff of two texts, elided to the lines around each change so a failed
 * golden reads as "what moved" rather than as the whole frame.
 */
export const unifiedDiff = (expected: string, actual: string): string => {
	const edits = editScript(expected.split("\n"), actual.split("\n"));
	const shown = edits.map((edit, index) =>
		nearChange(edits, index) ? `${edit.sign} ${edit.text}` : null,
	);
	const lines: string[] = [];
	shown.forEach((line, index) => {
		if (line !== null) lines.push(line);
		else if (shown[index - 1] !== null) lines.push("  ...");
	});
	return lines.join("\n");
};
