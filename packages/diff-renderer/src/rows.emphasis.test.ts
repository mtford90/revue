import { expect, test } from "bun:test";
import { parsePatch } from "@revue/diff-model";
import { buildDiffRows } from "./rows.ts";

const patch = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,1 +1,1 @@
-const value = 1;
+const value = 42;
`;

test("emphasis splits changed lines into dim base and glowing novel tokens", () => {
	const [file] = parsePatch(patch);
	if (!file) throw new Error("patch must parse");
	const rows = buildDiffRows(file, "stack", {
		emphasis: {
			rangesFor: (side, line) =>
				side === "additions" && line === 1 ? [{ start: 14, end: 16 }] : undefined,
			deletionsFg: "#ff0000",
			additionsFg: "#00ff00",
		},
	});
	const addition = rows.flatMap((row) =>
		row.type === "stack-line" && row.cell.kind === "addition" ? [row.cell] : [],
	)[0];
	expect(addition?.spans).toEqual([
		{ text: "const value = ", dim: true },
		{ text: "42", fg: "#00ff00", bold: true },
		{ text: ";", dim: true },
	]);
	const deletion = rows.flatMap((row) =>
		row.type === "stack-line" && row.cell.kind === "deletion" ? [row.cell] : [],
	)[0];
	expect(deletion?.spans).toEqual([{ text: "-const value = 1;".slice(1) }]);
});

const intralineEmphasis = { deletionsBg: "#3d0a0a", additionsBg: "#0a3d0a" };

const pairingPatch = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,3 +1,2 @@
 const untouched = 0;
-const value = 1;
-orphan();
+const value = 42;
`;

const parseOne = (source: string) => {
	const [file] = parsePatch(source);
	if (!file) throw new Error("patch must parse");
	return file;
};

const cellsOfKind = (rows: ReturnType<typeof buildDiffRows>, kind: string) =>
	rows.flatMap((row) => {
		if (row.type === "stack-line") return row.cell.kind === kind ? [row.cell] : [];
		if (row.type !== "split-line") return [];
		return [row.old, row.new].filter((cell) => cell.kind === kind);
	});

test.each(["split", "stack"] as const)(
	"paired change lines take intra-line backgrounds in %s layout",
	(layout) => {
		const rows = buildDiffRows(parseOne(pairingPatch), layout, { intralineEmphasis });

		expect(cellsOfKind(rows, "addition").map((cell) => cell.spans)).toEqual([
			[{ text: "const value = " }, { text: "42", bg: "#0a3d0a" }, { text: ";" }],
		]);
		expect(cellsOfKind(rows, "deletion").map((cell) => cell.spans)).toEqual([
			[{ text: "const value = " }, { text: "1", bg: "#3d0a0a" }, { text: ";" }],
			[{ text: "orphan();" }],
		]);
		expect(cellsOfKind(rows, "context").map((cell) => cell.spans)).toEqual(
			cellsOfKind(rows, "context").map(() => [{ text: "const untouched = 0;" }]),
		);
	},
);

test("novel emphasis replaces the intra-line backgrounds it overlaps", () => {
	const rows = buildDiffRows(parseOne(pairingPatch), "stack", {
		intralineEmphasis,
		emphasis: {
			rangesFor: (side, line) =>
				side === "additions" && line === 2 ? [{ start: 6, end: 11 }] : undefined,
			deletionsFg: "#ff0000",
			additionsFg: "#00ff00",
		},
	});

	expect(cellsOfKind(rows, "addition").map((cell) => cell.spans)).toEqual([
		[
			{ text: "const ", dim: true },
			{ text: "value", fg: "#00ff00", bold: true },
			{ text: " = 42;", dim: true },
		],
	]);
	expect(cellsOfKind(rows, "deletion")[0]?.spans).toEqual([
		{ text: "const value = " },
		{ text: "1", bg: "#3d0a0a" },
		{ text: ";" },
	]);
});

test("intra-line backgrounds line up with tab-expanded columns", () => {
	const [file] = parsePatch(`diff --git a/tabs.ts b/tabs.ts
--- a/tabs.ts
+++ b/tabs.ts
@@ -1 +1 @@
-\tconst value = 1;
+\tconst value = 42;
`);
	if (!file) throw new Error("patch must parse");
	const rows = buildDiffRows(file, "stack", { intralineEmphasis });
	const addition = cellsOfKind(rows, "addition")[0];

	expect(addition?.spans).toEqual([
		{ text: "  const value = " },
		{ text: "42", bg: "#0a3d0a" },
		{ text: ";" },
	]);
});
