// biome-ignore-all lint/suspicious/noControlCharactersInRegex: terminal safety requires matching control bytes.
import type { RenderSpan } from "./types.ts";

// Terminal control strings must be removed before their individual control bytes.
// These patterns cover 7-bit ESC-prefixed strings and their 8-bit C1 equivalents.
const sevenBitControlStrings =
	/\x1b(?:\][\s\S]*?(?:\x07|\x1b\\|\x9c)|[PX^_][\s\S]*?(?:\x1b\\|\x9c)|\[[0-?]*[ -/]*[@-~])/g;
const c1ControlStrings = /[\x90\x98\x9d\x9e\x9f][\s\S]*?(?:\x07|\x1b\\|\x9c)/g;
const c1Csi = /\x9b[0-?]*[ -/]*[@-~]/g;
const lineControlCharacters = /[\x00-\x08\x0a-\x1f\x7f-\x9f]/g;

/** Sanitize an untrusted single terminal row while preserving printable Unicode. */
export function sanitizeTerminalLine(text: string): string {
	return text
		.replace(sevenBitControlStrings, "")
		.replace(c1ControlStrings, "")
		.replace(c1Csi, "")
		.replace(lineControlCharacters, "");
}

/** Sanitize highlighted text without changing its colour metadata. */
export function sanitizeTerminalSpans(spans: readonly RenderSpan[]): RenderSpan[] {
	return spans.flatMap((span) => {
		const text = sanitizeTerminalLine(span.text).replaceAll("\t", "  ");
		return text ? [{ ...span, text }] : [];
	});
}
