import { expect, test } from "bun:test";
import { chapterReferenceCopy } from "./narrationCopy.ts";

test("a referenced quote leads with the chapter and quotes every prose line", () => {
	const { text, notice } = chapterReferenceCopy({
		reference: { order: 3, title: "Wire org ID through the API layer" },
		text: "Now that the schema carries org_id,\n\nthe handlers thread it through.  ",
	});

	expect(text).toBe(
		[
			"Ch 3 · Wire org ID through the API layer",
			"> Now that the schema carries org_id,",
			">",
			"> the handlers thread it through.",
		].join("\n"),
	);
	expect(notice).toBe("Copied narration · Ch 3");
});
