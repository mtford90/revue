/** A 0-based, end-exclusive character range within one line's raw text. */
export type IntralineRange = { start: number; end: number };

/** The changed ranges of one paired removed/added line. */
export type IntralineSpans = {
	old: readonly IntralineRange[];
	new: readonly IntralineRange[];
};

/** Positions within one change block: which removed line revises into which added line. */
export type IntralinePair = { oldIndex: number; newIndex: number };

/** Mirrors the renderer's tokenizing limit, beyond which emphasis is not worth its cost. */
const maxLineLength = 1_000;

const tokenPattern = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]+/gu;

type Token = { text: string; start: number; end: number };

const emptySpans: IntralineSpans = { old: [], new: [] };

const tokenise = (line: string): Token[] =>
	[...line.matchAll(tokenPattern)].map((match) => ({
		text: match[0],
		start: match.index,
		end: match.index + match[0].length,
	}));

const commonPrefixLength = (a: string, b: string): number => {
	const limit = Math.min(a.length, b.length);
	for (let index = 0; index < limit; index += 1) {
		if (a.charCodeAt(index) !== b.charCodeAt(index)) return index;
	}
	return limit;
};

const commonSuffixLength = (a: string, b: string): number => {
	const limit = Math.min(a.length, b.length);
	for (let offset = 1; offset <= limit; offset += 1) {
		if (a.charCodeAt(a.length - offset) !== b.charCodeAt(b.length - offset)) return offset - 1;
	}
	return limit;
};

/** Common affix length, the pairing gate's measure of how alike two lines are. */
const similarityScore = (a: string, b: string): number => {
	const prefix = commonPrefixLength(a, b);
	return prefix + commonSuffixLength(a.slice(prefix), b.slice(prefix));
};

/** An affix this short is punctuation such as `;` or `}`, not evidence of a revision. */
const minSharedAffix = 3;

const blankLine = /^\s*$/;

/**
 * The pairing gate. A pair is admitted when its shared affix covers roughly half the
 * shorter line, but a blank line only ever revises into another blank line, and a
 * trivial affix never carries a pair on its own — both are true of unrelated lines.
 */
const isRevisionOf = (a: string, b: string): boolean => {
	if (blankLine.test(a) || blankLine.test(b)) return blankLine.test(a) && blankLine.test(b);
	const score = similarityScore(a, b);
	if (score < minSharedAffix) return false;
	return score * 2 >= Math.min(a.length, b.length);
};

/** Both indices must advance together, so an accepted pair forbids every crossing one. */
const withoutCrossing = (accepted: readonly IntralinePair[], candidate: IntralinePair): boolean =>
	accepted.every(
		(pair) => (pair.oldIndex - candidate.oldIndex) * (pair.newIndex - candidate.newIndex) > 0,
	);

const bySimilarityThenPosition = (
	a: IntralinePair & { score: number },
	b: IntralinePair & { score: number },
) => b.score - a.score || a.oldIndex - b.oldIndex || a.newIndex - b.newIndex;

const greedyPairs = (oldLines: readonly string[], newLines: readonly string[]): IntralinePair[] => {
	const candidates = oldLines
		.flatMap((oldLine, oldIndex) =>
			newLines.map((newLine, newIndex) => ({
				oldIndex,
				newIndex,
				score: similarityScore(oldLine, newLine),
				gated: isRevisionOf(oldLine, newLine),
			})),
		)
		.filter((candidate) => candidate.gated)
		.sort(bySimilarityThenPosition);

	const accepted: IntralinePair[] = [];
	for (const { oldIndex, newIndex } of candidates) {
		if (withoutCrossing(accepted, { oldIndex, newIndex })) accepted.push({ oldIndex, newIndex });
	}
	return accepted.sort((a, b) => a.oldIndex - b.oldIndex);
};

const positionalPairs = (
	oldLines: readonly string[],
	newLines: readonly string[],
): IntralinePair[] =>
	oldLines
		.map((oldLine, index) => ({ oldLine, newLine: newLines[index] ?? "", index }))
		.filter(({ oldLine, newLine }) => isRevisionOf(oldLine, newLine))
		.map(({ index }) => ({ oldIndex: index, newIndex: index }));

