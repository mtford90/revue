import { type DiffFile, parsePatch } from "@revue/diff";
import {
	RUN_ENDPOINT_KIND,
	RUN_FILE_STATUS,
	RUN_SCHEMA_VERSION,
	type RunFile,
	type RunIgnoreInputs,
	type RunManifestContent,
	type RunScope,
} from "@revue/types";
import { defaultRunsDirectory, digest, type PreparedRun, writePreparedRun } from "./artifact.ts";
import { exclusionFor, loadFilterRules } from "./filter.ts";
import { type AgentInputFile, formatAgentInput } from "./format.ts";
import {
	captureRawPatch,
	commitMessages,
	GitError,
	readSnapshot,
	resolveScopePlan,
	type ScopePlan,
	type Snapshot,
	type SnapshotSource,
	verifyRawCapture,
} from "./git.ts";
import { resolveSupersedes } from "./lineage.ts";
import { parseScopeRequest } from "./scope.ts";

export class PrepError extends Error {}

type PreparedFile = AgentInputFile & {
	oldSnapshot: Snapshot | null;
	newSnapshot: Snapshot | null;
};

const statusFor = (
	file: DiffFile,
	oldSnapshot: Snapshot | null,
	newSnapshot: Snapshot | null,
): RunFile["status"] => {
	if (file.metadata.type === "new") return RUN_FILE_STATUS.ADDED;
	if (file.metadata.type === "deleted") return RUN_FILE_STATUS.DELETED;
	if (/^copy from /m.test(file.patch ?? "")) return RUN_FILE_STATUS.COPIED;
	if (file.previousPath) return RUN_FILE_STATUS.RENAMED;
	if (
		oldSnapshot?.mode !== newSnapshot?.mode &&
		file.stats.additions === 0 &&
		file.stats.deletions === 0
	) {
		return RUN_FILE_STATUS.MODE_CHANGED;
	}
	return RUN_FILE_STATUS.MODIFIED;
};

const expectedSnapshots = async (
	plan: ScopePlan,
	file: DiffFile,
): Promise<[Snapshot | null | "gitlink", Snapshot | null | "gitlink"]> => {
	const oldPath = file.previousPath ?? file.path;
	const old =
		file.metadata.type === "new" ? null : await readSnapshot(plan.context, plan.oldSource, oldPath);
	const current =
		file.metadata.type === "deleted"
			? null
			: await readSnapshot(plan.context, plan.newSource, file.path);
	return [old, current];
};

const createRunFile = (
	file: DiffFile,
	oldSnapshot: Snapshot | null,
	newSnapshot: Snapshot | null,
): RunFile => ({
	path: file.path,
	previousPath: file.previousPath ?? null,
	status: statusFor(file, oldSnapshot, newSnapshot),
	oldBlob: oldSnapshot ? digest(oldSnapshot.content) : null,
	newBlob: newSnapshot ? digest(newSnapshot.content) : null,
	oldMode: oldSnapshot?.mode ?? null,
	newMode: newSnapshot?.mode ?? null,
	oldKind: oldSnapshot?.kind ?? null,
	newKind: newSnapshot?.kind ?? null,
	isBinary: Boolean(file.isBinary),
	hunks: file.metadata.hunks.length,
	referenceStarts: file.metadata.hunks.length
		? file.metadata.hunks.map((hunk) => hunk.deletionStart)
		: [0],
	additions: file.stats.additions,
	deletions: file.stats.deletions,
});

const addBlobs = (
	blobs: Map<string, Uint8Array<ArrayBuffer>>,
	...snapshots: Array<Snapshot | null>
): void => {
	for (const snapshot of snapshots) {
		if (snapshot) blobs.set(digest(snapshot.content), snapshot.content);
	}
};

const prepareFiles = async (
	plan: ScopePlan,
	patch: string,
	sessionPatterns: string[],
): Promise<{
	files: PreparedFile[];
	exclusions: RunManifestContent["exclusions"];
	ignore: RunIgnoreInputs;
	changedFiles: number;
	blobs: Map<string, Uint8Array<ArrayBuffer>>;
}> => {
	const rules = await loadFilterRules(plan.context.root, sessionPatterns);
	const files: PreparedFile[] = [];
	const exclusions: RunManifestContent["exclusions"] = [];
	const blobs = new Map<string, Uint8Array<ArrayBuffer>>();
	const changed = parsePatch(patch).sort((left, right) => left.path.localeCompare(right.path));
	for (const diff of changed) {
		const [oldResult, newResult] = await expectedSnapshots(plan, diff);
		const isGitlink = oldResult === "gitlink" || newResult === "gitlink";
		const exclusion = exclusionFor(
			{
				path: diff.path,
				previousPath: diff.previousPath,
				isBinary: Boolean(diff.isBinary),
				isGitlink,
			},
			rules,
		);
		if (exclusion) exclusions.push(exclusion);
		else {
			const oldSnapshot = oldResult === "gitlink" ? null : oldResult;
			const newSnapshot = newResult === "gitlink" ? null : newResult;
			const runFile = createRunFile(diff, oldSnapshot, newSnapshot);
			addBlobs(blobs, oldSnapshot, newSnapshot);
			files.push({ diff, runFile, oldSnapshot, newSnapshot });
		}
	}
	return { files, exclusions, ignore: rules.inputs, changedFiles: changed.length, blobs };
};

