import { expect, test } from "bun:test";
import type { DiffLineRange } from "@revue/diff-renderer";
import type { RunScope } from "@revue/types";
import {
	formatSourceLocation,
	parseGitHubRemote,
	permalinkBlocker,
	permalinkContextFor,
	permalinkFor,
	sourceRangeFor,
} from "./sourceLink.ts";

const OLD_SHA = "a".repeat(40);
const NEW_SHA = "b".repeat(40);
const WORKTREE_REVISION = "c".repeat(64);

const range = (overrides: Partial<DiffLineRange> = {}): DiffLineRange => ({
	filePath: "src/lib/backoff.ts",
	hunkOldStart: 1,
	side: "additions",
	startLine: 12,
	endLine: 12,
	...overrides,
});

const scope = (newEndpoint: RunScope["newEndpoint"]): RunScope =>
	({
		mode: newEndpoint.kind === "commit" ? "committed" : "work",
		comparison: newEndpoint.kind === "commit" ? "direct" : "work",
		base: { ref: "main", sha: OLD_SHA },
		head: { ref: "HEAD", sha: NEW_SHA },
		mergeBaseSha: OLD_SHA,
		oldEndpoint: { kind: "commit", revision: OLD_SHA },
		newEndpoint,
	}) as RunScope;

const committedScope = scope({ kind: "commit", revision: NEW_SHA });
const worktreeScope = scope({ kind: "worktree", revision: WORKTREE_REVISION });

test("every remote spelling of a GitHub repository resolves to the same owner and repo", () => {
	const expected = { owner: "mtford", repo: "revue" };
	expect(parseGitHubRemote("git@github.com:mtford/revue.git")).toEqual(expected);
	expect(parseGitHubRemote("https://github.com/mtford/revue.git")).toEqual(expected);
	expect(parseGitHubRemote("https://github.com/mtford/revue")).toEqual(expected);
	expect(parseGitHubRemote("ssh://git@github.com/mtford/revue.git")).toEqual(expected);
	expect(parseGitHubRemote("  git@github.com:mtford/revue  ")).toEqual(expected);
});

test("a remote that is not github.com yields no repository", () => {
	expect(parseGitHubRemote("git@gitlab.com:mtford/revue.git")).toBeNull();
	expect(parseGitHubRemote("https://github.company.com/mtford/revue.git")).toBeNull();
	expect(parseGitHubRemote("/srv/git/revue.git")).toBeNull();
});

test("a single line reads as one location and a run reads as a span", () => {
	expect(formatSourceLocation(sourceRangeFor(range()))).toBe("src/lib/backoff.ts:12");
	expect(formatSourceLocation(sourceRangeFor(range({ endLine: 16 })))).toBe(
		"src/lib/backoff.ts:12-16",
	);
});

test("a rename numbers its deleted side under the path the lines had then", () => {
	const previous = "src/backoff.ts";
	expect(sourceRangeFor(range({ side: "deletions" }), previous).path).toBe(previous);
	expect(sourceRangeFor(range(), previous).path).toBe("src/lib/backoff.ts");
});

test("a permalink pins the side's own commit and highlights the exact lines", () => {
	const context = permalinkContextFor({
		scope: committedScope,
		remoteUrl: "git@github.com:mtford/revue.git",
	});
	expect(permalinkFor({ context, range: range({ endLine: 16 }) })).toBe(
		`https://github.com/mtford/revue/blob/${NEW_SHA}/src/lib/backoff.ts#L12-L16`,
	);
	expect(permalinkFor({ context, range: range({ side: "deletions" }) })).toBe(
		`https://github.com/mtford/revue/blob/${OLD_SHA}/src/lib/backoff.ts#L12`,
	);
});

test("a working-tree side has no commit to link to, so only that side is blocked", () => {
	const context = permalinkContextFor({
		scope: worktreeScope,
		remoteUrl: "git@github.com:mtford/revue.git",
	});
	expect(permalinkFor({ context, range: range() })).toBeNull();
	expect(permalinkBlocker({ context, side: "additions" })).toBe("side is not committed");
	expect(permalinkBlocker({ context, side: "deletions" })).toBeNull();
});

test("without a GitHub remote there is no permalink context at all", () => {
	const context = permalinkContextFor({
		scope: committedScope,
		remoteUrl: "git@gitlab.com:mtford/revue.git",
	});
	expect(context).toBeNull();
	expect(permalinkFor({ context, range: range() })).toBeNull();
	expect(permalinkBlocker({ context, side: "additions" })).toBe("no GitHub remote");
});
