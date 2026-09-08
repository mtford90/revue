import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
	type RunIgnoreInputs,
	type RunManifest,
	type RunScope,
	runManifestSchema,
} from "@revue/types";
import { type CarryRequest, PrepArgumentError } from "./scope.ts";

// A review is iterative: the run prepared after the agent changed code continues the narrated run
// the reviewer read. Only a narrated predecessor is auto-selected, because carrying forward
// chapters is the whole point of the link. Runs prepared after it and never narrated are pending
// continuations of the same review, and the feedback that moved onto them moves on again.

const RUN_ID_PATTERN = /^[0-9a-f]{64}$/;

export type ResolveSupersedesInput = {
	runsDirectory: string;
	scope: RunScope;
	ignore: RunIgnoreInputs | undefined;
	carry: CarryRequest;
};

/** The prep arguments a run was made with, ignoring the revisions those arguments resolved to. */
const scopeKey = (scope: RunScope, ignore: RunIgnoreInputs | undefined): string =>
	JSON.stringify([
		scope.mode,
		scope.comparison,
		scope.base.ref,
		scope.head.ref,
		ignore?.session ?? [],
	]);

const pathExists = async (path: string): Promise<boolean> => {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
};

const readManifest = async (directory: string): Promise<RunManifest | null> => {
	try {
		return runManifestSchema.parse(JSON.parse(await readFile(join(directory, "run.json"), "utf8")));
	} catch {
		return null;
	}
};

/** One run on disk: its manifest, where it lives, and whether anyone has narrated it. */
export type RunRecord = { directory: string; manifest: RunManifest; narrated: boolean };

const recordFor = async (runsDirectory: string, runId: string): Promise<RunRecord | null> => {
	const directory = join(runsDirectory, runId);
	const manifest = await readManifest(directory);
	if (!manifest) return null;
	return { directory, manifest, narrated: await pathExists(join(directory, "chapters.json")) };
};

/** Every readable run of a repository, newest first. */
export async function readRunRecords(runsDirectory: string): Promise<RunRecord[]> {
	const entries = await readdir(runsDirectory).catch(() => [] as string[]);
	const found = await Promise.all(
		entries.filter((entry) => RUN_ID_PATTERN.test(entry)).map((id) => recordFor(runsDirectory, id)),
	);
	return found
		.filter((record): record is RunRecord => record !== null)
		.sort(
			(left, right) =>
				right.manifest.createdAt.localeCompare(left.manifest.createdAt) ||
				right.manifest.runId.localeCompare(left.manifest.runId),
		);
}

const shortId = (runId: string): string => runId.slice(0, 12);

/**
 * The run and its ancestors up to and including the first narrated one, nearest first. An
 * unnarrated run is a pending continuation of that narrated run, so this is the chain feedback
 * has to be gathered along.
 */
const chainFrom = (byId: ReadonlyMap<string, RunRecord>, runId: string): RunRecord[] => {
	const record = byId.get(runId);
	if (!record) return [];
	if (record.narrated) return [record];
	const parent = record.manifest.supersedes;
	const rest = parent && parent !== runId ? chainFrom(byId, parent) : [];
	return [record, ...rest];
};

/** The runs prepared after `anchor` that nobody narrated, oldest first: feedback strands there. */
const pendingDescendants = (records: readonly RunRecord[], anchor: string): RunRecord[] => {
	const byId = new Map(records.map((record) => [record.manifest.runId, record]));
	return records
		.filter(
			(record) =>
				!record.narrated &&
				record.manifest.runId !== anchor &&
				chainFrom(byId, record.manifest.runId).some((link) => link.manifest.runId === anchor),
		)
		.reverse();
};

/** How a newly prepared run continues the review before it, or starts a fresh one. */
export type ResolvedLineage = {
	/** The run recorded as superseded, or undefined when this run starts a fresh lineage. */
	supersedes: string | undefined;
	/** Every run whose feedback moves onto the new run: the predecessor and the pending runs after it. */
	threadSources: string[];
	/** Carry decisions that cost the reviewer something, for prep to say out loud. */
	notes: string[];
};

const fresh: ResolvedLineage = { supersedes: undefined, threadSources: [], notes: [] };

const continuing = (records: readonly RunRecord[], predecessor: RunRecord): ResolvedLineage => {
	const runId = predecessor.manifest.runId;
	return {
		supersedes: runId,
		threadSources: [
			runId,
			...pendingDescendants(records, runId).map((record) => record.manifest.runId),
		],
		notes: [],
	};
};

/**
 * `--carry-from` may name a pending run, because that is where the last prep left the feedback.
 * Chapters can only come from a narrated run, so the lineage chains through the pending run to the
 * narrated run it continues, and the feedback on every run in between comes along.
 */
const explicitLineage = (records: readonly RunRecord[], runId: string): ResolvedLineage => {
	const byId = new Map(records.map((record) => [record.manifest.runId, record]));
	const named = byId.get(runId);
	if (!named) {
		throw new PrepArgumentError(
			`--carry-from names a run this repository has no record of: ${runId}`,
		);
	}
	if (named.narrated) return continuing(records, named);
	const ancestor = chainFrom(byId, runId).find((record) => record.narrated);
	if (!ancestor) {
		return {
			...continuing(records, named),
			notes: [
				`--carry-from ${shortId(runId)} was never narrated and continues no narrated run: no chapters carry forward`,
			],
		};
	}
	return {
		...continuing(records, ancestor),
		notes: [
			`--carry-from ${shortId(runId)} is not narrated: this run continues its narrated ancestor ${shortId(ancestor.manifest.runId)} and takes the feedback left on ${shortId(runId)}`,
		],
	};
};

/** The lineage a newly prepared run records, resolved from the runs already on disk. */
export async function resolveLineage({
	runsDirectory,
	scope,
	ignore,
	carry,
}: ResolveSupersedesInput): Promise<ResolvedLineage> {
	if (carry.kind === "none") return fresh;
	const records = await readRunRecords(runsDirectory);
	if (carry.kind === "explicit") return explicitLineage(records, carry.runId);
	const key = scopeKey(scope, ignore);
	const narrated = records.find(
		({ manifest, narrated }) => narrated && scopeKey(manifest.scope, manifest.ignore) === key,
	);
	return narrated ? continuing(records, narrated) : fresh;
}

/** The run a newly prepared run supersedes, or undefined when it starts a fresh lineage. */
export async function resolveSupersedes(
	input: ResolveSupersedesInput,
): Promise<string | undefined> {
	return (await resolveLineage(input)).supersedes;
}
