/** Which chapter a piece of narration was read in, so a quote of it arrives attributed. */
export type ChapterReference = { order: number; title: string };

const quote = (line: string) => (line.trim() ? `> ${line.trimEnd()}` : ">");

/** Narration copied with its reference: a heading line, then the prose as a blockquote. */
export const chapterReferenceCopy = ({
	reference,
	text,
}: {
	reference: ChapterReference;
	text: string;
}) => ({
	text: [`Ch ${reference.order} · ${reference.title}`, ...text.split("\n").map(quote)].join("\n"),
	notice: `Copied narration · Ch ${reference.order}`,
});
