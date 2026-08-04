import { expect, test } from "bun:test";
import { keyChangeSchema } from "../src/chapters.ts";

const keyChange = {
	content: "Should this retry budget be shared?",
	lineRefs: [
		{
			filePath: "src/retry.ts",
			side: "additions" as const,
			startLine: 4,
			endLine: 6,
		},
	],
};

test("key changes carry explicit severity while old runs default to info", () => {
	expect(keyChangeSchema.parse(keyChange).severity).toBe("info");
	expect(keyChangeSchema.parse({ ...keyChange, severity: "high" }).severity).toBe("high");
});
