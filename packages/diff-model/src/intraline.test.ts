import { expect, test } from "bun:test";
import { intralineSpans, pairChangedLines } from "./intraline.ts";

const pair = (oldIndex: number, newIndex: number) => ({ oldIndex, newIndex });

test("an equal-count change block pairs by position", () => {
	expect(
		pairChangedLines({
			oldLines: ["const a = 1;", "wildly different content here", "const c = 3;"],
			newLines: ["const a = 2;", "nothing alike whatsoever", "const c = 4;"],
		}),
	).toEqual([pair(0, 0), pair(1, 1), pair(2, 2)]);
});

test("an unequal block pairs the similar lines and skips the rest", () => {
	expect(
		pairChangedLines({
			oldLines: ["const a = 1;", "const b = 2;"],
			newLines: ["const a = 11;", "an entirely unrelated statement", "const b = 22;"],
		}),
	).toEqual([pair(0, 0), pair(1, 2)]);
});

test("an unequal block leaves dissimilar lines unpaired", () => {
	expect(
		pairChangedLines({
			oldLines: ["const answer = 42;"],
			newLines: ["throw new Error('boom');", "return undefined;"],
		}),
	).toEqual([]);
});

test("pairing never crosses, so the weaker of two crossed candidates is dropped", () => {
	expect(
		pairChangedLines({
			oldLines: ["banana split", "apple pie"],
			newLines: ["apple pie!", "banana split!", "cherry tart"],
		}),
	).toEqual([pair(0, 1)]);
});

test("an empty side pairs nothing", () => {
	expect(pairChangedLines({ oldLines: [], newLines: ["const a = 1;"] })).toEqual([]);
	expect(pairChangedLines({ oldLines: ["const a = 1;"], newLines: [] })).toEqual([]);
});

test("a single changed token is trimmed down to its own span", () => {
	expect(
		intralineSpans({ oldLine: "const total = count;", newLine: "const total = amount;" }),
	).toEqual({
		old: [{ start: 14, end: 19 }],
		new: [{ start: 14, end: 20 }],
	});
});

test("adjacent changed tokens merge into one span", () => {
	expect(intralineSpans({ oldLine: "if (a=1) return;", newLine: "if (a==2) return;" })).toEqual({
		old: [{ start: 6, end: 7 }],
		new: [{ start: 5, end: 8 }],
	});
});

test("an unchanged token between two edits keeps their spans apart", () => {
	expect(intralineSpans({ oldLine: "x = a + b;", newLine: "x = c * b;" })).toEqual({
		old: [
			{ start: 4, end: 5 },
			{ start: 6, end: 7 },
		],
		new: [
			{ start: 4, end: 5 },
			{ start: 6, end: 7 },
		],
	});
});

test("several edits on one line yield several spans", () => {
	expect(
		intralineSpans({
			oldLine: "const sum = first + second;",
			newLine: "const sum = alpha + omega;",
		}),
	).toEqual({
		old: [
			{ start: 12, end: 17 },
			{ start: 20, end: 26 },
		],
		new: [
			{ start: 12, end: 17 },
			{ start: 20, end: 25 },
		],
	});
});

test("an insertion marks only the added side", () => {
	expect(intralineSpans({ oldLine: "value = 1;", newLine: "value = 1 + 1;" })).toEqual({
		old: [],
		new: [{ start: 9, end: 13 }],
	});
});

test("identical lines produce no spans", () => {
	expect(intralineSpans({ oldLine: "const a = 1;", newLine: "const a = 1;" })).toEqual({
		old: [],
		new: [],
	});
});

test("a whitespace-only edit still produces spans", () => {
	expect(intralineSpans({ oldLine: "  indented();", newLine: "\tindented();" })).toEqual({
		old: [{ start: 0, end: 2 }],
		new: [{ start: 0, end: 1 }],
	});
});

test("trailing whitespace removal is emphasised on the old side alone", () => {
	expect(intralineSpans({ oldLine: "done();   ", newLine: "done();" })).toEqual({
		old: [{ start: 7, end: 10 }],
		new: [],
	});
});

test("lines beyond the tokenizing limit get no spans", () => {
	const long = `${"x".repeat(1_001)}a`;
	expect(intralineSpans({ oldLine: long, newLine: `${"x".repeat(1_001)}b` })).toEqual({
		old: [],
		new: [],
	});
	expect(intralineSpans({ oldLine: "short", newLine: long })).toEqual({ old: [], new: [] });
});

test("cjk content yields code-unit ranges over the changed run", () => {
	expect(intralineSpans({ oldLine: "label = '合計';", newLine: "label = '総計';" })).toEqual({
		old: [{ start: 9, end: 11 }],
		new: [{ start: 9, end: 11 }],
	});
});

test("an emoji swap never splits a surrogate pair", () => {
	const oldLine = "tag = 🎉 done";
	const newLine = "tag = 🎊 done";
	const spans = intralineSpans({ oldLine, newLine });
	expect(spans).toEqual({
		old: [{ start: 6, end: 8 }],
		new: [{ start: 6, end: 8 }],
	});
	expect(oldLine.slice(6, 8)).toBe("🎉");
	expect(newLine.slice(6, 8)).toBe("🎊");
});
