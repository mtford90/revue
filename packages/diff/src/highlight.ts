import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { inferLanguage } from "./model.ts";
import type { DiffFile, RenderSpan } from "./types.ts";

type NativeSpan = { text: string; fg?: string };
type NativeResponse = { files: { deletions: NativeSpan[][]; additions: NativeSpan[][] }[] };
type NativeHighlighter = {
	highlight(request: {
		theme: string;
		files: {
			path: string;
			language?: string;
			deletions: readonly string[];
			additions: readonly string[];
		}[];
	}): NativeResponse;
};

/**
 * One contiguous run of source on each side, tokenised as its own document. Hunks are
 * discontiguous, so grammar state must not carry from the end of one into the start of the next:
 * a hunk ending inside a comment or string would otherwise colour everything after it as one.
 */
type HighlightDocument = {
	deletionIndex: number;
	deletions: readonly string[];
	additionIndex: number;
	additions: readonly string[];
};

/**
 * What the backends actually colour. A parsed file contributes one document per hunk; quoted code
 * contributes one document. `id` is the array whose identity keys the cache, held apart from the
 * documents because quoted lines are re-ended before tokenising and must still be found by the
 * caller's own array.
 */
type HighlightSubject = {
	id: readonly string[];
	path: string;
	language: string;
	deletionCount: number;
	additionCount: number;
	documents: readonly HighlightDocument[];
};

const fileSubject = (file: DiffFile): HighlightSubject => ({
	id: file.metadata.additionLines,
	path: file.path ?? file.metadata.name,
	language: file.language,
	deletionCount: file.metadata.deletionLines.length,
	additionCount: file.metadata.additionLines.length,
	documents: file.metadata.hunks.map((hunk) => ({
		deletionIndex: hunk.deletionLineIndex,
		deletions: file.metadata.deletionLines.slice(
			hunk.deletionLineIndex,
			hunk.deletionLineIndex + hunk.deletionCount,
		),
		additionIndex: hunk.additionLineIndex,
		additions: file.metadata.additionLines.slice(
			hunk.additionLineIndex,
			hunk.additionLineIndex + hunk.additionCount,
		),
	})),
});

/** A range of unchanged code a narration quotes. It belongs to no patch, so its path names its grammar. */
export type QuotedCode = { path: string; lines: readonly string[] };

// Each side is tokenised as one document split on its own line endings, and frozen quoted lines
// carry none, so re-end them here rather than pinning endings a citation never had.
const quotationSubject = ({ path, lines }: QuotedCode): HighlightSubject => ({
	id: lines,
	path,
	language: inferLanguage(path),
	deletionCount: 0,
	additionCount: lines.length,
	documents: [
		{
			deletionIndex: 0,
			deletions: [],
			additionIndex: 0,
			additions: lines.map((line) => `${line}\n`),
		},
	],
});

export interface HighlightedLines {
	deletions: RenderSpan[][];
	additions: RenderSpan[][];
}

export type SyntaxBackend = "syntect" | "shiki";
export type SyntaxHighlightWarning = {
	code: "native-unavailable";
	message: string;
};
export type SyntaxHighlightingPreparation = {
	backend: SyntaxBackend;
	warning?: SyntaxHighlightWarning;
};

// A selected-hunk metadata copy retains Pierre's line arrays, so key by those
// arrays rather than metadata object identity. One subject is highlighted once per
// syntax theme and selected backend, because both changes recolour every span.
const highlightById = new WeakMap<readonly string[], Map<string, HighlightedLines>>();
// Automatic mode can fall back after an addon has loaded but fails while highlighting.
// Keep the successful backend with each subject/theme rather than treating addon presence as
// proof that its cached spans are usable.
const preparedBackendById = new WeakMap<readonly string[], Map<string, SyntaxBackend>>();
let nativeHighlighter: NativeHighlighter | null | undefined;
let nativeFailure: string | undefined;
let warnedNativeFailure = false;

