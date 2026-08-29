import { expect, test } from "bun:test";
import { inlineAttachmentGeometry, MIN_USABLE_INLINE_ATTACHMENT_WIDTH } from "./attachments.ts";

const split = (placement: "full" | "deletions" | "additions", old = 57, current = 58) =>
	inlineAttachmentGeometry({
		placement,
		layout: "split",
		width: old + 1 + current,
		paneWidths: { old, new: current },
	});

test("split attachment semantics map to left, right, and full adapter geometry", () => {
	expect(split("deletions")).toEqual({ offset: 0, width: 57 });
	expect(split("additions")).toEqual({ offset: 58, width: 58 });
	expect(split("full")).toEqual({ offset: 0, width: 116 });
});

test("stacked and unusably narrow split panes fall back to full width", () => {
	const pane = MIN_USABLE_INLINE_ATTACHMENT_WIDTH - 1;
	expect(split("additions", pane, pane)).toEqual({ offset: 0, width: pane * 2 + 1 });
	expect(
		inlineAttachmentGeometry({
			placement: "deletions",
			layout: "stack",
			width: 80,
			paneWidths: { old: 0, new: 80 },
		}),
	).toEqual({ offset: 0, width: 80 });
});
