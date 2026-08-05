import { expect, test } from "bun:test";
import type { RenderSpan } from "./types.ts";
import { columnWidth, wrappedRowCount, wrapSpans } from "./wrap.ts";

const texts = (rows: RenderSpan[][]): string[][] => rows.map((row) => row.map((span) => span.text));

test("a line shorter than the budget keeps its single visual row", () => {
	expect(wrapSpans([{ text: "const value = 1;" }], 40)).toEqual([[{ text: "const value = 1;" }]]);
});

test("an empty line still occupies one visual row", () => {
	expect(wrapSpans([], 40)).toEqual([[]]);
	expect(wrappedRowCount([], 40)).toBe(1);
});

test("long text splits at exact column boundaries", () => {
	expect(texts(wrapSpans([{ text: "abcdefghij" }], 4))).toEqual([["abcd"], ["efgh"], ["ij"]]);
});

test("text filling the budget exactly leaves no trailing blank row", () => {
	expect(texts(wrapSpans([{ text: "abcdefgh" }], 4))).toEqual([["abcd"], ["efgh"]]);
	expect(wrappedRowCount([{ text: "abcdefgh" }], 4)).toBe(2);
});

test("a span crossing a wrap point paints on both visual rows", () => {
	const spans: RenderSpan[] = [
		{ text: "keep " },
		{ text: "emphasised", fg: "#00ff00", bg: "#003300", bold: true },
		{ text: " tail" },
	];
	expect(wrapSpans(spans, 10)).toEqual([
		[{ text: "keep " }, { text: "empha", fg: "#00ff00", bg: "#003300", bold: true }],
		[{ text: "sised", fg: "#00ff00", bg: "#003300", bold: true }, { text: " tail" }],
	]);
});

test("expanded tabs wrap as the two columns they render as", () => {
	// Cells arrive tab-expanded, so wrapping only ever sees the spaces.
	expect(texts(wrapSpans([{ text: "  indented body" }], 6))).toEqual([
		["  inde"],
		["nted b"],
		["ody"],
	]);
});

test("wide characters count two columns and never split", () => {
	expect(columnWidth("日本語")).toBe(6);
	expect(texts(wrapSpans([{ text: "日本語ab" }], 5))).toEqual([["日本"], ["語ab"]]);
});

test("a wide character that would straddle the boundary moves down whole", () => {
	expect(texts(wrapSpans([{ text: "a日本" }], 4))).toEqual([["a日"], ["本"]]);
});

test("an emoji cluster stays intact even when it outgrows the budget", () => {
	expect(texts(wrapSpans([{ text: "👨‍👩‍👧x" }], 1))).toEqual([["👨‍👩‍👧"], ["x"]]);
});

test("row counts agree with the rows actually produced", () => {
	const cases: { spans: RenderSpan[]; width: number }[] = [
		{ spans: [{ text: "" }], width: 5 },
		{ spans: [{ text: "abcde" }], width: 5 },
		{ spans: [{ text: "abcdef" }], width: 5 },
		{ spans: [{ text: "ab" }, { text: "cdefgh" }], width: 4 },
		{ spans: [{ text: "日本語です" }], width: 4 },
	];
	for (const { spans, width } of cases) {
		expect(wrappedRowCount(spans, width)).toBe(wrapSpans(spans, width).length);
	}
});

test("a nonsensical budget still wraps one column at a time rather than stalling", () => {
	expect(texts(wrapSpans([{ text: "abc" }], 0))).toEqual([["a"], ["b"], ["c"]]);
	expect(wrappedRowCount([{ text: "abc" }], -4)).toBe(3);
});
