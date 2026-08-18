import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import {
	type ExcerptRange,
	excerptKey,
	type FrozenExcerpt,
	type RevueChaptersFile,
	RUN_ENDPOINT_KIND,
	type RunContextFile,
	type RunManifest,
	runContextFileSchema,
	type UnresolvedExcerpt,
} from "@revue/types";
import { z } from "zod";
import { digest, type PreparedRun, RunArtifactError } from "./artifact.ts";
import {
	findGitContext,
	type GitContext,
	GitError,
	readSnapshot,
	type Snapshot,
	type SnapshotSource,
} from "./git.ts";

// Freezing is narration-side work: it writes context.json beside chapters.json and touches nothing
// the run ID hashes, so pinning quoted code can never invalidate the prepared diff it quotes.

export const runContextPath = (directory: string): string => join(directory, "context.json");

export type FreezeContextResult = {
	path: string;
	context: RunContextFile;
	/** Cited paths a worktree-backed run has no captured snapshot for, so drift is undetectable. */
	unverifiable: string[];
};

type Resolution =
	| { kind: "frozen"; excerpt: FrozenExcerpt }
	| { kind: "unresolved"; excerpt: UnresolvedExcerpt };

/** Every distinct range the narration cites, in a stable order so re-freezing is byte-identical. */
const citations = (chapters: RevueChaptersFile): ExcerptRange[] => {
	const ranges = new Map<string, ExcerptRange>();
	for (const chapter of chapters.chapters) {
		for (const { filePath, startLine, endLine } of chapter.excerpts) {
			ranges.set(excerptKey({ filePath, startLine, endLine }), { filePath, startLine, endLine });
		}
	}
	return [...ranges.values()].sort(
		(left, right) =>
			left.filePath.localeCompare(right.filePath) ||
			left.startLine - right.startLine ||
			left.endLine - right.endLine,
	);
};

const contentSource = (manifest: RunManifest): SnapshotSource => {
	const endpoint = manifest.scope.newEndpoint;
	return endpoint.kind === RUN_ENDPOINT_KIND.WORKTREE
		? { kind: RUN_ENDPOINT_KIND.WORKTREE }
		: { kind: endpoint.kind, revision: endpoint.revision };
};

/**
 * A worktree endpoint is a synthetic revision over bytes still sitting on disk, so a cited file
 * that prep captured must still match what it captured — the same refusal to pin a mixed snapshot
 * that `verifyWorktreeSnapshots` makes during prep. A cited file prep never captured has no
 * baseline to compare against; its path is returned so the caller can say drift went unchecked.
 */
const verifyCitedSnapshots = async (
	context: GitContext,
	manifest: RunManifest,
	cited: ExcerptRange[],
): Promise<string[]> => {
	if (manifest.scope.newEndpoint.kind !== RUN_ENDPOINT_KIND.WORKTREE) return [];
	const unverifiable = new Set<string>();
	for (const path of new Set(cited.map((range) => range.filePath))) {
		const captured = manifest.files.find((file) => file.path === path);
		if (!captured) {
			unverifiable.add(path);
			continue;
		}
		const result = await readSnapshot(context, { kind: RUN_ENDPOINT_KIND.WORKTREE }, path);
		const current = result === "gitlink" ? null : result;
		if (
			(current ? digest(current.content) : null) !== captured.newBlob ||
			(current?.mode ?? null) !== captured.newMode
		) {
			throw new GitError(
				`The worktree file ${path} changed after revue prep captured this run; prep a new run before freezing its context`,
			);
		}
	}
	return [...unverifiable].sort();
};

const splitLines = (text: string): string[] => {
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
};

const unresolved = (range: ExcerptRange, reason: string): Resolution => ({
	kind: "unresolved",
	excerpt: { ...range, reason },
});

const freeze = (range: ExcerptRange, snapshot: Snapshot): Resolution => {
	if (snapshot.kind === "symlink") return unresolved(range, "the path is a symbolic link");
	if (snapshot.content.includes(0)) return unresolved(range, "the file is binary");
	const lines = splitLines(new TextDecoder().decode(snapshot.content));
	if (range.endLine > lines.length) {
		return unresolved(range, `the file has ${lines.length} lines`);
	}
	return {
		kind: "frozen",
		excerpt: {
			...range,
			lines: lines.slice(range.startLine - 1, range.endLine),
			fileSha256: digest(snapshot.content),
		},
	};
};

