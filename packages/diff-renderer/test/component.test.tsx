import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { DiffBody, parsePatch } from "../src/index.ts";

const patch = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
-old one
-old two
+new one
+new two
`;

test("focused ranges render visibly on only the exact requested line", async () => {
	const file = parsePatch(patch)[0];
	if (!file) throw new Error("missing fixture");
	const t = await testRender(
		<DiffBody
			file={file}
			layout="stack"
			width={60}
			decorations={[
				{
					id: "new-two",
					focusId: "focused-key-change",
					filePath: "a.ts",
					side: "additions",
					startLine: 2,
					endLine: 2,
				},
			]}
			focusedDecorationId="focused-key-change"
		/>,
		{ width: 60, height: 10 },
	);
	await t.renderOnce();
	const lines = t.captureCharFrame().split("\n");
	const newOne = lines.find((line) => line.includes("new one"));
	const newTwo = lines.find((line) => line.includes("new two"));
	expect(newOne).not.toContain("▌");
	expect(newTwo).toContain("▌");
});
