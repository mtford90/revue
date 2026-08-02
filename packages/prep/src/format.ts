import type { DiffFile } from "@revue/diff-model";
import type { RunCommit, RunFile } from "@revue/types";

export type AgentInputFile = {
	diff: DiffFile;
	runFile: RunFile;
};

const lineNumber = (value: number | undefined, width: number): string =>
	value === undefined ? " ".repeat(width) : String(value).padStart(width);

const cleanPatchLine = (line: string): string => line.replace(/\r?\n$/, "");

const formattedLine = ({
	oldLine,
	newLine,
	oldWidth,
	newWidth,
	marker,
	text,
}: {
	oldLine?: number;
	newLine?: number;
	oldWidth: number;
	newWidth: number;
	marker: " " | "+" | "-";
	text: string;
}): string =>
	`${lineNumber(oldLine, oldWidth)} ${lineNumber(newLine, newWidth)} |${marker}${cleanPatchLine(text)}`;

const hunkWidths = (hunk: DiffFile["metadata"]["hunks"][number]) => ({
	oldWidth: Math.max(1, String(hunk.deletionStart + Math.max(0, hunk.deletionCount - 1)).length),
	newWidth: Math.max(1, String(hunk.additionStart + Math.max(0, hunk.additionCount - 1)).length),
});

const contextLines = (
	file: DiffFile,
	content: Extract<
		DiffFile["metadata"]["hunks"][number]["hunkContent"][number],
		{ type: "context" }
	>,
	oldLine: number,
	newLine: number,
	widths: ReturnType<typeof hunkWidths>,
): string[] =>
	Array.from({ length: content.lines }, (_, offset) =>
		formattedLine({
			oldLine: oldLine + offset,
			newLine: newLine + offset,
			...widths,
			marker: " ",
			text: file.metadata.additionLines[content.additionLineIndex + offset] ?? "",
		}),
	);

const deletionLines = (
	file: DiffFile,
	content: Extract<
		DiffFile["metadata"]["hunks"][number]["hunkContent"][number],
		{ type: "change" }
	>,
	oldLine: number,
	widths: ReturnType<typeof hunkWidths>,
): string[] =>
	Array.from({ length: content.deletions }, (_, offset) =>
		formattedLine({
			oldLine: oldLine + offset,
			...widths,
			marker: "-",
			text: file.metadata.deletionLines[content.deletionLineIndex + offset] ?? "",
		}),
	);

const additionLines = (
	file: DiffFile,
	content: Extract<
		DiffFile["metadata"]["hunks"][number]["hunkContent"][number],
		{ type: "change" }
	>,
	newLine: number,
	widths: ReturnType<typeof hunkWidths>,
): string[] =>
	Array.from({ length: content.additions }, (_, offset) =>
		formattedLine({
			newLine: newLine + offset,
			...widths,
			marker: "+",
			text: file.metadata.additionLines[content.additionLineIndex + offset] ?? "",
		}),
	);

const formatHunkLines = (file: DiffFile, hunk: DiffFile["metadata"]["hunks"][number]): string[] => {
	const lines: string[] = [];
	const widths = hunkWidths(hunk);
	let oldLine = hunk.deletionStart;
	let newLine = hunk.additionStart;
	for (const content of hunk.hunkContent) {
		if (content.type === "context") {
			lines.push(...contextLines(file, content, oldLine, newLine, widths));
			oldLine += content.lines;
			newLine += content.lines;
		} else {
			lines.push(...deletionLines(file, content, oldLine, widths));
			lines.push(...additionLines(file, content, newLine, widths));
			oldLine += content.deletions;
			newLine += content.additions;
		}
	}
	if (hunk.noEOFCRDeletions || hunk.noEOFCRAdditions) {
		lines.push(`${" ".repeat(widths.oldWidth + widths.newWidth + 2)}|\\ No newline at end of file`);
	}
	return lines;
};

const fileHeader = (file: AgentInputFile, oldStart: number): string =>
	`=== File: ${file.diff.path} (${file.runFile.status}) | filePath: ${JSON.stringify(file.diff.path)}, oldStart: ${oldStart} ===`;

const metadataSummary = ({ diff, runFile }: AgentInputFile): string => {
	if (runFile.status === "renamed" || runFile.status === "copied") {
		return `${runFile.status === "renamed" ? "Renamed" : "Copied"} ${diff.previousPath} → ${diff.path}`;
	}
	if (runFile.status === "mode-changed") return `Mode ${runFile.oldMode} → ${runFile.newMode}`;
	if (runFile.status === "added") return "Empty file added";
	if (runFile.status === "deleted") return "Empty file deleted";
	return "File metadata changed";
};

const formatFile = (file: AgentInputFile): string[] => {
	if (!file.diff.metadata.hunks.length) {
		return [fileHeader(file, 0), "=== Metadata change @0 ===", metadataSummary(file)];
	}
	return file.diff.metadata.hunks.flatMap((hunk) => [
		fileHeader(file, hunk.deletionStart),
		`=== Hunk @${hunk.deletionStart}: ${cleanPatchLine(hunk.hunkSpecs ?? "")} ===`,
		...formatHunkLines(file.diff, hunk),
	]);
};

export function formatAgentInput(commits: RunCommit[], files: AgentInputFile[]): string {
	const commitLines = commits.map((commit) => `${commit.sha.slice(0, 12)} ${commit.subject}`);
	const hunkLines = files.flatMap(formatFile);
	return [
		"=== COMMIT MESSAGES ===",
		...(commitLines.length ? commitLines : ["(none)"]),
		"",
		"=== HUNKS ===",
		...hunkLines,
		"",
	].join("\n");
}
