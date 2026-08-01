import {
	type FileDiffMetadata,
	getHighlighterOptions,
	getSharedHighlighter,
	renderDiffWithHighlighter,
} from "@pierre/diffs";
import type { DiffFile, RenderSpan } from "./types.ts";

type HastNode =
	| { type: "text"; value: string }
	| {
			type: "element";
			properties?: Record<string, unknown>;
			children?: HastNode[];
	  };

export interface HighlightedLines {
	deletions: RenderSpan[][];
	additions: RenderSpan[][];
}

// A selected-hunk metadata copy retains Pierre's line arrays, so key by those
// arrays rather than metadata object identity.
const highlightByAdditionLines = new WeakMap<string[], HighlightedLines>();

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

/**
 * Precompute syntax spans with Pierre's public highlighter API. Rendering never
 * waits on this work: absent/failed highlights synchronously fall back to raw text.
 */
export async function prepareSyntaxHighlighting(files: readonly DiffFile[]): Promise<void> {
	for (const file of files) {
		if (highlightByAdditionLines.has(file.metadata.additionLines)) continue;
		try {
			const options = getHighlighterOptions(file.language, { theme: "pierre-dark" });
			const highlighter = await getSharedHighlighter({
				...options,
				preferredHighlighter: "shiki-wasm",
			});
			const rendered = renderDiffWithHighlighter(
				{ ...file.metadata, lang: file.language as FileDiffMetadata["lang"] },
				highlighter,
				{
					theme: "pierre-dark",
					useTokenTransformer: false,
					tokenizeMaxLineLength: 1_000,
					lineDiffType: "word-alt",
					maxLineDiffLength: 10_000,
				},
			);
			highlightByAdditionLines.set(file.metadata.additionLines, {
				deletions: rendered.code.deletionLines.map((line) => flatten(line as HastNode)),
				additions: rendered.code.additionLines.map((line) => flatten(line as HastNode)),
			});
		} catch {
			// Readability is the contract; an unavailable grammar/highlighter is not fatal.
			highlightByAdditionLines.set(file.metadata.additionLines, {
				deletions: [],
				additions: [],
			});
		}
	}
}

export function highlightedLines(file: DiffFile): HighlightedLines | undefined {
	return highlightByAdditionLines.get(file.metadata.additionLines);
}
