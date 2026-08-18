import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
	type RunManifest,
	type RunManifestContent,
	runManifestContentSchema,
	runManifestSchema,
} from "@revue/types";
import { z } from "zod";

export class RunArtifactError extends Error {}

export type PreparedRun = {
	directory: string;
	manifest: RunManifest;
	patch: string;
	hunks: string;
};

export type WritePreparedRunInput = {
	runsDirectory: string;
	content: Omit<RunManifestContent, "patchSha256" | "hunksSha256">;
	patch: string;
	hunks: string;
	blobs: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
	createdAt?: string;
	/** The narrated run this one continues, recorded once at creation and never mutated. */
	supersedes?: string;
};

export const digest = (content: string | Uint8Array<ArrayBuffer>): string =>
	createHash("sha256").update(content).digest("hex");

export const defaultRunsDirectory = (repositoryRoot: string): string =>
	join(repositoryRoot, ".revue", "runs");

const canonicalJson = (value: unknown): string => {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
		left.localeCompare(right),
	);
	return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
};

export const runIdFor = (content: RunManifestContent): string =>
	digest(canonicalJson(runManifestContentSchema.parse(content)));

const manifestContent = ({
	runId: _runId,
	createdAt: _createdAt,
	supersedes: _supersedes,
	...content
}: RunManifest) => content;

const parseJson = <T>(path: string, raw: string, parser: (value: unknown) => T): T => {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		throw new RunArtifactError(`${path} is not valid JSON: ${describe(error)}`);
	}
	try {
		return parser(value);
	} catch (error) {
		if (error instanceof z.ZodError) {
			throw new RunArtifactError(
				`${path} does not match the run schema:\n${z.prettifyError(error)}`,
			);
		}
		throw error;
	}
};

const readText = async (path: string): Promise<string> => {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		throw new RunArtifactError(`Could not read ${path}: ${describe(error)}`);
	}
};

const requiredBlobHashes = (manifest: RunManifest): string[] =>
	[...manifest.files.flatMap((file) => [file.oldBlob, file.newBlob])].filter(
		(hash): hash is string => hash !== null,
	);

const verifyBlobs = async (directory: string, manifest: RunManifest): Promise<void> => {
	await Promise.all(
		[...new Set(requiredBlobHashes(manifest))].map(async (hash) => {
			const path = join(directory, "blobs", hash);
			let content: Uint8Array<ArrayBuffer>;
			try {
				content = new Uint8Array(await readFile(path));
			} catch (error) {
				throw new RunArtifactError(`Could not read run blob ${hash}: ${describe(error)}`);
			}
			if (digest(content) !== hash)
				throw new RunArtifactError(`Run blob ${hash} failed integrity check`);
		}),
	);
};

export async function loadPreparedRun(directory: string): Promise<PreparedRun> {
	const manifestPath = join(directory, "run.json");
	const manifest = parseJson(manifestPath, await readText(manifestPath), (value) =>
		runManifestSchema.parse(value),
	);
	if (runIdFor(manifestContent(manifest)) !== manifest.runId) {
		throw new RunArtifactError(`${manifestPath} has an invalid runId`);
	}
	const patch = await readText(join(directory, "diff.patch"));
	if (digest(patch) !== manifest.patchSha256) {
		throw new RunArtifactError(`${join(directory, "diff.patch")} failed integrity check`);
	}
	const hunks = await readText(join(directory, "hunks.txt"));
	if (digest(hunks) !== manifest.hunksSha256) {
		throw new RunArtifactError(`${join(directory, "hunks.txt")} failed integrity check`);
	}
	await verifyBlobs(directory, manifest);
	return { directory, manifest, patch, hunks };
}

const pathExists = async (path: string): Promise<boolean> => {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
};

const writeBlobs = async (
	directory: string,
	manifest: RunManifest,
	blobs: ReadonlyMap<string, Uint8Array<ArrayBuffer>>,
): Promise<void> => {
	const hashes = [...new Set(requiredBlobHashes(manifest))];
	await mkdir(join(directory, "blobs"), { recursive: true });
	await Promise.all(
		hashes.map(async (hash) => {
			const content = blobs.get(hash);
			if (!content) throw new RunArtifactError(`Missing content for run blob ${hash}`);
			if (digest(content) !== hash)
				throw new RunArtifactError(`Run blob ${hash} has the wrong digest`);
			await writeFile(join(directory, "blobs", hash), content);
		}),
	);
};

export async function writePreparedRun(input: WritePreparedRunInput): Promise<PreparedRun> {
	const content = runManifestContentSchema.parse({
		...input.content,
		patchSha256: digest(input.patch),
		hunksSha256: digest(input.hunks),
	});
	const manifest = runManifestSchema.parse({
		...content,
		runId: runIdFor(content),
		createdAt: input.createdAt ?? new Date().toISOString(),
		...(input.supersedes ? { supersedes: input.supersedes } : {}),
	});
	const directory = join(input.runsDirectory, manifest.runId);
	if (await pathExists(directory)) return loadPreparedRun(directory);

	await mkdir(input.runsDirectory, { recursive: true });
	const temporary = join(input.runsDirectory, `.tmp-${basename(directory)}-${randomUUID()}`);
	try {
		await mkdir(temporary);
		await writeBlobs(temporary, manifest, input.blobs);
		await writeFile(join(temporary, "diff.patch"), input.patch, "utf8");
		await writeFile(join(temporary, "hunks.txt"), input.hunks, "utf8");
		await writeFile(join(temporary, "run.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
		try {
			await rename(temporary, directory);
		} catch (error) {
			if (!(await pathExists(directory))) throw error;
			await rm(temporary, { recursive: true, force: true });
		}
		return loadPreparedRun(directory);
	} catch (error) {
		await rm(temporary, { recursive: true, force: true });
		throw error;
	}
}

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
