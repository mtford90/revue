import { type FileDiffMetadata, getFiletypeFromFileName, parsePatchFiles } from "@pierre/diffs";
import type { DiffFile, DiffFileInput, DiffStats } from "./types.ts";

function usablePath(path: string | undefined): string | undefined {
	if (!path || path === "/dev/null") return undefined;
	return path;
}

export function inferLanguage(path: string): string {
	if (/(?:^|\/)\.env(?:\..*)?$/.test(path)) return "dotenv";
	return getFiletypeFromFileName(path) || "text";
}

export function countDiffStats(metadata: FileDiffMetadata): DiffStats {
	let additions = 0;
	let deletions = 0;
	for (const hunk of metadata.hunks) {
		additions += hunk.additionLines;
		deletions += hunk.deletionLines;
	}
	return { additions, deletions };
}

export function createDiffFile(input: DiffFileInput): DiffFile {
	const path = usablePath(input.path) ?? usablePath(input.metadata.name) ?? input.metadata.name;
	return {
		...input,
		metadata: {
			...input.metadata,
			name: usablePath(input.metadata.name) ?? input.metadata.name,
			prevName: usablePath(input.metadata.prevName),
		},
		path,
		previousPath: usablePath(input.previousPath) ?? usablePath(input.metadata.prevName),
		language: input.language ?? inferLanguage(path),
		stats: input.stats ?? countDiffStats(input.metadata),
	};
}

function patchChunks(patchText: string): string[] {
	const starts = [...patchText.matchAll(/^diff --git /gm)].map((match) => match.index);
	if (starts.length <= 1) return [patchText];
	return starts.map((start, index) =>
		patchText.slice(start, starts[index + 1] ?? patchText.length),
	);
}

const isBinaryPatch = (patch: string) =>
	/^(?:Binary files .* differ|GIT binary patch)\s*$/m.test(patch);

/** Parse a unified patch using Pierre's public parser into Revue's stable file model. */
export function parsePatch(patchText: string, sourceId = "patch"): DiffFile[] {
	const normalizedPatch = patchText.replaceAll("\r\n", "\n");
	let fileIndex = 0;
	return patchChunks(normalizedPatch).flatMap((chunk, chunkIndex) =>
		parsePatchFiles(chunk, `${sourceId}:${chunkIndex}`, true)
			.flatMap((patch) => patch.files)
			.map((metadata) => {
				const index = fileIndex++;
				return createDiffFile({
					id: `${sourceId}:${index}:${metadata.name}`,
					metadata,
					patch: chunk,
					isBinary: isBinaryPatch(chunk),
				});
			}),
	);
}