/**
 * Citations come from an agent-written chapters file, and a worktree endpoint resolves them
 * against the repository root, so a path that climbs out of the repository would let narration
 * quote anything on the machine into a file the reviewer reads. Only repository-relative paths
 * that stay inside it may be quoted.
 */
const escapesRepository = (filePath: string): boolean =>
	isAbsolute(filePath) || normalize(filePath).split(/[\\/]/).includes("..");

const resolveCitation = async (
	context: GitContext,
	source: SnapshotSource,
	range: ExcerptRange,
): Promise<Resolution> => {
	if (escapesRepository(range.filePath)) {
		return unresolved(range, "the path is outside the repository");
	}
	let snapshot: Snapshot | null | "gitlink";
	try {
		snapshot = await readSnapshot(context, source, range.filePath);
	} catch (error) {
		if (error instanceof GitError) return unresolved(range, error.message);
		throw error;
	}
	if (snapshot === null) return unresolved(range, "the run's endpoint has no file at that path");
	if (snapshot === "gitlink") return unresolved(range, "the path is a submodule");
	return freeze(range, snapshot);
};

const writeRunContext = async (directory: string, file: RunContextFile): Promise<string> => {
	const path = runContextPath(directory);
	const temporary = `${path}.tmp-${randomUUID()}`;
	try {
		await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, "utf8");
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
	return path;
};

/**
 * Resolve every excerpt citation in a run's narration against the run's own recorded new endpoint,
 * without writing anything. Deterministic: resolving an unchanged run twice produces the same bytes.
 */
export async function resolveRunContext(
	run: PreparedRun,
	chapters: RevueChaptersFile,
): Promise<Omit<FreezeContextResult, "path">> {
	const context = await findGitContext(run.directory);
	const cited = citations(chapters);
	const unverifiable = await verifyCitedSnapshots(context, run.manifest, cited);
	const source = contentSource(run.manifest);
	const resolutions: Resolution[] = [];
	for (const range of cited) resolutions.push(await resolveCitation(context, source, range));
	const file = runContextFileSchema.parse({
		runId: run.manifest.runId,
		source: {
			kind: run.manifest.scope.newEndpoint.kind,
			revision: run.manifest.scope.newEndpoint.revision,
		},
		excerpts: resolutions.flatMap((entry) => (entry.kind === "frozen" ? [entry.excerpt] : [])),
		unresolved: resolutions.flatMap((entry) =>
			entry.kind === "unresolved" ? [entry.excerpt] : [],
		),
	});
	return { context: file, unverifiable };
}

/** Resolve a run's citations and pin the quoted lines into `context.json` beside its narration. */
export async function freezeRunContext(
	run: PreparedRun,
	chapters: RevueChaptersFile,
): Promise<FreezeContextResult> {
	const resolved = await resolveRunContext(run, chapters);
	return { ...resolved, path: await writeRunContext(run.directory, resolved.context) };
}

/** Read a run's frozen context, or null when nothing has been frozen for it yet. */
export async function loadRunContext(run: PreparedRun): Promise<RunContextFile | null> {
	const path = runContextPath(run.directory);
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if (Reflect.get(Object(error), "code") === "ENOENT") return null;
		throw new RunArtifactError(`Could not read ${path}: ${describe(error)}`);
	}
	const parsed = runContextFileSchema.safeParse(parseJson(path, raw));
	if (!parsed.success) {
		throw new RunArtifactError(
			`${path} does not match the frozen context schema:\n${z.prettifyError(parsed.error)}`,
		);
	}
	if (parsed.data.runId !== run.manifest.runId) {
		throw new RunArtifactError(`${path} was frozen for a different run`);
	}
	return parsed.data;
}

const parseJson = (path: string, raw: string): unknown => {
	try {
		return JSON.parse(raw);
	} catch (error) {
		throw new RunArtifactError(`${path} is not valid JSON: ${describe(error)}`);
	}
};

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
