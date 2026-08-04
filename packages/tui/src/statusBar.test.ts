import { describe, expect, test } from "bun:test";
import { gauge, powerlineArrows } from "./statusBar.tsx";

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
