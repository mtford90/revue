import { expect, test } from "bun:test";
import { diffLineId, diffRangeWithin } from "./lineIds.ts";
import type { DiffLineRange } from "./types.ts";

const line = (overrides: Partial<DiffLineRange> = {}): DiffLineRange => ({
	filePath: "src/lib/backoff.ts",
	hunkOldStart: 0,
	side: "additions",
	startLine: 2,
	endLine: 2,
	...overrides,
});

test("a highlight spanning several lines becomes the range they cover", () => {
	const ids = [2, 3, 4].map((startLine) => diffLineId(line({ startLine })));
	expect(diffRangeWithin(line({ startLine: 3, endLine: 3 }), ids)).toEqual(
		line({ startLine: 2, endLine: 4 }),
	);
});

test("only the anchor's own file, side and hunk count towards the range", () => {
	const ids = [
		diffLineId(line({ startLine: 3 })),
		diffLineId(line({ startLine: 40, side: "deletions" })),
		diffLineId(line({ startLine: 41, hunkOldStart: 12 })),
		diffLineId(line({ startLine: 42, filePath: "src/lib/apiClient.ts" })),
	];
	expect(diffRangeWithin(line(), ids)).toEqual(line({ startLine: 3, endLine: 3 }));
});

test("a path holding colons survives the round trip", () => {
	const weird = line({ filePath: "src/a:b/c.ts", startLine: 7, endLine: 7 });
	expect(diffRangeWithin(weird, [diffLineId(weird)])).toEqual(weird);
});

test("a highlight touching no line of the anchor's leaves the anchor alone", () => {
	expect(diffRangeWithin(line(), [])).toBeNull();
	expect(diffRangeWithin(line(), ["some-other-renderable", ""])).toBeNull();
});