/**
 * Similarity pairing scores every removed line against every added one, so a block is
 * capped by that candidate count. Measured on alike 50-character lines: 10,000 candidates
 * cost under 4ms, 90,000 cost 22ms and 250,000 cost 65ms. The cost is paid once per
 * block — the renderer memoises pairing — so the cap sits where a rewrite stops being
 * reviewable line-by-line rather than where the cold cost bites.
 */
const maxPairingCandidates = 100_000;

/**
 * Pair a change block's removed lines with the added lines that revise them. Equal-count
 * blocks pair by position; otherwise the most alike lines pair, unless the block is too
 * large to pair affordably. Either way only sufficiently alike lines pair, and the rest
 * are left without emphasis rather than paired with an unrelated line.
 */
export const pairChangedLines = ({
	oldLines,
	newLines,
}: {
	oldLines: readonly string[];
	newLines: readonly string[];
}): IntralinePair[] => {
	if (oldLines.length === 0 || newLines.length === 0) return [];
	if (oldLines.length === newLines.length) return positionalPairs(oldLines, newLines);
	if (oldLines.length * newLines.length > maxPairingCandidates) return [];
	return greedyPairs(oldLines, newLines);
};

/** Widen a trimmed middle to whole tokens, so spans never cut a word or a code point apart. */
const middleTokens = (line: string, start: number, end: number): Token[] => {
	if (start >= end) return [];
	const tokens = tokenise(line);
	const first = tokens.find((token) => token.end > start);
	const last = tokens.findLast((token) => token.start < end);
	if (!first || !last) return [];
	return tokens.filter((token) => token.start >= first.start && token.end <= last.end);
};

type MatchedFlags = { old: boolean[]; new: boolean[] };

const matchedTokens = (oldTexts: readonly string[], newTexts: readonly string[]): MatchedFlags => {
	const columns = newTexts.length + 1;
	const lengths = new Uint32Array((oldTexts.length + 1) * columns);
	const commonAt = (row: number, column: number) => lengths[row * columns + column] ?? 0;
	for (let row = oldTexts.length - 1; row >= 0; row -= 1) {
		for (let column = newTexts.length - 1; column >= 0; column -= 1) {
			lengths[row * columns + column] =
				oldTexts[row] === newTexts[column]
					? commonAt(row + 1, column + 1) + 1
					: Math.max(commonAt(row + 1, column), commonAt(row, column + 1));
		}
	}

	const flags: MatchedFlags = {
		old: oldTexts.map(() => false),
		new: newTexts.map(() => false),
	};
	let row = 0;
	let column = 0;
	while (row < oldTexts.length && column < newTexts.length) {
		if (oldTexts[row] === newTexts[column]) {
			flags.old[row] = true;
			flags.new[column] = true;
			row += 1;
			column += 1;
		} else if (commonAt(row + 1, column) >= commonAt(row, column + 1)) {
			row += 1;
		} else {
			column += 1;
		}
	}
	return flags;
};

const changedRanges = (tokens: readonly Token[], matched: readonly boolean[]): IntralineRange[] => {
	const ranges: IntralineRange[] = [];
	for (const [index, token] of tokens.entries()) {
		if (matched[index]) continue;
		const previous = ranges.at(-1);
		if (previous && previous.end === token.start) previous.end = token.end;
		else ranges.push({ start: token.start, end: token.end });
	}
	return ranges;
};

/**
 * Locate the changed characters of one paired removed/added line. The common prefix and
 * suffix are trimmed, the remaining middle is compared as tokens, and contiguous changed
 * tokens merge into a single range on each side.
 */
export const intralineSpans = ({
	oldLine,
	newLine,
}: {
	oldLine: string;
	newLine: string;
}): IntralineSpans => {
	if (oldLine.length > maxLineLength || newLine.length > maxLineLength) return emptySpans;

	const prefix = commonPrefixLength(oldLine, newLine);
	const suffix = commonSuffixLength(oldLine.slice(prefix), newLine.slice(prefix));
	const oldTokens = middleTokens(oldLine, prefix, oldLine.length - suffix);
	const newTokens = middleTokens(newLine, prefix, newLine.length - suffix);
	if (oldTokens.length === 0 && newTokens.length === 0) return emptySpans;

	const matched = matchedTokens(
		oldTokens.map((token) => token.text),
		newTokens.map((token) => token.text),
	);
	return {
		old: changedRanges(oldTokens, matched.old),
		new: changedRanges(newTokens, matched.new),
	};
};
