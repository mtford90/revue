import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import {
	RUN_COMPARISON,
	RUN_ENDPOINT_KIND,
	RUN_SCOPE_MODE,
	type RunCommit,
	type RunScope,
} from "@revue/types";
import { digest } from "./artifact.ts";
import type { ScopeRequest } from "./scope.ts";

export class GitError extends Error {}

export type GitContext = {
	root: string;
};

export type SnapshotSource =
	| { kind: typeof RUN_ENDPOINT_KIND.COMMIT; revision: string }
	| { kind: typeof RUN_ENDPOINT_KIND.INDEX_TREE; revision: string }
	| { kind: typeof RUN_ENDPOINT_KIND.WORKTREE };

export type ScopePlan = {
	context: GitContext;
	mode: RunScope["mode"];
	comparison: RunScope["comparison"];
	base: RunScope["base"];
	head: RunScope["head"];
	mergeBaseSha: string;
	oldSource: SnapshotSource;
	newSource: SnapshotSource;
};

export type RawCapture = {
	patch: string;
	worktreeRevision?: string;
};

export type Snapshot = {
	content: Uint8Array<ArrayBuffer>;
	mode: string;
	kind: "file" | "symlink";
};

const DIFF_FLAGS = [
	"--binary",
	"--full-index",
	"--no-color",
	"--no-ext-diff",
	"--no-textconv",
	"--find-renames=50%",
	"--diff-algorithm=histogram",
	"--unified=3",
];