/** @internal Test seam for reproducing loaded-addon runtime failures. */
export function setNativeHighlighterForTesting(
	highlighter: NativeHighlighter | null | undefined,
): void {
	nativeHighlighter = highlighter;
	nativeFailure = undefined;
	warnedNativeFailure = false;
}

const highlightsFor = (id: readonly string[]) => {
	const existing = highlightById.get(id);
	if (existing) return existing;
	const created = new Map<string, HighlightedLines>();
	highlightById.set(id, created);
	return created;
};

const preparedBackendsFor = (id: readonly string[]) => {
	const existing = preparedBackendById.get(id);
	if (existing) return existing;
	const created = new Map<string, SyntaxBackend>();
	preparedBackendById.set(id, created);
	return created;
};

const rememberPreparedBackend = (
	subjects: readonly HighlightSubject[],
	syntaxTheme: string,
	backend: SyntaxBackend,
) => {
	for (const subject of subjects) preparedBackendsFor(subject.id).set(syntaxTheme, backend);
};

const engine = (): SyntaxBackend | "auto" => {
	const selected = process.env.REVUEDIFF_SYNTAX_ENGINE ?? process.env.REVUE_SYNTAX_ENGINE;
	if (!selected) return "auto";
	if (selected === "syntect" || selected === "shiki") return selected;
	throw new Error(`invalid syntax engine ${JSON.stringify(selected)}; expected syntect or shiki`);
};

const nativeCandidates = () => {
	const executableDirectory = dirname(process.execPath);
	const executable = basename(process.execPath).replace(/\.exe$/i, "");
	const addon =
		executable === "revuediff"
			? "revuediff-highlighter.node"
			: executable === "revue"
				? "revue-highlighter.node"
				: undefined;
	if (addon) return [join(executableDirectory, addon)];
	// Bun source execution has its runtime named "bun"; compiled products retain
	// their product name. Never let an unrecognised executable reach a checkout.
	return executable === "bun"
		? [join(import.meta.dir, "../native/target/release/revue_highlighter.node")]
		: [];
};

const loadNative = (): NativeHighlighter | null => {
	if (nativeHighlighter !== undefined) return nativeHighlighter;
	const require = createRequire(import.meta.url);
	for (const path of nativeCandidates()) {
		try {
			const loaded = require(path) as NativeHighlighter;
			if (typeof loaded.highlight !== "function") throw new Error("missing highlight export");
			nativeHighlighter = loaded;
			return loaded;
		} catch (error) {
			nativeFailure = error instanceof Error ? error.message : String(error);
		}
	}
	nativeHighlighter = null;
	return null;
};

const cacheKey = (syntaxTheme: string, selected: SyntaxBackend) => `${selected}:${syntaxTheme}`;

async function prepareShiki(
	subjects: readonly HighlightSubject[],
	syntaxTheme: string,
): Promise<void> {
	const { highlightWithShiki } = await import("./shikiFallback.ts");
	for (const subject of subjects) {
		const cached = highlightsFor(subject.id);
		const key = cacheKey(syntaxTheme, "shiki");
		if (cached.has(key)) continue;
		try {
			const highlighted: HighlightedLines[] = [];
			for (const document of subject.documents) {
				highlighted.push({
					// Each side of a hunk is one document so multiline grammars retain state within it.
					deletions: await highlightWithShiki(document.deletions, subject.language, syntaxTheme),
					additions: await highlightWithShiki(document.additions, subject.language, syntaxTheme),
				});
			}
			cached.set(key, assemble(subject, highlighted));
		} catch {
			cached.set(key, { deletions: [], additions: [] });
		}
	}
}

