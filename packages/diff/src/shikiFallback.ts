import { createHighlighter } from "shiki/bundle/web";
import type { RenderSpan } from "./types.ts";

// Shiki is an explicit fallback. Keeping its public API in this separate module means Bun can
// leave its Oniguruma and language graph out of the Syntect startup path.
type ShikiHighlighter = Awaited<ReturnType<typeof createHighlighter>>;
type ShikiToken = { content: string; color?: string };

const highlighters = new Map<string, Promise<ShikiHighlighter>>();

const highlighterFor = (language: string, theme: string) => {
	const key = `${language}:${theme}`;
	let highlighter = highlighters.get(key);
	if (!highlighter) {
		highlighter = createHighlighter({
			// Revue's language/theme ids are runtime-validated by the public fallback;
			// Shiki's bundled-id union cannot represent those dynamic values statically.
			langs: [language as never],
			themes: [theme as never],
		});
		highlighters.set(key, highlighter);
	}
	return highlighter;
};

const tokenLines = (tokens: ShikiToken[][], sourceLines: readonly string[]): RenderSpan[][] =>
	sourceLines.map((source, index) => {
		const spans = (tokens[index] ?? []).map((token) => ({ text: token.content, fg: token.color }));
		const newline = source.endsWith("\n") ? "\n" : "";
		if (!newline) return spans;
		const final = spans.at(-1);
		if (final) final.text += newline;
		else spans.push({ text: newline, fg: undefined });
		return spans;
	});

/** Tokenise one ordered side as a single document so multiline grammar state is retained. */
export async function highlightWithShiki(
	lines: readonly string[],
	language: string,
	theme: string,
): Promise<RenderSpan[][]> {
	if (!lines.length) return [];
	const highlighter = await highlighterFor(language, theme);
	return tokenLines(
		highlighter.codeToTokensBase(lines.join(""), {
			lang: language as never,
			theme: theme as never,
		}) as ShikiToken[][],
		lines,
	);
}