const gitBytes = async (
	context: GitContext,
	args: string[],
	allowedExitCodes: number[] = [0],
): Promise<Uint8Array<ArrayBuffer>> => {
	const child = Bun.spawn(["git", ...args], {
		cwd: context.root,
		env: { ...process.env, LANG: "C", LC_ALL: "C" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).arrayBuffer(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (!allowedExitCodes.includes(exitCode)) {
		throw new GitError(`git ${args[0]} failed (${exitCode}): ${stderr.trim() || "unknown error"}`);
	}
	return new Uint8Array(stdout);
};

const gitText = async (
	context: GitContext,
	args: string[],
	allowedExitCodes?: number[],
): Promise<string> => new TextDecoder().decode(await gitBytes(context, args, allowedExitCodes));

export async function findGitContext(directory = process.cwd()): Promise<GitContext> {
	const provisional = { root: directory };
	const root = (await gitText(provisional, ["rev-parse", "--show-toplevel"])).trim();
	return { root };
}

const resolves = async (context: GitContext, ref: string): Promise<boolean> => {
	try {
		await gitText(context, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
		return true;
	} catch {
		return false;
	}
};

const defaultBaseRef = async (context: GitContext): Promise<string> => {
	try {
		const remoteDefault = (
			await gitText(context, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])
		).trim();
		if (remoteDefault && (await resolves(context, remoteDefault))) return remoteDefault;
	} catch {}
	for (const candidate of ["origin/main", "main", "origin/master", "master"]) {
		if (await resolves(context, candidate)) return candidate;
	}
	throw new GitError("Could not detect a main/master base ref; pass --base <ref>");
};

const resolveCommit = async (context: GitContext, ref: string): Promise<string> =>
	(await gitText(context, ["rev-parse", "--verify", `${ref}^{commit}`])).trim();

const hasLocalChanges = async (context: GitContext): Promise<boolean> =>
	(await gitBytes(context, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).length > 0;

const rejectUnmerged = async (context: GitContext): Promise<void> => {
	const unmerged = await gitBytes(context, ["ls-files", "--unmerged", "-z"]);
	if (unmerged.length)
		throw new GitError("Cannot prep a run while the index has unresolved conflicts");
};

const resolveMode = async (
	context: GitContext,
	request: ScopeRequest,
): Promise<RunScope["mode"]> => {
	if (request.mode !== "auto") return request.mode;
	if (request.explicitRefs) return RUN_SCOPE_MODE.COMMITTED;
	return (await hasLocalChanges(context)) ? RUN_SCOPE_MODE.WORK : RUN_SCOPE_MODE.COMMITTED;
};

const resolveBaseRef = async (
	context: GitContext,
	request: ScopeRequest,
	mode: RunScope["mode"],
): Promise<string> => {
	if (request.baseRef) return request.baseRef;
	try {
		return await defaultBaseRef(context);
	} catch (error) {
		if (mode !== RUN_SCOPE_MODE.COMMITTED) return "HEAD";
		throw error;
	}
};

// FETCH_HEAD is resolved immediately after the fetch, so the pinned SHA cannot be
// displaced by any later fetch in the same repository.
const fetchPullRequestHead = async (
	context: GitContext,
	pullRequest: NonNullable<ScopeRequest["pullRequest"]>,
): Promise<string> => {
	await gitText(context, ["fetch", "--quiet", pullRequest.source, pullRequest.ref]);
	return resolveCommit(context, "FETCH_HEAD");
};

export async function resolveScopePlan(
	request: ScopeRequest,
	directory?: string,
): Promise<ScopePlan> {
	const context = await findGitContext(directory);
	const mode = await resolveMode(context, request);
	if (mode !== RUN_SCOPE_MODE.COMMITTED) await rejectUnmerged(context);
	const baseRef = await resolveBaseRef(context, request, mode);
	const pulledSha = request.pullRequest
		? await fetchPullRequestHead(context, request.pullRequest)
		: undefined;
	const [baseSha, headSha] = await Promise.all([
		resolveCommit(context, baseRef),
		pulledSha ?? resolveCommit(context, request.headRef),
	]);
	const mergeBaseSha = (await gitText(context, ["merge-base", baseSha, headSha])).trim();
	const base = { ref: baseRef, sha: baseSha };
	const head = { ref: request.headRef, sha: headSha };
	if (mode === RUN_SCOPE_MODE.COMMITTED) {
		const oldRevision = request.comparison === RUN_COMPARISON.DIRECT ? baseSha : mergeBaseSha;
		return {
			context,
			mode,
			comparison: request.comparison,
			base,
			head,
			mergeBaseSha,
			oldSource: { kind: RUN_ENDPOINT_KIND.COMMIT, revision: oldRevision },
			newSource: { kind: RUN_ENDPOINT_KIND.COMMIT, revision: headSha },
		};
	}
	if (mode === RUN_SCOPE_MODE.STAGED) {
		const indexTree = (await gitText(context, ["write-tree"])).trim();
		return {
			context,
			mode,
			comparison: RUN_COMPARISON.STAGED,
			base,
			head,
			mergeBaseSha,
			oldSource: { kind: RUN_ENDPOINT_KIND.COMMIT, revision: headSha },
			newSource: { kind: RUN_ENDPOINT_KIND.INDEX_TREE, revision: indexTree },
		};
	}
	if (mode === RUN_SCOPE_MODE.UNSTAGED) {
		const indexTree = (await gitText(context, ["write-tree"])).trim();
		return {
			context,
			mode,
			comparison: RUN_COMPARISON.UNSTAGED,
			base,
			head,
			mergeBaseSha,
			oldSource: { kind: RUN_ENDPOINT_KIND.INDEX_TREE, revision: indexTree },
			newSource: { kind: RUN_ENDPOINT_KIND.WORKTREE },
		};
	}
	return {
		context,
		mode,
		comparison: RUN_COMPARISON.WORK,
		base,
		head,
		mergeBaseSha,
		oldSource: { kind: RUN_ENDPOINT_KIND.COMMIT, revision: headSha },
		newSource: { kind: RUN_ENDPOINT_KIND.WORKTREE },
	};
}

const diffRevisions = (plan: ScopePlan): string[] => {
	const oldRevision =
		plan.oldSource.kind === RUN_ENDPOINT_KIND.WORKTREE ? undefined : plan.oldSource.revision;
	const newRevision =
		plan.newSource.kind === RUN_ENDPOINT_KIND.WORKTREE ? undefined : plan.newSource.revision;
	return [oldRevision, newRevision].filter((value): value is string => Boolean(value));
};

const diff = async (plan: ScopePlan): Promise<string> =>
	gitText(plan.context, [
		"-c",
		"core.quotePath=false",
		"diff",
		...DIFF_FLAGS,
		...diffRevisions(plan),
		"--",
	]);

const nulPaths = (bytes: Uint8Array<ArrayBuffer>): string[] =>
	new TextDecoder().decode(bytes).split("\0").filter(Boolean).sort();

const untrackedPaths = async (plan: ScopePlan): Promise<string[]> => {
	if (plan.mode !== RUN_SCOPE_MODE.WORK) return [];
	const paths = nulPaths(
		await gitBytes(plan.context, ["ls-files", "--others", "--exclude-standard", "-z"]),
	);
	const trackedAtHead = new Set(
		nulPaths(await gitBytes(plan.context, ["ls-tree", "-r", "--name-only", "-z", plan.head.sha])),
	);
	return paths.filter((path) => !trackedAtHead.has(path));
};

const untrackedPatch = async (plan: ScopePlan, path: string): Promise<string> =>
	gitText(
		plan.context,
		["-c", "core.quotePath=false", "diff", "--no-index", ...DIFF_FLAGS, "--", "/dev/null", path],
		[0, 1],
	);

const trackedPaths = async (plan: ScopePlan): Promise<string[]> =>
	nulPaths(
		await gitBytes(plan.context, [
			"diff",
			"--name-only",
			"-z",
			"--no-renames",
			...diffRevisions(plan),
			"--",
		]),
	);

const hasTerminalControl = (path: string): boolean =>
	[...path].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint < 32 || codePoint === 127;
	});

const validatePaths = (paths: string[]): void => {
	const unsupported = paths.find(hasTerminalControl);
	if (unsupported) {
		throw new GitError(
			`Cannot review a path containing terminal control characters: ${JSON.stringify(unsupported)}`,
		);
	}
};

async function capturePatch(plan: ScopePlan): Promise<string> {
	const untracked = await untrackedPaths(plan);
	validatePaths([...(await trackedPaths(plan)), ...untracked]);
	const tracked = await diff(plan);
	const additions = await Promise.all(untracked.map((path) => untrackedPatch(plan, path)));
	return [tracked, ...additions].filter(Boolean).join("").replaceAll("\r\n", "\n");
}

export async function captureRawPatch(plan: ScopePlan): Promise<RawCapture> {
	const patch = await capturePatch(plan);
	return {
		patch,
		worktreeRevision:
			plan.newSource.kind === RUN_ENDPOINT_KIND.WORKTREE ? digest(patch) : undefined,
	};
}

export async function verifyRawCapture(plan: ScopePlan, capture: RawCapture): Promise<void> {
	if (plan.mode !== RUN_SCOPE_MODE.COMMITTED) {
		const headSha = await resolveCommit(plan.context, "HEAD");
		if (headSha !== plan.head.sha) throw new GitError("HEAD changed while revue prep was running");
	}
	if (
		plan.oldSource.kind === RUN_ENDPOINT_KIND.INDEX_TREE ||
		plan.newSource.kind === RUN_ENDPOINT_KIND.INDEX_TREE
	) {
		const indexTree = (await gitText(plan.context, ["write-tree"])).trim();
		const expected =
			plan.oldSource.kind === RUN_ENDPOINT_KIND.INDEX_TREE
				? plan.oldSource.revision
				: plan.newSource.kind === RUN_ENDPOINT_KIND.INDEX_TREE
					? plan.newSource.revision
					: undefined;
		if (indexTree !== expected)
			throw new GitError("The index changed while revue prep was running");
	}
	if (plan.newSource.kind === RUN_ENDPOINT_KIND.WORKTREE) {
		const current = await capturePatch(plan);
		if (current !== capture.patch)
			throw new GitError("The worktree changed while revue prep was running");
	}
}

const treeSnapshot = async (
	context: GitContext,
	revision: string,
	path: string,
): Promise<Snapshot | null | "gitlink"> => {
	const entry = new TextDecoder().decode(
		await gitBytes(context, ["ls-tree", "-z", revision, "--", path]),
	);
	if (!entry) return null;
	const match = /^(\d{6}) (\w+) [0-9a-f]{40}\t/.exec(entry);
	const mode = match?.[1];
	const objectType = match?.[2];
	if (!mode || !objectType) throw new GitError(`Could not parse git tree entry for ${path}`);
	if (objectType === "commit" || mode === "160000") return "gitlink";
	const content = await gitBytes(context, ["cat-file", "blob", `${revision}:${path}`]);
	return { content, mode, kind: mode === "120000" ? "symlink" : "file" };
};

const worktreeSnapshot = async (context: GitContext, path: string): Promise<Snapshot | null> => {
	const absolutePath = join(context.root, path);
	let details: Awaited<ReturnType<typeof lstat>>;
	try {
		details = await lstat(absolutePath);
	} catch (error) {
		if (Reflect.get(Object(error), "code") === "ENOENT") return null;
		throw error;
	}
	if (details.isSymbolicLink()) {
		return {
			content: new TextEncoder().encode(await readlink(absolutePath)),
			mode: "120000",
			kind: "symlink",
		};
	}
	const mode = details.mode & 0o111 ? "100755" : "100644";
	return { content: new Uint8Array(await readFile(absolutePath)), mode, kind: "file" };
};

export const readSnapshot = async (
	plan: ScopePlan,
	source: SnapshotSource,
	path: string,
): Promise<Snapshot | null | "gitlink"> =>
	source.kind === RUN_ENDPOINT_KIND.WORKTREE
		? worktreeSnapshot(plan.context, path)
		: treeSnapshot(plan.context, source.revision, path);

export async function commitMessages(plan: ScopePlan): Promise<RunCommit[]> {
	const start = plan.comparison === RUN_COMPARISON.DIRECT ? plan.base.sha : plan.mergeBaseSha;
	const raw = await gitText(plan.context, [
		"log",
		"--reverse",
		"--format=%H%x00%s%x00",
		`${start}..${plan.head.sha}`,
	]);
	const fields = raw
		.split("\0")
		.map((field) => field.trim())
		.filter(Boolean);
	const commits: RunCommit[] = [];
	for (let index = 0; index < fields.length; index += 2) {
		const sha = fields[index];
		if (sha) commits.push({ subject: fields[index + 1] ?? "", sha });
	}
	return commits;
}
