import { expect, test } from "bun:test";
import { RUN_COMPARISON, RUN_SCOPE_MODE } from "@revue/types";
import { PrepArgumentError, parseScopeRequest } from "../src/scope.ts";

test("scope parsing distinguishes merge-base and direct committed ranges", () => {
	expect(parseScopeRequest(["main", "feature"])).toEqual({
		mode: "auto",
		comparison: RUN_COMPARISON.MERGE_BASE,
		baseRef: "main",
		headRef: "feature",
		explicitRefs: true,
		ignorePatterns: [],
	});
	expect(parseScopeRequest(["main..feature"])).toMatchObject({
		comparison: RUN_COMPARISON.DIRECT,
		baseRef: "main",
		headRef: "feature",
	});
	expect(parseScopeRequest(["main...feature"])).toMatchObject({
		comparison: RUN_COMPARISON.MERGE_BASE,
		baseRef: "main",
		headRef: "feature",
	});
});

test("working-tree modes retain base context but reject another checkout", () => {
	expect(parseScopeRequest(["--ref", "work", "main"])).toMatchObject({
		mode: RUN_SCOPE_MODE.WORK,
		baseRef: "main",
		headRef: "HEAD",
	});
	expect(() => parseScopeRequest(["--ref=staged", "--compare", "feature"])).toThrow(
		PrepArgumentError,
	);
});

test("session ignore options retain command-line order", () => {
	expect(
		parseScopeRequest([
			"main",
			"HEAD",
			"--ignore",
			"*.generated.ts",
			"--ignore=!src/keep.generated.ts",
		]),
	).toMatchObject({
		ignorePatterns: ["*.generated.ts", "!src/keep.generated.ts"],
	});
	expect(() => parseScopeRequest(["--ignore", "one\ntwo"])).toThrow(
		"--ignore accepts one pattern per option",
	);
});
