import { describe, expect, test } from "bun:test";
import { parsePatch } from "@revue/diff-renderer";
import {
	bodySegmentId,
	planWindow,
	type SegmentRows,
	segmentOffset,
	segmentsHeight,
	viewportSegments,
	type WindowPlanItem,
} from "./virtualRows.ts";

const uniform = (id: string, rows: number): SegmentRows => ({
	id,
	heights: Array.from({ length: rows }, () => 1),
});

const planHeight = (segments: SegmentRows[], plan: WindowPlanItem[]): number =>
	plan.reduce(
		(total, item) =>
			total +
			(item.kind === "gap"
				? item.height
				: (segments
						.find((segment) => segment.id === item.id)
						?.heights.slice(item.window.start, item.window.end)
						.reduce((sum, height) => sum + height, 0) ?? 0)),
		0,
	);

describe("segmentsHeight and segmentOffset", () => {
	const segments = [uniform("a", 5), { id: "b", heights: [2, 1, 3] }, uniform("c", 4)];

	test("totals every row height across segments", () => {
		expect(segmentsHeight(segments)).toBe(15);
	});

	test("offsets address a row from the top of the content", () => {
		expect(segmentOffset(segments, "a")).toBe(0);
		expect(segmentOffset(segments, "a", 3)).toBe(3);
		expect(segmentOffset(segments, "b")).toBe(5);
		expect(segmentOffset(segments, "b", 2)).toBe(8);
		expect(segmentOffset(segments, "c", 1)).toBe(12);
	});

	test("unknown segment resolves to null", () => {
		expect(segmentOffset(segments, "missing")).toBeNull();
	});
});

describe("planWindow", () => {
	test("keeps everything mounted when the window covers the content", () => {
		const segments = [uniform("a", 3), uniform("b", 2)];
		const plan = planWindow({ segments, scrollTop: 0, viewportHeight: 10, overscan: 0 });
		expect(plan).toEqual([
			{ kind: "rows", id: "a", window: { start: 0, end: 3 } },
			{ kind: "rows", id: "b", window: { start: 0, end: 2 } },
		]);
	});

	test("collapses fully hidden segments into merged gaps", () => {
		const segments = [uniform("a", 40), uniform("b", 40), uniform("c", 40)];
		const plan = planWindow({ segments, scrollTop: 50, viewportHeight: 10, overscan: 0 });
		expect(plan).toEqual([
			{ kind: "gap", height: 50 },
			{ kind: "rows", id: "b", window: { start: 10, end: 20 } },
			{ kind: "gap", height: 60 },
		]);
	});

	test("windows within a single large segment", () => {
		const segments = [uniform("a", 1000)];
		const plan = planWindow({ segments, scrollTop: 400, viewportHeight: 50, overscan: 20 });
		expect(plan).toEqual([
			{ kind: "gap", height: 380 },
			{ kind: "rows", id: "a", window: { start: 380, end: 470 } },
			{ kind: "gap", height: 530 },
		]);
	});

	test("spans adjacent segments across a boundary", () => {
		const segments = [uniform("a", 10), uniform("b", 10)];
		const plan = planWindow({ segments, scrollTop: 6, viewportHeight: 8, overscan: 0 });
		expect(plan).toEqual([
			{ kind: "gap", height: 6 },
			{ kind: "rows", id: "a", window: { start: 6, end: 10 } },
			{ kind: "rows", id: "b", window: { start: 0, end: 4 } },
			{ kind: "gap", height: 6 },
		]);
	});

	test("counts variable-height rows against the window", () => {
		const segments = [{ id: "a", heights: [5, 5, 5, 5] }];
		const plan = planWindow({ segments, scrollTop: 7, viewportHeight: 5, overscan: 0 });
		expect(plan).toEqual([
			{ kind: "gap", height: 5 },
			{ kind: "rows", id: "a", window: { start: 1, end: 3 } },
			{ kind: "gap", height: 5 },
		]);
	});

	test("keeps zero-height rows inside the mounted span", () => {
		const segments = [{ id: "a", heights: [1, 1, 0, 1, 1, 1] }];
		const plan = planWindow({ segments, scrollTop: 1, viewportHeight: 2, overscan: 0 });
		expect(plan).toEqual([
			{ kind: "gap", height: 1 },
			{ kind: "rows", id: "a", window: { start: 1, end: 4 } },
			{ kind: "gap", height: 2 },
		]);
	});

	test("clamps a negative window start", () => {
		const segments = [uniform("a", 30)];
		const plan = planWindow({ segments, scrollTop: 2, viewportHeight: 5, overscan: 10 });
		expect(plan).toEqual([
			{ kind: "rows", id: "a", window: { start: 0, end: 17 } },
			{ kind: "gap", height: 13 },
		]);
	});

	test("preserves total content height for arbitrary windows", () => {
		const segments = [uniform("a", 33), { id: "b", heights: [2, 4, 1, 1] }, uniform("c", 21)];
		const total = segmentsHeight(segments);
		for (const scrollTop of [0, 3, 17, 33, 40, 61, 100]) {
			const plan = planWindow({ segments, scrollTop, viewportHeight: 9, overscan: 4 });
			expect(planHeight(segments, plan)).toBe(total);
		}
	});
});

describe("viewportSegments", () => {
	test("counts a wrapped line as the visual rows it renders as", () => {
		const [file] = parsePatch(`diff --git a/wrap.ts b/wrap.ts
--- a/wrap.ts
+++ b/wrap.ts
@@ -1,1 +1,1 @@
-short
+${"y".repeat(120)}
`);
		if (!file) throw new Error("missing fixture");
		const heightsAt = (width: number) =>
			viewportSegments({
				files: [
					{ path: "wrap.ts", displayed: file, collapsed: false, separator: false, layout: "stack" },
				],
				attachments: [],
				attachmentHeight: () => 0,
				width,
			}).find((segment) => segment.id === bodySegmentId("wrap.ts"))?.heights;

		// Two gutters, the sign, and the padding either side leave 40 columns at width 54.
		expect(heightsAt(54)).toEqual([1, 1, 3, 0]);
		// A wider terminal reflows the same line back onto fewer rows.
		expect(heightsAt(134)).toEqual([1, 1, 1, 0]);
	});
});
