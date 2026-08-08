import { expect, test } from "bun:test";
import { RUN_COMPARISON, RUN_ENDPOINT_KIND, RUN_SCOPE_MODE, type RunScope } from "@revue/types";
import { PrepArgumentError, parseScopeRequest, rerunArgsFor } from "./scope.ts";

const sha = "a".repeat(40);

const committedScope = (
	comparison: typeof RUN_COMPARISON.DIRECT | typeof RUN_COMPARISON.MERGE_BASE,
	headRef: string,
): RunScope => ({
	mode: RUN_SCOPE_MODE.COMMITTED,
	comparison,
	base: { ref: "main", sha },
	head: { ref: headRef, sha },
	mergeBaseSha: sha,
	oldEndpoint: { kind: RUN_ENDPOINT_KIND.COMMIT, revision: sha },
	newEndpoint: { kind: RUN_ENDPOINT_KIND.COMMIT, revision: sha },
});

const workingTreeScope = (mode: typeof RUN_SCOPE_MODE.STAGED): RunScope => ({
	mode,
	comparison: RUN_COMPARISON.STAGED,
	base: { ref: "HEAD", sha },
	head: { ref: "HEAD", sha },
	mergeBaseSha: sha,
	oldEndpoint: { kind: RUN_ENDPOINT_KIND.COMMIT, revision: sha },
	newEndpoint: { kind: RUN_ENDPOINT_KIND.INDEX_TREE, revision: sha },
});

test("rerunArgsFor round-trips a committed/direct scope through parseScopeRequest", () => {
	const scope = committedScope(RUN_COMPARISON.DIRECT, "feature");
	const args = rerunArgsFor(scope, { revueIgnore: [], session: ["*.lock"] });
	expect(args).toEqual(["main..feature", "--ignore", "*.lock"]);
	const request = parseScopeRequest(args ?? []);
	expect(request).toMatchObject({
		comparison: RUN_COMPARISON.DIRECT,
		baseRef: scope.base.ref,
		headRef: scope.head.ref,
		explicitRefs: true,
		ignorePatterns: ["*.lock"],
	});
});

test("rerunArgsFor round-trips a committed/merge-base scope through parseScopeRequest", () => {
	const scope = committedScope(RUN_COMPARISON.MERGE_BASE, "feature");
	const args = rerunArgsFor(scope);
	expect(args).toEqual(["--base", "main", "--compare", "feature"]);
	const request = parseScopeRequest(args ?? []);
	expect(request).toMatchObject({
		comparison: RUN_COMPARISON.MERGE_BASE,
		baseRef: scope.base.ref,
		headRef: scope.head.ref,
		explicitRefs: true,
	});
});

test("rerunArgsFor round-trips a working-tree scope through parseScopeRequest", () => {
	const scope = workingTreeScope(RUN_SCOPE_MODE.STAGED);
	const args = rerunArgsFor(scope, { revueIgnore: [], session: [] });
	expect(args).toEqual(["--ref", "staged", "--base", "HEAD"]);
	const request = parseScopeRequest(args ?? []);
	expect(request).toMatchObject({
		mode: scope.mode,
		baseRef: scope.base.ref,
		explicitRefs: true,
	});
});

test("rerunArgsFor returns null for a --pr run recorded as pull/<n>/head", () => {
	const scope = committedScope(RUN_COMPARISON.MERGE_BASE, "pull/123/head");
	expect(rerunArgsFor(scope)).toBeNull();
});

test("rerunArgsFor returns null for a --pr run recorded as owner/repo#n", () => {
	const scope = committedScope(RUN_COMPARISON.MERGE_BASE, "octo/widgets#7");
	expect(rerunArgsFor(scope)).toBeNull();
});

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
