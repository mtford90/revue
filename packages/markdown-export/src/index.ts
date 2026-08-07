import type { Chapter } from "@revue/types";
import {
	emptyViewState,
	isExcerptAnchor,
	narratedUnitCount,
	type Prologue,
	partialDepthLabel,
	type ReviewThread,
	type RevueChaptersFile,
	type RunFile,
	type ThreadMessage,
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
	threads?: ReviewThread[];
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

const byCreation = (left: ReviewThread, right: ReviewThread): number =>
	left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);

/**
 * A thread belongs to the chapter that owns its review unit, or — for quoted code, which owns no
 * review unit — to the chapter that cites an excerpt containing it.
 */
const chapterOwnsThread = (chapter: Chapter, { anchor }: ReviewThread): boolean =>
	isExcerptAnchor(anchor)
		? chapter.excerpts.some(
				(excerpt) =>
					excerpt.filePath === anchor.filePath &&
					excerpt.startLine <= anchor.startLine &&
					anchor.endLine <= excerpt.endLine,
			)
		: chapter.hunkRefs.some(
				(reference) =>
					reference.filePath === anchor.filePath && reference.oldStart === anchor.oldStart,
			);

const threadsForChapter = (chapter: Chapter, threads: readonly ReviewThread[]): ReviewThread[] =>
	threads.filter((thread) => chapterOwnsThread(chapter, thread)).sort(byCreation);

const formatMessage = (message: ThreadMessage, level: number): string[] => {
	const body = message.body.replace(/\r\n?/g, "\n").split("\n");
	return [
		heading(level, `Message ${codeSpan(message.id)}`),
		"",
		`- Author: ${codeSpan(message.author.kind)} — ${codeSpan(message.author.name)}`,
		`- Created: ${codeSpan(message.createdAt)}`,
		"",
		...body.map((line) => (line ? `> ${line}` : ">")),
	];
};

const describeAnchor = (anchor: ReviewThread["anchor"]): string => {
	const range =
		anchor.startLine === anchor.endLine
			? `line ${anchor.startLine}`
			: `lines ${anchor.startLine}-${anchor.endLine}`;
	return isExcerptAnchor(anchor)
		? `${codeSpan(anchor.filePath)} — quoted context ${range}`
		: `${codeSpan(anchor.filePath)} — ${anchor.side} ${range}; review unit oldStart ${anchor.oldStart}`;
};

const formatThread = (thread: ReviewThread, level: number): string[] => {
	const lines = [
		heading(level, `Thread ${codeSpan(thread.id)}`),
		"",
		`- Status: ${codeSpan(thread.status)}`,
		`- Created: ${codeSpan(thread.createdAt)}`,
		`- Anchor: ${describeAnchor(thread.anchor)}`,
	];
	for (const message of thread.messages) lines.push("", ...formatMessage(message, level + 1));
	return lines;
};

const formatChapter = (
	chapter: Chapter,
	files: Map<string, RunFile>,
	state: ViewState,
	threads: readonly ReviewThread[],
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
	];
	const paths = chapterFilePaths(chapter);
	// An interlude cites no review units, so it gets no file section at all.
	if (paths.length) {
		lines.push("", heading(level + 1, "Files"), "");
		for (const path of paths) lines.push(formatFile(chapter, findRunFile(files, path), state));
	}
	if (chapter.keyChanges.length) {
		lines.push("", heading(level + 1, "Review questions"), "");
		for (const index of chapter.keyChanges.keys())
			lines.push(...formatQuestion(chapter, index, state));
	}
	const inlineThreads = threadsForChapter(chapter, threads);
	if (inlineThreads.length) {
		lines.push("", heading(level + 1, "Review threads"));
		for (const thread of inlineThreads) lines.push("", ...formatThread(thread, level + 2));
	}
	return lines;
};

/**
 * A zoomed-out narrative says so in the document, so a reader outside Revue cannot mistake it
 * for the whole change. A full-depth export says nothing and stays byte-identical.
 */
const formatCoverage = (review: MarkdownReview): string[] => {
	const label = partialDepthLabel(review.chapters);
	if (!label) return [];
	const prepared = review.files.reduce((total, file) => total + file.referenceStarts.length, 0);
	return [
		"",
		`Narrative depth: ${label} — ${narratedUnitCount(review.chapters)} of ${prepared} review units narrated; the rest are in the run but outside this narrative.`,
	];
};

/**
 * Feedback the narration no longer has a home for. Re-narrating at another depth can stop quoting
 * a commented excerpt, and a document that silently dropped that thread would lose it.
 */
const formatOrphanedThreads = (
	chapters: readonly Chapter[],
	threads: readonly ReviewThread[],
): string[] => {
	const orphaned = threads
		.filter((thread) => !chapters.some((chapter) => chapterOwnsThread(chapter, thread)))
		.sort(byCreation);
	if (!orphaned.length) return [];
	const lines = [
		"",
		heading(2, "Orphaned threads"),
		"",
		"These threads are anchored to code this narrative no longer covers.",
	];
	for (const thread of orphaned) lines.push("", ...formatThread(thread, 3));
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
 * optional review-state and thread values. Chapter sections remain separate from document selection
 * so thread formatting stays independent of persistence.
 */
export function formatMarkdownReview(
	review: MarkdownReview,
	options: MarkdownExportOptions = {},
): string {
	const selection = options.selection ?? { kind: "full" };
	const state = options.viewState ?? emptyViewState();
	const threads = options.threads ?? [];
	const files = new Map(review.files.map((file) => [file.path, file]));
	const ordered = [...review.chapters.chapters].sort((left, right) => left.order - right.order);
	const coverage = formatCoverage(review);
	let lines: string[];

	if (selection.kind === "prologue") {
		if (!review.chapters.prologue) throw new MarkdownExportError("This review has no prologue");
		lines = [
			"# Prologue",
			"",
			`Pinned run: ${codeSpan(review.runId)}`,
			...coverage,
			"",
			...formatPrologue(review.chapters.prologue, 1).slice(2),
		];
	} else if (selection.kind === "chapter-id" || selection.kind === "chapter-order") {
		const chapter = selectChapter(ordered, selection);
		lines = [
			`# Chapter ${chapter.order}: ${inlineText(chapter.title)}`,
			"",
			`Pinned run: ${codeSpan(review.runId)}`,
			...coverage,
			"",
			...formatChapter(chapter, files, state, threads, 1).slice(2),
		];
	} else {
		lines = ["# Revue Review", "", `Pinned run: ${codeSpan(review.runId)}`, ...coverage];
		if (review.chapters.prologue) lines.push("", ...formatPrologue(review.chapters.prologue, 2));
		for (const chapter of ordered)
			lines.push("", ...formatChapter(chapter, files, state, threads, 2));
		lines.push(...formatOrphanedThreads(ordered, threads));
	}

	return `${lines.join("\n")}\n`;
}
