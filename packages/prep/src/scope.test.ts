import { expect, test } from "bun:test";
import { RUN_COMPARISON, RUN_SCOPE_MODE } from "@revue/types";
import { PrepArgumentError, parseScopeRequest } from "./scope.ts";

test("--pr with a number targets the origin pull head under merge-base comparison", () => {
	const request = parseScopeRequest(["--pr", "123"]);
	expect(request).toMatchObject({
		mode: RUN_SCOPE_MODE.COMMITTED,
		comparison: RUN_COMPARISON.MERGE_BASE,
		headRef: "pull/123/head",
		pullRequest: { source: "origin", ref: "pull/123/head", label: "pull/123/head" },
		explicitRefs: true,
	});
});

test("--pr with a GitHub URL fetches from that repository and labels the head", () => {
	const request = parseScopeRequest([
		"--pr",
		"https://github.com/octo/widgets/pull/7",
		"--base",
		"main",
	]);
	expect(request.baseRef).toBe("main");
	expect(request.pullRequest).toEqual({
		source: "https://github.com/octo/widgets",
		ref: "pull/7/head",
		label: "octo/widgets#7",
	});
});

test("--pr rejects non-GitHub values, extra refs, and working-tree modes", () => {
	expect(() => parseScopeRequest(["--pr", "not-a-pr"])).toThrow(PrepArgumentError);
	expect(() => parseScopeRequest(["--pr", "5", "main"])).toThrow("--pr chooses the compare ref");
	expect(() => parseScopeRequest(["--pr", "5", "--ref", "staged"])).toThrow(
		"cannot use a --ref mode",
	);
});
