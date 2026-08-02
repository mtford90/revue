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
	const lines = patchText.split("\n");
	const chunks: string[] = [];
	let current: string[] = [];
	let oldLinesRemaining = 0;
	let newLinesRemaining = 0;
	const flush = () => {
		if (current.length) chunks.push(`${current.join("\n").trimEnd()}\n`);
		current = [];
		oldLinesRemaining = 0;
		newLinesRemaining = 0;
	};

	for (const [index, line] of lines.entries()) {
		if (oldLinesRemaining > 0 || newLinesRemaining > 0) {
			current.push(line);
			if (line.startsWith(" ")) {
				oldLinesRemaining -= 1;
				newLinesRemaining -= 1;
			} else if (line.startsWith("-")) oldLinesRemaining -= 1;
			else if (line.startsWith("+")) newLinesRemaining -= 1;
			continue;
		}

		const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
		if (hunk) {
			current.push(line);
			oldLinesRemaining = hunk[1] === undefined ? 1 : Number(hunk[1]);
			newLinesRemaining = hunk[2] === undefined ? 1 : Number(hunk[2]);
			continue;
		}

		const startsGitFile = line.startsWith("diff --git ");
		const isPlainHeader = line.startsWith("--- ") && lines[index + 1]?.startsWith("+++ ");
		const currentHasGitHeader = current.some((entry) => entry.startsWith("diff --git "));
		const currentHasFileHeader = current.some((entry) => entry.startsWith("--- "));
		const currentIsBinary = current.some((entry) => isBinaryPatch(entry));
		const startsPlainFile =
			isPlainHeader && (!currentHasGitHeader || currentHasFileHeader || currentIsBinary);
		if (startsGitFile || startsPlainFile) flush();
		if (current.length || startsGitFile || startsPlainFile || isPlainHeader) current.push(line);
	}
	flush();
	return chunks.length ? chunks : [patchText];
}

const patchHeaderPath = (chunk: string, marker: "---" | "+++") =>
	chunk
		.split("\n")
		.find((line) => line.startsWith(`${marker} `))
		?.slice(4)
		.split("\t")[0];

function ensureGitHeader(chunk: string): string {
	if (chunk.startsWith("diff --git ")) return chunk;
	const oldPath = patchHeaderPath(chunk, "---");
	const newPath = patchHeaderPath(chunk, "+++");
	const currentPath = newPath === "/dev/null" ? oldPath : newPath;
	const previousPath = oldPath === "/dev/null" ? currentPath : oldPath;
	if (!currentPath || !previousPath) return chunk;
	const stripSidePrefix = (path: string) => path.replace(/^(?:a|b)\//, "");
	return `diff --git a/${stripSidePrefix(previousPath)} b/${stripSidePrefix(currentPath)}\n${chunk}`;
}

const patchMetadata = (metadata: FileDiffMetadata, chunk: string): FileDiffMetadata => {
	const type = /^--- \/dev\/null\s*$/m.test(chunk)
		? "new"
		: /^\+\+\+ \/dev\/null\s*$/m.test(chunk)
			? "deleted"
			: metadata.type;
	return { ...metadata, type };
};

const isBinaryPatch = (patch: string) =>
	/^(?:Binary files .* differ|GIT binary patch)\s*$/m.test(patch);

/** Parse a unified patch using Pierre's public parser into Revue's stable file model. */
export function parsePatch(patchText: string, sourceId = "patch"): DiffFile[] {
	const normalizedPatch = patchText.replaceAll("\r\n", "\n");
	let fileIndex = 0;
	return patchChunks(normalizedPatch).flatMap((chunk, chunkIndex) =>
		parsePatchFiles(ensureGitHeader(chunk), `${sourceId}:${chunkIndex}`, true)
			.flatMap((patch) => patch.files)
			.map((parsedMetadata) => {
				const metadata = patchMetadata(parsedMetadata, chunk);
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
