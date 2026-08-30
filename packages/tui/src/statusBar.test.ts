import { describe, expect, test } from "bun:test";
import { gauge, powerlineArrows, threadsSlotText } from "./statusBar.tsx";

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

describe("threadsSlotText", () => {
	test("nothing unsent and no handoff names only the count", () => {
		expect(threadsSlotText({ open: 3, unsent: 0, sent: null }, { narrow: false })).toBe(
			"3 threads",
		);
		expect(threadsSlotText({ open: 1, unsent: 0, sent: null }, { narrow: false })).toBe("1 thread");
	});

	test("unsent feedback outranks a stale handoff", () => {
		expect(threadsSlotText({ open: 3, unsent: 2, sent: "queued" }, { narrow: false })).toBe(
			"3 threads · 2 unsent",
		);
	});

	test("a delivered handoff reads as sent, a copied one as copied, a queued one as not sent", () => {
		expect(threadsSlotText({ open: 3, unsent: 0, sent: "delivered" }, { narrow: false })).toBe(
			"3 threads · sent ✓",
		);
		expect(threadsSlotText({ open: 3, unsent: 0, sent: "queued" }, { narrow: false })).toBe(
			"3 threads · not sent ⚠",
		);
		expect(threadsSlotText({ open: 3, unsent: 0, sent: "copied" }, { narrow: false })).toBe(
			"3 threads · copied ⧉",
		);
	});

	test("narrow keeps only the state half, or the plain count when idle", () => {
		expect(threadsSlotText({ open: 3, unsent: 2, sent: null }, { narrow: true })).toBe("2 unsent");
		expect(threadsSlotText({ open: 3, unsent: 0, sent: "delivered" }, { narrow: true })).toBe(
			"sent ✓",
		);
		expect(threadsSlotText({ open: 3, unsent: 0, sent: "queued" }, { narrow: true })).toBe(
			"not sent ⚠",
		);
		expect(threadsSlotText({ open: 3, unsent: 0, sent: null }, { narrow: true })).toBe("3 threads");
	});

	test("no open threads and nothing to report reads as empty", () => {
		expect(threadsSlotText({ open: 0, unsent: 0, sent: null }, { narrow: false })).toBe("");
		expect(threadsSlotText({ open: 0, unsent: 0, sent: null }, { narrow: true })).toBe("");
	});
});
