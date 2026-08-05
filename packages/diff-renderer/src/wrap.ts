import type { RenderSpan } from "./types.ts";

// Sanitized cell text is almost always printable ASCII, where one code unit is
// one column; the slow path only pays for lines that actually carry wide or
// combining characters.
const asciiOnly = /^[\x20-\x7e]*$/;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Terminal columns a sanitized, tab-expanded string occupies. */
export const columnWidth = (text: string): number =>
	asciiOnly.test(text) ? text.length : Bun.stringWidth(text);

type Chunk = { text: string; width: number; rest: string };

/** The longest prefix fitting `budget` columns, never cutting a grapheme in half. */
const takeColumns = (text: string, budget: number): Chunk => {
	if (budget <= 0) return { text: "", width: 0, rest: text };
	if (asciiOnly.test(text)) {
		const taken = text.slice(0, budget);
		return { text: taken, width: taken.length, rest: text.slice(budget) };
	}
	let width = 0;
	let end = 0;
	for (const { segment, index } of graphemes.segment(text)) {
		const next = columnWidth(segment);
		if (width + next > budget) break;
		width += next;
		end = index + segment.length;
	}
	return { text: text.slice(0, end), width, rest: text.slice(end) };
};

/** A grapheme wider than the whole budget still has to land on some row. */
const firstGrapheme = (text: string): Chunk => {
	const first = graphemes.segment(text).containing(0)?.segment ?? text.slice(0, 1);
	return { text: first, width: columnWidth(first), rest: text.slice(first.length) };
};

const budgetFor = (width: number) => Math.max(1, Math.floor(width));

/**
 * Hard-wrap one line's spans into visual rows of at most `width` columns, the
 * way a code host wraps code: at the column boundary, with no word-boundary
 * cleverness. A span crossing a boundary is cut into pieces that each keep the
 * original colours and attributes, so emphasis survives the wrap. An empty line
 * still occupies one visual row.
 */
export const wrapSpans = (spans: readonly RenderSpan[], width: number): RenderSpan[][] => {
	const budget = budgetFor(width);
	const rows: RenderSpan[][] = [[]];
	let remaining = budget;
	const emit = (span: RenderSpan, chunk: Chunk) => {
		rows[rows.length - 1]?.push({ ...span, text: chunk.text });
		remaining -= chunk.width;
	};
	const openRow = () => {
		rows.push([]);
		remaining = budget;
	};
	for (const span of spans) {
		let rest = span.text;
		// Bounded: each pass either emits at least one grapheme or opens a row.
		while (rest.length > 0) {
			const chunk = takeColumns(rest, remaining);
			if (chunk.text.length > 0) {
				emit(span, chunk);
				rest = chunk.rest;
			} else if (remaining === budget) {
				const forced = firstGrapheme(rest);
				emit(span, forced);
				rest = forced.rest;
			} else {
				openRow();
			}
		}
	}
	return rows;
};

/** How many visual rows `wrapSpans` would produce, without building them. */
export const wrappedRowCount = (spans: readonly RenderSpan[], width: number): number => {
	const budget = budgetFor(width);
	if (!spans.every((span) => asciiOnly.test(span.text))) return wrapSpans(spans, budget).length;
	const columns = spans.reduce((total, span) => total + span.text.length, 0);
	return Math.max(1, Math.ceil(columns / budget));
};
