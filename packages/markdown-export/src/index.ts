import type { Chapter } from "@revue/types";
import {
	emptyViewState,
	type Prologue,
	type RevueChaptersFile,
	type RevueComment,
	type RunFile,
	type ViewState,
	viewStateFileId,
	viewStateKeyChangeId,
} from "@revue/types";

export type MarkdownReview = {
	runId: string;
	files: RunFile[];
	chapters: RevueChaptersFile;
};

export type MarkdownExportSelection =
	| { kind: "full" }
	| { kind: "prologue" }
	| { kind: "chapter-id"; id: string }
	| { kind: "chapter-order"; order: number };

export type MarkdownExportOptions = {
	selection?: MarkdownExportSelection;
	viewState?: ViewState;
	comments?: RevueComment[];
};

export class MarkdownExportError extends Error {}

const heading = (level: number, title: string): string => `${"#".repeat(level)} ${title}`;
const inlineText = (value: string): string => value.replace(/\s+/g, " ").trim();
const prose = (value: string): string => value.replace(/\r\n?/g, "\n").trim();

const codeSpan = (value: string): string => {
	const longestRun = Math.max(0, ...[...value.matchAll(/`+/g)].map(([run]) => run.length));
	const fence = "`".repeat(longestRun + 1);
	const padding = value.startsWith("`") || value.endsWith("`") ? " " : "";
	return `${fence}${padding}${value}${padding}${fence}`;
};

const checked = (value: boolean): "x" | " " => (value ? "x" : " ");

const formatPrologue = (prologue: Prologue, level: number): string[] => {
	const lines = [heading(level, "Prologue"), "", heading(level + 1, "Overview"), ""];
	if (prologue.motivation) lines.push(`**Motivation:** ${inlineText(prologue.motivation)}`, "");
	if (prologue.outcome) lines.push(`**Outcome:** ${inlineText(prologue.outcome)}`, "");
	lines.push(
		`**Complexity:** ${prologue.complexity.level} — ${inlineText(prologue.complexity.reasoning)}`,
		"",
	);

	lines.push(heading(level + 1, "Key changes"), "");
	for (const change of prologue.keyChanges) {
		lines.push(`- **${inlineText(change.summary)}** — ${inlineText(change.description)}`);
	}
	lines.push("", heading(level + 1, "Focus areas"), "");
	for (const area of prologue.focusAreas) {
		lines.push(
			`- **[${area.severity}] ${area.type}: ${inlineText(area.title)}** — ${inlineText(area.description)}`,
		);
		if (area.locations.length) {
			lines.push(`  - Locations: ${area.locations.map(codeSpan).join(", ")}`);
		}
	}

	if (prologue.diagram) {
		lines.push("", heading(level + 1, "Diagram"), "", "```mermaid", prose(prologue.diagram), "```");
	}
	return lines;
};

const chapterFilePaths = (chapter: Chapter): string[] => [
	...new Set(chapter.hunkRefs.map((reference) => reference.filePath)),
];

const findRunFile = (files: Map<string, RunFile>, path: string): RunFile => {
	const file = files.get(path);
	if (!file) {
		throw new MarkdownExportError(
			`Verified chapter references ${JSON.stringify(path)}, but run metadata is missing it`,
		);
	}
	return file;
};

const formatFile = (chapter: Chapter, file: RunFile, state: ViewState): string => {
	const previousPath = file.previousPath ? `; previous path: ${codeSpan(file.previousPath)}` : "";
	return `- [${checked(state.files.includes(viewStateFileId(chapter.id, file.path)))}] ${codeSpan(file.path)} — status: ${file.status}${previousPath}; file total: +${file.additions} / -${file.deletions}`;
};

const formatQuestion = (chapter: Chapter, index: number, state: ViewState): string[] => {
	const question = chapter.keyChanges[index];
	if (!question) return [];
	const lines = [
		`${index + 1}. [${checked(state.keyChanges.includes(viewStateKeyChangeId(chapter.id, index)))}] ${inlineText(question.content)}`,
	];
	for (const reference of question.lineRefs) {
		const range =
			reference.startLine === reference.endLine
				? `line ${reference.startLine}`
				: `lines ${reference.startLine}-${reference.endLine}`;
		lines.push(`   - ${codeSpan(reference.filePath)} — ${reference.side} ${range}`);
	}
	return lines;
};

const commentsForChapter = (chapter: Chapter, comments: readonly RevueComment[]): RevueComment[] =>
	comments
		.filter((comment) =>
			chapter.hunkRefs.some(
				(reference) =>
					reference.filePath === comment.anchor.filePath &&
					reference.oldStart === comment.anchor.oldStart,
			),
		)
		.sort(
			(left, right) =>
				left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
		);

const formatComment = (comment: RevueComment, level: number): string[] => {
	const range =
		comment.anchor.startLine === comment.anchor.endLine
			? `line ${comment.anchor.startLine}`
			: `lines ${comment.anchor.startLine}-${comment.anchor.endLine}`;
	const body = comment.body.replace(/\r\n?/g, "\n").split("\n");
	return [
		heading(level, `Comment ${codeSpan(comment.id)}`),
		"",
		`- Status: ${codeSpan(comment.status)}`,
		`- Anchor: ${codeSpan(comment.anchor.filePath)} — ${comment.anchor.side} ${range}; review unit oldStart ${comment.anchor.oldStart}`,
		"",
		...body.map((line) => (line ? `> ${line}` : ">")),
	];
};

const formatChapter = (
	chapter: Chapter,
	files: Map<string, RunFile>,
	state: ViewState,
	comments: readonly RevueComment[],
	level: number,
): string[] => {
	const lines = [
		heading(level, `Chapter ${chapter.order}: ${inlineText(chapter.title)}`),
		"",
		`Chapter ID: ${codeSpan(chapter.id)}`,
		"",
		`- [${checked(state.chapters.includes(chapter.id))}] Chapter reviewed`,
		"",
		prose(chapter.summary),
		"",
		heading(level + 1, "Files"),
		"",
	];
	for (const path of chapterFilePaths(chapter)) {
		lines.push(formatFile(chapter, findRunFile(files, path), state));
	}
	if (chapter.keyChanges.length) {
		lines.push("", heading(level + 1, "Review questions"), "");
		for (const index of chapter.keyChanges.keys())
			lines.push(...formatQuestion(chapter, index, state));
	}
	const inlineComments = commentsForChapter(chapter, comments);
	if (inlineComments.length) {
		lines.push("", heading(level + 1, "Inline comments"));
		for (const comment of inlineComments) {
			lines.push("", ...formatComment(comment, level + 2));
		}
	}
	return lines;
};

const selectChapter = (
	chapters: Chapter[],
	selection: Extract<MarkdownExportSelection, { kind: "chapter-id" | "chapter-order" }>,
): Chapter => {
	const chapter =
		selection.kind === "chapter-id"
			? chapters.find((candidate) => candidate.id === selection.id)
			: chapters.find((candidate) => candidate.order === selection.order);
	if (chapter) return chapter;
	const requested =
		selection.kind === "chapter-id"
			? `id ${JSON.stringify(selection.id)}`
			: `order ${selection.order}`;
	throw new MarkdownExportError(`No chapter has ${requested}`);
};

/**
 * Format a verified review as deterministic Markdown.
 *
 * This function is intentionally pure and accepts only pinned run metadata, narration, and an
 * optional review-state value. Chapter sections are kept separate from document selection so a
 * future comments formatter can compose at that boundary without coupling export to a comment store.
 */
export function formatMarkdownReview(
	review: MarkdownReview,
	options: MarkdownExportOptions = {},
): string {
	const selection = options.selection ?? { kind: "full" };
	const state = options.viewState ?? emptyViewState();
	const comments = options.comments ?? [];
	const files = new Map(review.files.map((file) => [file.path, file]));
	const ordered = [...review.chapters.chapters].sort((left, right) => left.order - right.order);
	let lines: string[];

	if (selection.kind === "prologue") {
		if (!review.chapters.prologue) throw new MarkdownExportError("This review has no prologue");
		lines = [
			"# Prologue",
			"",
			`Pinned run: ${codeSpan(review.runId)}`,
			"",
			...formatPrologue(review.chapters.prologue, 1).slice(2),
		];
	} else if (selection.kind === "chapter-id" || selection.kind === "chapter-order") {
		const chapter = selectChapter(ordered, selection);
		lines = [
			`# Chapter ${chapter.order}: ${inlineText(chapter.title)}`,
			"",
			`Pinned run: ${codeSpan(review.runId)}`,
			"",
			...formatChapter(chapter, files, state, comments, 1).slice(2),
		];
	} else {
		lines = ["# Revue Review", "", `Pinned run: ${codeSpan(review.runId)}`];
		if (review.chapters.prologue) lines.push("", ...formatPrologue(review.chapters.prologue, 2));
		for (const chapter of ordered)
			lines.push("", ...formatChapter(chapter, files, state, comments, 2));
	}

	return `${lines.join("\n")}\n`;
}
