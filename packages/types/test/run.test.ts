import { expect, test } from "bun:test";
import { RUN_FILE_STATUS, RUN_OBJECT_KIND, runFileSchema } from "../src/run.ts";

const addedFile = {
	path: "new.ts",
	previousPath: null,
	status: RUN_FILE_STATUS.ADDED,
	oldBlob: null,
	newBlob: "2".repeat(64),
	oldMode: null,
	newMode: "100644",
	oldKind: null,
	newKind: RUN_OBJECT_KIND.FILE,
	isBinary: false,
	hunks: 1,
	referenceStarts: [0],
	additions: 1,
	deletions: 0,
};

test("run files reject partial or status-inconsistent snapshot sides", () => {
	expect(runFileSchema.safeParse(addedFile).success).toBe(true);
	expect(runFileSchema.safeParse({ ...addedFile, oldBlob: "1".repeat(64) }).success).toBe(false);
	expect(runFileSchema.safeParse({ ...addedFile, status: RUN_FILE_STATUS.MODIFIED }).success).toBe(
		false,
	);
	const complete = {
		...addedFile,
		status: RUN_FILE_STATUS.RENAMED,
		oldBlob: "1".repeat(64),
		oldMode: "100644",
		oldKind: RUN_OBJECT_KIND.FILE,
	};
	expect(runFileSchema.safeParse(complete).success).toBe(false);
	expect(
		runFileSchema.safeParse({
			...complete,
			status: RUN_FILE_STATUS.MODE_CHANGED,
			previousPath: null,
		}).success,
	).toBe(false);
});
