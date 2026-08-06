import type { DiffLineRange, DiffSide } from "@revue/diff";
import { RUN_ENDPOINT_KIND, type RunScope } from "@revue/types";

export type GitHubRemote = { owner: string; repo: string };

export type SourceRange = { path: string; startLine: number; endLine: number };

/** The commit holding each side's line numbers, or null where that side is uncommitted. */
export type PermalinkContext = {
	remote: GitHubRemote;
	shas: Record<DiffSide, string | null>;
};

const GITHUB_REMOTE =
	/^(?:(?:https?|ssh|git):\/\/)?(?:[^@/]+@)?github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/;

export const parseGitHubRemote = (url: string): GitHubRemote | null => {
	const [, owner, repo] = GITHUB_REMOTE.exec(url.trim()) ?? [];
	return owner && repo ? { owner, repo } : null;
};

/** Only a commit endpoint pins content a permalink can resolve against. */
const committedSha = (endpoint: RunScope["oldEndpoint"]): string | null =>
	endpoint.kind === RUN_ENDPOINT_KIND.COMMIT ? endpoint.revision : null;

export const permalinkContextFor = ({
	scope,
	remoteUrl,
}: {
	scope: RunScope;
	remoteUrl: string | null;
}): PermalinkContext | null => {
	const remote = remoteUrl ? parseGitHubRemote(remoteUrl) : null;
	if (!remote) return null;
	const shas = {
		deletions: committedSha(scope.oldEndpoint),
		additions: committedSha(scope.newEndpoint),
	};
	return { remote, shas };
};

/** A rename numbers its new side under the new path and its old side under the previous one. */
export const sourceRangeFor = (range: DiffLineRange, previousPath?: string): SourceRange => ({
	path: range.side === "deletions" ? (previousPath ?? range.filePath) : range.filePath,
	startLine: range.startLine,
	endLine: range.endLine,
});

export const formatSourceLocation = ({ path, startLine, endLine }: SourceRange): string =>
	startLine === endLine ? `${path}:${startLine}` : `${path}:${startLine}-${endLine}`;

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export const formatPermalink = ({
	remote,
	sha,
	path,
	startLine,
	endLine,
}: SourceRange & { remote: GitHubRemote; sha: string }): string => {
	const lines = startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;
	return `https://github.com/${remote.owner}/${remote.repo}/blob/${sha}/${encodePath(path)}#${lines}`;
};

export const permalinkFor = ({
	context,
	range,
	previousPath,
}: {
	context: PermalinkContext | null | undefined;
	range: DiffLineRange;
	previousPath?: string;
}): string | null => {
	const sha = context?.shas[range.side];
	if (!context || !sha) return null;
	return formatPermalink({ remote: context.remote, sha, ...sourceRangeFor(range, previousPath) });
};

/** Why the link verb is unavailable, or null when it is. */
export const permalinkBlocker = ({
	context,
	side,
}: {
	context: PermalinkContext | null | undefined;
	side: DiffSide;
}): string | null => {
	if (!context) return "no GitHub remote";
	return context.shas[side] ? null : "side is not committed";
};