const endpoint = (source: SnapshotSource, worktreeRevision: string): RunScope["oldEndpoint"] =>
	source.kind === RUN_ENDPOINT_KIND.WORKTREE
		? { kind: RUN_ENDPOINT_KIND.WORKTREE, revision: worktreeRevision }
		: source;

const worktreeRevision = (patch: string, files: PreparedFile[]): string => {
	const snapshots = files
		.map(({ runFile }) => `${runFile.path}\0${runFile.newMode}\0${runFile.newBlob}`)
		.sort()
		.join("\0");
	return digest(`${digest(patch)}\0${snapshots}`);
};

const runScope = (plan: ScopePlan, patch: string, files: PreparedFile[]): RunScope => {
	const revision = worktreeRevision(patch, files);
	return {
		mode: plan.mode,
		comparison: plan.comparison,
		base: plan.base,
		head: plan.head,
		mergeBaseSha: plan.mergeBaseSha,
		oldEndpoint: endpoint(plan.oldSource, revision),
		newEndpoint: endpoint(plan.newSource, revision),
	};
};

const verifyWorktreeSnapshots = async (plan: ScopePlan, files: PreparedFile[]): Promise<void> => {
	if (plan.newSource.kind !== RUN_ENDPOINT_KIND.WORKTREE) return;
	for (const file of files) {
		if (file.newSnapshot) {
			const current = await readSnapshot(plan.context, plan.newSource, file.diff.path);
			if (
				current === null ||
				current === "gitlink" ||
				current.mode !== file.newSnapshot.mode ||
				digest(current.content) !== digest(file.newSnapshot.content)
			) {
				throw new GitError(
					`The worktree file ${file.diff.path} changed while revue prep was running`,
				);
			}
		}
	}
};

const totals = (
	files: PreparedFile[],
	exclusions: RunManifestContent["exclusions"],
): RunManifestContent["totals"] => ({
	files: files.length,
	hunks: files.reduce((total, file) => total + file.runFile.hunks, 0),
	additions: files.reduce((total, file) => total + file.runFile.additions, 0),
	deletions: files.reduce((total, file) => total + file.runFile.deletions, 0),
	excluded: exclusions.length,
	reviewUnits: files.reduce((total, file) => total + file.runFile.referenceStarts.length, 0),
});

export async function prepareRun(args: string[], directory?: string): Promise<PreparedRun> {
	const request = parseScopeRequest(args);
	const plan = await resolveScopePlan(request, directory);
	const capture = await captureRawPatch(plan);
	if (!capture.patch.trim()) throw new PrepError("No changes found for the resolved review scope");
	const { files, exclusions, ignore, changedFiles, blobs } = await prepareFiles(
		plan,
		capture.patch,
		request.ignorePatterns,
	);
	if (!files.length) {
		const details = exclusions
			.map(
				(exclusion) =>
					`- ${JSON.stringify(exclusion.path)}: ${exclusion.reason} pattern ${JSON.stringify(exclusion.pattern)}`,
			)
			.join("\n");
		throw new PrepError(
			`All ${changedFiles} changed files were omitted from review. Adjust .revueignore or --ignore patterns and run revue prep again.${details ? `\n${details}` : ""}`,
		);
	}
	const commits = await commitMessages(plan);
	const patch = files.map(({ diff }) => diff.patch ?? "").join("");
	const hunks = formatAgentInput(commits, files, exclusions);
	await verifyRawCapture(plan, capture);
	await verifyWorktreeSnapshots(plan, files);
	const runsDirectory = defaultRunsDirectory(plan.context.root);
	const scope = runScope(plan, patch, files);
	return writePreparedRun({
		runsDirectory,
		content: {
			schemaVersion: RUN_SCHEMA_VERSION,
			scope,
			files: files.map(({ runFile }) => runFile),
			commits,
			ignore,
			exclusions,
			totals: totals(files, exclusions),
		},
		patch,
		hunks,
		blobs,
		supersedes: await resolveSupersedes({ runsDirectory, scope, ignore, carry: request.carry }),
	});
}
