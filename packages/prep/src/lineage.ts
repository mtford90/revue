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
// chapters is the whole point of the link.

const RUN_ID_PATTERN = /^[0-9a-f]{64}$/;

type Candidate = { runId: string; createdAt: string };

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

const candidateFor = async (
	runsDirectory: string,
	runId: string,
	key: string,
): Promise<Candidate | null> => {
	const directory = join(runsDirectory, runId);
	const manifest = await readManifest(directory);
	if (!manifest || scopeKey(manifest.scope, manifest.ignore) !== key) return null;
	if (!(await pathExists(join(directory, "chapters.json")))) return null;
	return { runId: manifest.runId, createdAt: manifest.createdAt };
};

const narratedCandidates = async (runsDirectory: string, key: string): Promise<Candidate[]> => {
	const entries = await readdir(runsDirectory).catch(() => [] as string[]);
	const found = await Promise.all(
		entries
			.filter((entry) => RUN_ID_PATTERN.test(entry))
			.map((runId) => candidateFor(runsDirectory, runId, key)),
	);
	return found.filter((candidate): candidate is Candidate => candidate !== null);
};

const explicitPredecessor = async (runsDirectory: string, runId: string): Promise<string> => {
	const manifest = await readManifest(join(runsDirectory, runId));
	if (!manifest) {
		throw new PrepArgumentError(
			`--carry-from names a run this repository has no record of: ${runId}`,
		);
	}
	return manifest.runId;
};

/** The run a newly prepared run supersedes, or undefined when it starts a fresh lineage. */
export async function resolveSupersedes({
	runsDirectory,
	scope,
	ignore,
	carry,
}: ResolveSupersedesInput): Promise<string | undefined> {
	if (carry.kind === "none") return undefined;
	if (carry.kind === "explicit") return explicitPredecessor(runsDirectory, carry.runId);
	const candidates = await narratedCandidates(runsDirectory, scopeKey(scope, ignore));
	const mostRecent = candidates.sort(
		(left, right) =>
			right.createdAt.localeCompare(left.createdAt) || right.runId.localeCompare(left.runId),
	)[0];
	return mostRecent?.runId;
}
