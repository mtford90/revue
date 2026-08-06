import { expect, test } from "bun:test";
import { parsePatch } from "@revue/diff";
import {
	boundaryActions,
	expandBoundary,
	expandedPatchText,
	type FileExpansion,
	remainingGap,
	splitFileLines,
} from "./expand.ts";

// A 70-line new file with two hunks — line 21 changed and old line 56 deleted,
// three context lines each side — leaving gaps above, between, and below.
const newLines = Array.from({ length: 70 }, (_, index) => {
	const line = index + 1;
	if (line === 21) return "line 21 changed";
	return `line ${line <= 55 ? line : line + 1}`;
});
const PATCH = [
	"--- a/sample.txt",
	"+++ b/sample.txt",
	"@@ -18,7 +18,7 @@",
	" line 18",
	" line 19",
	" line 20",
	"-line 21",
	"+line 21 changed",
	" line 22",
	" line 23",
	" line 24",
	"@@ -53,7 +53,6 @@",
	" line 53",
	" line 54",
	" line 55",
	"-line 56",
	" line 57",
	" line 58",
	" line 59",
	"",
].join("\n");

const file = () => {
	const parsed = parsePatch(PATCH)[0];
	if (!parsed) throw new Error("fixture patch failed to parse");
	return parsed;
};

test("gap sizes cover the file top, inter-hunk space, and file bottom", () => {
	const hunks = file().metadata.hunks;
	expect(remainingGap(hunks, undefined, 70, 0)).toBe(17); // lines 1-17
	expect(remainingGap(hunks, undefined, 70, 1)).toBe(28); // lines 25-52
	expect(remainingGap(hunks, undefined, 70, 2)).toBe(12); // lines 59-70
});

test("large gaps offer directional steps and small gaps a single reveal", () => {
	const hunks = file().metadata.hunks;
	expect(boundaryActions(hunks, undefined, 70, 0)).toEqual(["all"]); // 17 fits one step
	expect(boundaryActions(hunks, undefined, 70, 1)).toEqual(["down", "up"]);
	expect(boundaryActions(hunks, undefined, 70, 2)).toEqual(["all"]);

	const partly = expandBoundary(hunks, undefined, 70, 1, "down");
	expect(partly.get(1)).toEqual({ up: 0, down: 20 });
	expect(boundaryActions(hunks, partly, 70, 1)).toEqual(["all"]); // 8 left

	const done = expandBoundary(hunks, partly, 70, 1, "all");
	expect(done.get(1)).toEqual({ up: 8, down: 20 });
	expect(remainingGap(hunks, done, 70, 1)).toBe(0);
	expect(boundaryActions(hunks, done, 70, 1)).toEqual([]);
});

test("widened hunks pull real lines from the blob and keep both line numberings", () => {
	const base = file();
	const expansion = expandBoundary(base.metadata.hunks, undefined, 70, 1, "up");
	const text = expandedPatchText({ file: base, newLines, expansion });
	const reparsed = parsePatch(text)[0];
	if (!reparsed) throw new Error("expanded patch failed to parse");

	const [first, second] = reparsed.metadata.hunks;
	expect(reparsed.metadata.hunks).toHaveLength(2);
	// The second hunk grew twenty context lines upward.
	expect(second?.additionStart).toBe(33);
	expect(second?.deletionStart).toBe(33);
	expect(second?.additionCount).toBe(6 + 20);
	expect(second?.deletionCount).toBe(7 + 20);
	// The first hunk is untouched.
	expect(first?.additionStart).toBe(18);
	expect(first?.additionCount).toBe(7);
	expect(text).toContain(" line 33\n");
	expect(text).toContain(" line 52\n");
	expect(text).not.toContain(" line 32\n");
});

test("expanding to the very top and bottom reaches line 1 and the EOF", () => {
	const base = file();
	const hunks = base.metadata.hunks;
	let expansion: FileExpansion = new Map();
	expansion = expandBoundary(hunks, expansion, 70, 0, "all");
	expansion = expandBoundary(hunks, expansion, 70, 2, "all");
	const text = expandedPatchText({ file: base, newLines, expansion });
	const reparsed = parsePatch(text)[0];

	const [first, second] = reparsed?.metadata.hunks ?? [];
	expect(first?.additionStart).toBe(1);
	expect(first?.deletionStart).toBe(1);
	expect((second?.additionStart ?? 0) + (second?.additionCount ?? 0) - 1).toBe(70);
	expect(text).toContain(" line 1\n");
	expect(text).toContain(" line 71\n"); // old numbering drifts past the deleted line
});

test("a pure-deletion hunk keeps its anchor while gaining context", () => {
	const deletionOnly = parsePatch(
		["--- a/only.txt", "+++ b/only.txt", "@@ -10,1 +9,0 @@", "-gone", ""].join("\n"),
	)[0];
	if (!deletionOnly) throw new Error("fixture failed to parse");
	const lines = Array.from({ length: 30 }, (_, index) => `kept ${index + 1}`);
	const expansion = expandBoundary(deletionOnly.metadata.hunks, undefined, 30, 0, "all");
	const text = expandedPatchText({ file: deletionOnly, newLines: lines, expansion });
	const reparsed = parsePatch(text)[0];
	const hunk = reparsed?.metadata.hunks[0];
	expect(hunk?.deletionCount).toBe(1 + 9);
	expect(hunk?.additionCount).toBe(9);
	expect(hunk?.additionStart).toBe(1);
	expect(text).toContain(" kept 9\n-gone\n");
});

test("splitFileLines drops only a trailing newline", () => {
	expect(splitFileLines("a\nb\n")).toEqual(["a", "b"]);
	expect(splitFileLines("a\nb")).toEqual(["a", "b"]);
	expect(splitFileLines("")).toEqual([]);
});
