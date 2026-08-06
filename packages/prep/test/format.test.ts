import { expect, test } from "bun:test";
import { parsePatch } from "@revue/diff";
import { RUN_FILE_STATUS, RUN_OBJECT_KIND, type RunFile } from "@revue/types";
import { formatAgentInput } from "../src/format.ts";

const PATCH = `diff --git a/file.ts b/file.ts
index 1111111..2222222 100644
--- a/file.ts
+++ b/file.ts
@@ -8,2 +8,3 @@
 keep
-old
+new
+more
\\ No newline at end of file
`;

test("agent hunks keep old/new columns without embedded patch newlines", () => {
	const [diff] = parsePatch(PATCH);
	if (!diff) throw new Error("Expected a parsed fixture file");
	const runFile: RunFile = {
		path: "file.ts",
		previousPath: null,
		status: RUN_FILE_STATUS.MODIFIED,
		oldBlob: "1".repeat(64),
		newBlob: "2".repeat(64),
		oldMode: "100644",
		newMode: "100644",
		oldKind: RUN_OBJECT_KIND.FILE,
		newKind: RUN_OBJECT_KIND.FILE,
		isBinary: false,
		hunks: 1,
		referenceStarts: [8],
		additions: 2,
		deletions: 1,
	};
	const output = formatAgentInput([], [{ diff, runFile }]);

	expect(output.split("\n").slice(4)).toEqual([
		'=== File: file.ts (modified) | filePath: "file.ts", oldStart: 8 ===',
		"=== Hunk @8: @@ -8,2 +8,3 @@ ===",
		"8  8 | keep",
		"9    |-old",
		"   9 |+new",
		"  10 |+more",
		"     |\\ No newline at end of file",
		"",
	]);
});
