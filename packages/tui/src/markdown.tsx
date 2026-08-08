// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI pointer handlers use text renderables.
import { createTextAttributes, type MouseEvent as OpenTUIMouseEvent } from "@opentui/core";
import type { Diagram, DiagramKind } from "@revue/diff";
import type { ReactNode } from "react";
import { useTheme } from "./theme.ts";

// Narration is authored as prose with light Markdown emphasis plus short fenced snippets. The
// terminal has no renderer for it, so the markers would otherwise show up verbatim. Nothing
// else in Markdown is supported: no lists, no tables, no block quotes.

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

/** Narration is prose interrupted by fenced blocks; the info string says what a fence holds. */
export type MarkdownBlock =
	| { type: "prose"; text: string }
	| { type: "code"; info: string; lines: string[] };

const FENCE = / {0,3}```(.*)$/;

/** Split narration into prose runs and fenced blocks; an unclosed fence stays literal prose. */
export const parseBlocks = (text: string): MarkdownBlock[] => {
	const blocks: MarkdownBlock[] = [];
	let prose: string[] = [];
	let open: { info: string; opener: string; lines: string[] } | null = null;
	const closeProse = () => {
		if (prose.length) blocks.push({ type: "prose", text: prose.join("\n") });
		prose = [];
	};
	for (const line of text.split("\n")) {
		const fence = FENCE.exec(line);
		if (open && fence) {
			blocks.push({ type: "code", info: open.info, lines: open.lines });
			open = null;
		} else if (open) open.lines.push(line);
		else if (fence) {
			closeProse();
			open = { info: (fence[1] ?? "").trim(), opener: line, lines: [] };
		} else prose.push(line);
	}
	if (open) {
		// Nothing closed it, so it was never a block: give the lines back to the prose they broke.
		const previous = blocks.at(-1);
		if (previous?.type === "prose") {
			blocks.pop();
			prose.push(previous.text);
		}
		prose.push(open.opener, ...open.lines);
	}
	closeProse();
	return blocks;
};

const blockSource = (block: MarkdownBlock): string =>
	block.type === "prose" ? block.text : [`\`\`\`${block.info}`, ...block.lines, "```"].join("\n");

const DIAGRAM_KINDS: Record<string, DiagramKind> = { ascii: "ascii", mermaid: "mermaid" };

/** The info string is what tells an ASCII figure from Mermaid source from a plain snippet. */
export const diagramKind = (info: string): DiagramKind | null =>
	DIAGRAM_KINDS[info.trim().toLowerCase().split(/\s+/)[0] ?? ""] ?? null;

const isDiagram = (block: MarkdownBlock) =>
	block.type === "code" && diagramKind(block.info) !== null;

/**
 * A diagram leaves the prose for the content column, where it gets the excerpt's chrome and a
 * planned height; every other fence stays inline as a code snippet.
 */
export const splitNarration = (text: string): { prose: string; diagrams: Diagram[] } => {
	const blocks = parseBlocks(text);
	const diagrams = blocks.flatMap((block): Diagram[] => {
		const kind = block.type === "code" ? diagramKind(block.info) : null;
		return kind && block.type === "code" ? [{ kind, lines: block.lines }] : [];
	});
	if (!diagrams.length) return { prose: text, diagrams };
	const prose = blocks
		.filter((block) => !isDiagram(block))
		.map(blockSource)
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return { prose, diagrams };
};

/** A fenced snippet inside narration, wearing the excerpt block's rule and unstyled page. */
function NarrationCode({ lines }: { lines: readonly string[] }) {
	const theme = useTheme();
	return (
		<box flexDirection="column" width="100%">
			{lines.map((line, index) => (
				<box
					// biome-ignore lint/suspicious/noArrayIndexKey: snippet lines have no identity beyond position.
					key={`${index}:${line}`}
					width="100%"
					height={1}
					overflow="hidden"
					backgroundColor={theme.contextBg}
					flexDirection="row"
				>
					<text flexShrink={0} fg={theme.lineNumberFg} selectable={false}>
						{"│ "}
					</text>
					<text fg={theme.text} wrapMode="none" flexShrink={1} minWidth={0} truncate selectable>
						{line}
					</text>
				</box>
			))}
		</box>
	);
}

/** One paragraph of narration with `code`, **bold** and *italic* runs styled. */
function Paragraph({
	text,
	fg,
	prefix,
	onMouseDown,
}: {
	text: string;
	fg?: string;
	prefix?: ReactNode;
	onMouseDown?: (event: OpenTUIMouseEvent) => void;
}) {
	const theme = useTheme();
	const color = fg ?? theme.text;
	const spans = parseInline(text);
	if (spans.length <= 1 && !spans[0]?.style) {
		return (
			<text fg={color} onMouseDown={onMouseDown}>
				{prefix}
				{text}
			</text>
		);
	}
	return (
		<text fg={color} onMouseDown={onMouseDown}>
			{prefix}
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

/** Narration as authored: prose paragraphs with any fenced snippets rendered as code. */
export function Narration({
	text,
	fg,
	prefix,
	onMouseDown,
}: {
	text: string;
	fg?: string;
	prefix?: ReactNode;
	/** Lets a caller hang pointer verbs off the prose; the narration itself has none. */
	onMouseDown?: (event: OpenTUIMouseEvent) => void;
}) {
	const parsed = parseBlocks(text);
	if (!parsed.some((block) => block.type === "code")) {
		return <Paragraph text={text} fg={fg} prefix={prefix} onMouseDown={onMouseDown} />;
	}
	// A fence eats the blank lines around it, so the prose either side loses its own padding.
	const blocks = parsed.flatMap((block): MarkdownBlock[] => {
		if (block.type === "code") return [block];
		const trimmed = block.text.replace(/^\n+|\n+$/g, "");
		return trimmed ? [{ type: "prose", text: trimmed }] : [];
	});
	const firstProse = blocks.findIndex((block) => block.type === "prose");
	return (
		<box flexDirection="column" width="100%">
			{blocks.map((block, index) =>
				block.type === "code" ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: narration blocks have no identity beyond position.
					<NarrationCode key={`${index}:code`} lines={block.lines} />
				) : (
					<Paragraph
						// biome-ignore lint/suspicious/noArrayIndexKey: narration blocks have no identity beyond position.
						key={`${index}:prose`}
						text={block.text}
						fg={fg}
						prefix={index === firstProse ? prefix : undefined}
						onMouseDown={onMouseDown}
					/>
				),
			)}
		</box>
	);
}
