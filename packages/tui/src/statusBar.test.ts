import { describe, expect, test } from "bun:test";
import { coverageSegment, gauge, powerlineArrows } from "./statusBar.tsx";

describe("powerlineArrows", () => {
	test("recognises terminals that bundle the glyphs", () => {
		expect(powerlineArrows({ TERM_PROGRAM: "ghostty" })).toBe(true);
		expect(powerlineArrows({ TERM_PROGRAM: "WezTerm" })).toBe(true);
		expect(powerlineArrows({ TERM_PROGRAM: "iTerm.app" })).toBe(true);
		expect(powerlineArrows({ TERM: "xterm-kitty" })).toBe(true);
	});

	test("stays plain everywhere else", () => {
		expect(powerlineArrows({ TERM_PROGRAM: "Apple_Terminal" })).toBe(false);
		expect(powerlineArrows({ TERM: "xterm-256color" })).toBe(false);
		expect(powerlineArrows({})).toBe(false);
	});
});

describe("gauge", () => {
	test("empty and full", () => {
		expect(gauge(0, 10, 8)).toBe("▱▱▱▱▱▱▱▱");
		expect(gauge(10, 10, 8)).toBe("▰▰▰▰▰▰▰▰");
	});

	test("proportional in between", () => {
		expect(gauge(5, 10, 8)).toBe("▰▰▰▰▱▱▱▱");
	});

	test("any progress shows at least one filled cell", () => {
		expect(gauge(1, 100, 8)).toBe("▰▱▱▱▱▱▱▱");
	});

	test("unfinished work never shows a full gauge", () => {
		expect(gauge(99, 100, 8)).toBe("▰▰▰▰▰▰▰▱");
	});

	test("no files reads as empty", () => {
		expect(gauge(0, 0, 8)).toBe("▱▱▱▱▱▱▱▱");
	});
});

describe("coverageSegment", () => {
	const zoomedOut = { label: "10,000ft", narrated: 12, total: 40 };

	test("a partial narrative states its label and its share of the diff", () => {
		expect(coverageSegment(zoomedOut, 110)).toBe(" 10,000ft · 12/40 hunks ");
		expect(coverageSegment({ label: "just the API changes", narrated: 9, total: 31 }, 110)).toBe(
			" just the API changes · 9/31 hunks ",
		);
	});

	test("full depth says nothing at all — it is the baseline, not a mode", () => {
		expect(coverageSegment(null, 110)).toBeNull();
		expect(coverageSegment(null, 40)).toBeNull();
	});

	test("sheds the word hunks, then itself, and only after the gauge and threads have gone", () => {
		expect(coverageSegment(zoomedOut, 76)).toBe(" 10,000ft · 12/40 hunks "); // gauge still up
		expect(coverageSegment(zoomedOut, 75)).toBe(" 10,000ft · 12/40 hunks "); // gauge gone first
		expect(coverageSegment(zoomedOut, 56)).toBe(" 10,000ft · 12/40 hunks "); // threads still up
		expect(coverageSegment(zoomedOut, 55)).toBe(" 10,000ft · 12/40 "); // threads gone, hunks next
		expect(coverageSegment(zoomedOut, 40)).toBe(" 10,000ft · 12/40 ");
		expect(coverageSegment(zoomedOut, 39)).toBeNull(); // the whole segment, last of the three
	});
});
