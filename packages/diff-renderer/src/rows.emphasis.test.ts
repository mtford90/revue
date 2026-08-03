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
