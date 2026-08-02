import { expect, test } from "bun:test";
import { PrologueSchema } from "../src/prologue.ts";

const prologue = {
	motivation: null,
	outcome: null,
	diagram: null,
	keyChanges: [],
	focusAreas: [],
	complexity: { level: "low", reasoning: "Small change" },
};

test("a present prologue contains its required overview and review focus", () => {
	expect(PrologueSchema.safeParse(prologue).success).toBe(false);
	expect(
		PrologueSchema.safeParse({
			...prologue,
			keyChanges: [
				{ summary: "First outcome", description: "First piece of review context." },
				{ summary: "Second outcome", description: "Second piece of review context." },
			],
			focusAreas: [
				{
					type: "new-pattern",
					severity: "info",
					title: "New pattern",
					description: "Confirm the pattern fits existing conventions.",
					locations: ["src/example.ts"],
				},
			],
		}).success,
	).toBe(true);
});
