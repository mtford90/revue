import { createTextAttributes } from "@opentui/core";
import { useTheme } from "./theme.ts";

// Narration is authored as prose with light Markdown emphasis. The terminal has
// no renderer for it, so the markers would otherwise show up verbatim.

export type InlineStyle = "bold" | "italic" | "code";
export type InlineSpan = { text: string; style?: InlineStyle };

const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\s][^*]*)\*/g;

/** Split narration into plain and emphasised runs; unpaired markers stay literal. */
export const parseInline = (text: string): InlineSpan[] => {
	const spans: InlineSpan[] = [];
	let cursor = 0;
	for (const match of text.matchAll(INLINE)) {
		const start = match.index ?? 0;
		if (start > cursor) spans.push({ text: text.slice(cursor, start) });
		const [, bold, code, italic] = match;
		if (bold !== undefined) spans.push({ text: bold, style: "bold" });
		else if (code !== undefined) spans.push({ text: code, style: "code" });
		else if (italic !== undefined) spans.push({ text: italic, style: "italic" });
		cursor = start + match[0].length;
	}
	if (cursor < text.length) spans.push({ text: text.slice(cursor) });
	return spans;
};

const spanAttributes = (style: InlineStyle | undefined) =>
	createTextAttributes({ bold: style === "bold", italic: style === "italic" });

/** One paragraph of narration with `code`, **bold** and *italic* runs styled. */
export function Narration({ text, fg }: { text: string; fg?: string }) {
	const theme = useTheme();
	const color = fg ?? theme.text;
	const spans = parseInline(text);
	if (spans.length <= 1 && !spans[0]?.style) {
		return <text fg={color}>{text}</text>;
	}
	return (
		<text fg={color}>
			{spans.map((span, index) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: repeated emphasis runs have no independent identity.
					key={`${index}:${span.text}`}
					fg={span.style === "code" ? theme.heading : color}
					attributes={spanAttributes(span.style)}
				>
					{span.text}
				</span>
			))}
		</text>
	);
}