/** Place each document's spans at its hunk's offset; a line no document covers stays plain. */
const assemble = (
	subject: HighlightSubject,
	highlighted: readonly HighlightedLines[],
): HighlightedLines => {
	const deletions: RenderSpan[][] = Array.from({ length: subject.deletionCount }, () => []);
	const additions: RenderSpan[][] = Array.from({ length: subject.additionCount }, () => []);
	for (const [index, document] of subject.documents.entries()) {
		const spans = highlighted[index];
		if (!spans) throw new Error("highlighter returned a missing document");
		spans.deletions.forEach((line, offset) => {
			deletions[document.deletionIndex + offset] = line;
		});
		spans.additions.forEach((line, offset) => {
			additions[document.additionIndex + offset] = line;
		});
	}
	return { deletions, additions };
};

function prepareSyntect(subjects: readonly HighlightSubject[], syntaxTheme: string): boolean {
	const native = loadNative();
	if (!native) return false;
	const response = native.highlight({
		theme: syntaxTheme,
		files: subjects.flatMap(({ path, language, documents }) =>
			documents.map(({ deletions, additions }) => ({ path, language, deletions, additions })),
		),
	});
	let next = 0;
	for (const subject of subjects) {
		const highlighted = response.files.slice(next, next + subject.documents.length);
		next += subject.documents.length;
		if (highlighted.length !== subject.documents.length)
			throw new Error("native highlighter returned an incomplete result");
		highlightsFor(subject.id).set(cacheKey(syntaxTheme, "syntect"), assemble(subject, highlighted));
	}
	return true;
}

async function prepare(
	subjects: readonly HighlightSubject[],
	syntaxTheme: string,
): Promise<SyntaxHighlightingPreparation> {
	const selected = engine();
	if (selected !== "shiki") {
		try {
			if (prepareSyntect(subjects, syntaxTheme)) {
				rememberPreparedBackend(subjects, syntaxTheme, "syntect");
				return { backend: "syntect" };
			}
		} catch (error) {
			nativeFailure = error instanceof Error ? error.message : String(error);
		}
		if (selected === "syntect")
			throw new Error(
				`Syntect syntax engine was requested but could not load: ${nativeFailure ?? "unknown error"}`,
			);
	}
	await prepareShiki(subjects, syntaxTheme);
	rememberPreparedBackend(subjects, syntaxTheme, "shiki");
	const warning =
		selected === "auto" && !warnedNativeFailure
			? {
					code: "native-unavailable" as const,
					message: `native Syntect unavailable; using Shiki (${nativeFailure ?? "unknown error"})`,
				}
			: undefined;
	warnedNativeFailure ||= warning !== undefined;
	return { backend: "shiki", warning };
}

/**
 * Precompute syntax spans while retaining the shared cache used by ANSI and OpenTUI.
 * Native Syntect is the normal path; Shiki remains the explicit and fail-open fallback.
 */
export async function prepareSyntaxHighlighting(
	files: readonly DiffFile[],
	syntaxTheme: string,
): Promise<SyntaxHighlightingPreparation> {
	return prepare(files.map(fileSubject), syntaxTheme);
}

/** The same precomputation for quoted code, which no parsed patch accounts for. */
export async function prepareQuotedSyntaxHighlighting(
	quotations: readonly QuotedCode[],
	syntaxTheme: string,
): Promise<SyntaxHighlightingPreparation> {
	return prepare(quotations.map(quotationSubject), syntaxTheme);
}

const lookup = (
	id: readonly string[],
	syntaxTheme: string | undefined,
): HighlightedLines | undefined => {
	if (!syntaxTheme) return undefined;
	const selected = engine();
	const backend = selected === "auto" ? preparedBackendById.get(id)?.get(syntaxTheme) : selected;
	return backend ? highlightById.get(id)?.get(cacheKey(syntaxTheme, backend)) : undefined;
};

export function highlightedLines(
	file: DiffFile,
	syntaxTheme: string | undefined,
): HighlightedLines | undefined {
	return lookup(file.metadata.additionLines, syntaxTheme);
}

/** Spans for each quoted line, or undefined until something has been prepared for that quotation. */
export function quotedLineSpans(
	quotation: QuotedCode,
	syntaxTheme: string | undefined,
): RenderSpan[][] | undefined {
	return lookup(quotation.lines, syntaxTheme)?.additions;
}
