import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { toPierreMetadata } from "./model.ts";
import type { DiffFile, RenderSpan } from "./types.ts";

type HastNode =
	| { type: "text"; value: string }
	| { type: "element"; properties?: Record<string, unknown>; children?: HastNode[] };

type NativeSpan = { text: string; fg?: string };
type NativeResponse = { files: { deletions: NativeSpan[][]; additions: NativeSpan[][] }[] };
type NativeHighlighter = {
	highlight(request: {
		theme: string;
		files: { path: string; language?: string; deletions: string[]; additions: string[] }[];
	}): NativeResponse;
};

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
// arrays rather than metadata object identity. One file is highlighted once per
// syntax theme and selected backend, because both changes recolour every span.
const highlightByAdditionLines = new WeakMap<string[], Map<string, HighlightedLines>>();
// Automatic mode can fall back after an addon has loaded but fails while highlighting.
// Keep the successful backend with each file/theme rather than treating addon presence as
// proof that its cached spans are usable.
const preparedBackendByAdditionLines = new WeakMap<string[], Map<string, SyntaxBackend>>();
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

const highlightsFor = (file: DiffFile) => {
	const existing = highlightByAdditionLines.get(file.metadata.additionLines);
	if (existing) return existing;
	const created = new Map<string, HighlightedLines>();
	highlightByAdditionLines.set(file.metadata.additionLines, created);
	return created;
};

const preparedBackendsFor = (file: DiffFile) => {
	const existing = preparedBackendByAdditionLines.get(file.metadata.additionLines);
	if (existing) return existing;
	const created = new Map<string, SyntaxBackend>();
	preparedBackendByAdditionLines.set(file.metadata.additionLines, created);
	return created;
};

const rememberPreparedBackend = (
	files: readonly DiffFile[],
	syntaxTheme: string,
	backend: SyntaxBackend,
) => {
	for (const file of files) preparedBackendsFor(file).set(syntaxTheme, backend);
};

const engine = (): SyntaxBackend | "auto" => {
	const selected = process.env.REVUEDIFF_SYNTAX_ENGINE ?? process.env.REVUE_SYNTAX_ENGINE;
	if (!selected) return "auto";
	if (selected === "syntect" || selected === "shiki") return selected;
	throw new Error(`invalid syntax engine ${JSON.stringify(selected)}; expected syntect or shiki`);
};

const nativeCandidates = () => {
	const executableDirectory = dirname(process.execPath);
	return [
		join(executableDirectory, "revuediff-highlighter.node"),
		join(executableDirectory, "revue-highlighter.node"),
		join(import.meta.dir, "../native/target/release/revue_highlighter.node"),
	];
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

function colorFromStyle(style: unknown): string | undefined {
	if (typeof style !== "string") return undefined;
	return /(?:^|;)\s*color\s*:\s*(#[0-9a-f]{3,8})/i.exec(style)?.[1];
}

function flatten(node: HastNode | undefined, inheritedColor?: string): RenderSpan[] {
	if (!node) return [];
	if (node.type === "text") return node.value ? [{ text: node.value, fg: inheritedColor }] : [];
	const color = colorFromStyle(node.properties?.style) ?? inheritedColor;
	return (node.children ?? []).flatMap((child) => flatten(child, color));
}

const cacheKey = (syntaxTheme: string, selected: SyntaxBackend) => `${selected}:${syntaxTheme}`;

async function prepareShiki(files: readonly DiffFile[], syntaxTheme: string): Promise<void> {
	const { getHighlighterOptions, getSharedHighlighter, renderDiffWithHighlighter } = await import(
		"@pierre/diffs"
	);
	for (const file of files) {
		const cached = highlightsFor(file);
		const key = cacheKey(syntaxTheme, "shiki");
		if (cached.has(key)) continue;
		try {
			const options = getHighlighterOptions(file.language, { theme: syntaxTheme });
			const highlighter = await getSharedHighlighter({
				...options,
				preferredHighlighter: "shiki-wasm",
			});
			const rendered = renderDiffWithHighlighter(
				toPierreMetadata(file.metadata, file.language),
				highlighter,
				{
					theme: syntaxTheme,
					useTokenTransformer: false,
					tokenizeMaxLineLength: 1_000,
					lineDiffType: "word-alt",
					maxLineDiffLength: 10_000,
				},
			);
			cached.set(key, {
				deletions: rendered.code.deletionLines.map((line) => flatten(line as HastNode)),
				additions: rendered.code.additionLines.map((line) => flatten(line as HastNode)),
			});
		} catch {
			cached.set(key, { deletions: [], additions: [] });
		}
	}
}

function prepareSyntect(files: readonly DiffFile[], syntaxTheme: string): boolean {
	const native = loadNative();
	if (!native) return false;
	const response = native.highlight({
		theme: syntaxTheme,
		files: files.map((file) => ({
			path: file.path ?? file.metadata.name,
			language: file.language,
			deletions: file.metadata.deletionLines,
			additions: file.metadata.additionLines,
		})),
	});
	if (response.files.length !== files.length)
		throw new Error("native highlighter returned an incomplete result");
	for (const [index, file] of files.entries()) {
		const highlighted = response.files[index];
		if (!highlighted) throw new Error("native highlighter returned a missing file");
		highlightsFor(file).set(cacheKey(syntaxTheme, "syntect"), highlighted);
	}
	return true;
}

/**
 * Precompute syntax spans while retaining the shared cache used by ANSI and OpenTUI.
 * Native Syntect is the normal path; Shiki remains the explicit and fail-open fallback.
 */
export async function prepareSyntaxHighlighting(
	files: readonly DiffFile[],
	syntaxTheme: string,
): Promise<SyntaxHighlightingPreparation> {
	const selected = engine();
	if (selected !== "shiki") {
		try {
			if (prepareSyntect(files, syntaxTheme)) {
				rememberPreparedBackend(files, syntaxTheme, "syntect");
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
	await prepareShiki(files, syntaxTheme);
	rememberPreparedBackend(files, syntaxTheme, "shiki");
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

export function highlightedLines(
	file: DiffFile,
	syntaxTheme: string | undefined,
): HighlightedLines | undefined {
	if (!syntaxTheme) return undefined;
	const selected = engine();
	const backend =
		selected === "auto"
			? preparedBackendByAdditionLines.get(file.metadata.additionLines)?.get(syntaxTheme)
			: selected;
	return backend
		? highlightByAdditionLines.get(file.metadata.additionLines)?.get(cacheKey(syntaxTheme, backend))
		: undefined;
}
