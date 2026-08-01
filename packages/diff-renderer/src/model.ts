import { type FileDiffMetadata, getFiletypeFromFileName, parsePatchFiles } from "@pierre/diffs";
import type { DiffFile, DiffFileInput, DiffStats } from "./types.ts";

function normalizePath(path: string | undefined): string | undefined {
	if (!path || path === "/dev/null") return undefined;
	return path.replace(/^(?:a|b)\//, "");
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
	const path =
		normalizePath(input.path) ?? normalizePath(input.metadata.name) ?? input.metadata.name;
	return {
		...input,
		metadata: {
			...input.metadata,
			name: normalizePath(input.metadata.name) ?? input.metadata.name,
			prevName: normalizePath(input.metadata.prevName),
		},
		path,
		previousPath: normalizePath(input.previousPath) ?? normalizePath(input.metadata.prevName),
		language: input.language ?? inferLanguage(path),
		stats: input.stats ?? countDiffStats(input.metadata),
	};
}

/** Parse a unified patch using Pierre's public parser into Revue's stable file model. */
export function parsePatch(patchText: string, sourceId = "patch"): DiffFile[] {
	return parsePatchFiles(patchText.replaceAll("\r\n", "\n"), sourceId, true)
		.flatMap((patch) => patch.files)
		.map((metadata, index) =>
			createDiffFile({
				id: `${sourceId}:${index}:${normalizePath(metadata.name) ?? metadata.name}`,
				metadata,
				patch: patchText,
			}),
		);
}
