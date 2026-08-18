# ADR 0005 — Intra-line emphasis pairing and spans

- Status: accepted
- Date: 2026-08-05

## Context

The patch view marks the changed characters in a pair of one removed line and one added line. It
marks them with a stronger background in the diff tint. A change block is a sequence of N deletion
lines and then M addition lines. Each change block needs two decisions:

- which removed line is a revision of which added line;
- which characters inside a pair changed.

Other tools answer these two questions differently:

- GitHub pairs only blocks with equal counts, and it pairs them by position. It gives no emphasis to
  a block with unequal counts.
- Delta pairs by Levenshtein distance, under a `max-line-distance` gate of 0.6.
- The `diff-highlight` tool of Git trims a common prefix and a common suffix, and it emphasises the
  remainder. It also does this only for blocks with equal counts.
- `codediff.nvim` pairs by similarity, by default, at a threshold of 0.75, with an LCS at the
  character level.

The constraints of Revue add two more limits. First, the emphasis must be cheap enough to compute
for whole files in a terminal render path. Second, a reader must understand the output immediately.
A result at the character level puts many single-character highlights through a line. Those
highlights cost more attention than they save.

## Decision

`@revue/diff-model` owns the calculation. The calculation is pure functions. It has no dependency on
the renderer and no dependency on OpenTUI.

**Pairing** is hybrid. A block with equal counts pairs by position, as GitHub does, because the
layout already makes a reviewer expect that reading. A block with unequal counts falls back to
greedy similarity. The score of a candidate is the length of the common prefix plus the length of
the common suffix. Revue takes the candidates with the highest score first. An accepted pair forbids
a pair that crosses it, thus the pairing keeps the order of the lines.

**A similarity gate applies to both paths.** Revue admits a pair only when its score covers about
half of the shorter line. A line that passes no gate stays unpaired and gets no emphasis.

The gate on the positional pairs is a deliberate deviation from parity with GitHub. Without the
gate, a block of equal size that is a rewrite pairs unrelated lines by position alone. Those lines
share almost nothing, thus the spans then cover almost all of both lines. That emphasis states that
one line became the other line, and that is not true.

The `max-line-distance` of Delta and the refusal of `diff-highlight` to emphasise a whole line show
the same care. The loss of emphasis on a pair that is a true rewrite costs a reviewer little. Strong
emphasis across unrelated lines gives the reviewer wrong information.

Revue only gates a positional pair. It never matches that pair again. A block with equal counts does
not compete lines across positions. Thus a pair that survives always agrees with the rows that the
layout shows.

**Spans** are at the token level. For a pair, Revue does these steps:

1. It trims the common prefix and the common suffix.
2. It widens the changed middle to whole token boundaries on each side.
3. It compares the two token streams by LCS.

A token stream has three kinds of token:

- a word group of letters, digits and underscores;
- a whitespace group;
- a punctuation group.

A token with no match becomes a span. Adjacent tokens with no match merge into one range. The output
is a character range for each side. A range starts at 0, excludes its end, and counts code units on
both sides. The renderer separately owns the tab and the display width. A line of more than 1,000
characters gets no spans; this limit is the same as the tokenize limit of the renderer. An edit of
whitespace only does produce spans, because the background is its only visible signal.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Pair only equal-count blocks by position (GitHub) | Rejected | The common case where one line becomes two lines then gets no emphasis at all. |
| Pair by Levenshtein distance gate (delta) | Rejected | It is quadratic in the length of a line. A score from the common affixes already makes that decision well. |
| Pair purely by similarity, including equal counts (codediff.nvim) | Rejected | It can change the order of the pairs that the positional layout implies. Then the emphasis disagrees with the rows. |
| Hybrid: gated position for equal counts, gated greedy similarity otherwise | Chosen | It keeps the predictable reading of GitHub and still emphasises blocks with unequal counts. |
| Pair equal counts by position with no gate (GitHub parity) | Rejected | A rewrite of the same size puts emphasis on almost all of two unrelated lines. |
| Prefix/suffix trim only, emphasise the whole remainder (diff-highlight) | Rejected | One changed word in the middle of a line emphasises all the text between the first edit and the last edit. |
| Character-level LCS | Rejected | It makes many single-character spans that a reader cannot use. It also makes a large LCS matrix for each pair. |
| Token-level LCS after prefix/suffix trim | Chosen | The spans stop at word boundaries. The trim keeps the token streams small, and thus the matrix small. |

## Consequences

- An unpaired line is a normal result, not a failure. A removed line that is not similar keeps the
  plain tint of its row. This now includes blocks with equal counts. Thus a block of the same size
  can show emphasis on some rows and no emphasis on other rows, where GitHub would emphasise every
  row.
- The gate is a heuristic on the common affixes. Thus a rewrite that keeps a long shared prefix
  still pairs, even when little else stays the same. One example is a changed argument list under an
  identical call.
- The rule of half the shorter line has no effect on short lines. Thus the gate has two more guards:
  - a blank line pairs only with another blank line;
  - an affix of less than three characters never holds a pair on its own.

  Without these guards, a blank line paired with a statement, and a single `}` paired with any line
  that ends in `}`. Each of these put emphasis across a whole unrelated line. Two blank lines still
  pair. Thus an edit of trailing whitespace or of the indent keeps the background, which is its only
  signal.
- Revue computes the spans of each side against the token boundaries of that side. Thus a trim that
  stops inside a token can widen one side more than the other side. The two lists of ranges are
  independent. The difference is visible only as a highlight that is a little wider.
- A punctuation group is one token. Thus a change to one character of `);` emphasises the whole
  group.
- A range is an offset in code units, and a consumer must not use it as a count of code points.
  Token boundaries alone do not keep a range outside a grapheme. A combining mark tokenises as
  punctuation. Thus `é` that becomes `è` would emphasise the mark without its base character. Revue
  therefore moves each range outwards to whole grapheme clusters. The renderer depends on this,
  because it must not cut a span inside a cluster.
- Greedy pairing is quadratic in the number of lines in a change block. Thus a block with more than
  100,000 candidates (removed lines × added lines) skips the pairing, and its rows keep the plain
  tint. Hosts apply the same degradation to content that is too large. The renderer memoises the
  pairing, thus the cap guards against an extreme case and not against the first computation. A
  measurement gave 22ms for 90,000 candidates one time, but a block of a whole file cost seconds and
  gigabytes. A block with equal counts pairs by position in linear time, thus the cap never applies
  to it.
- The pairing results are therefore cheap enough to compute for each parse, but not for each render.
  The renderer memoises them on the parsed change block.

## Amendment

ADR 0013 replaces the active package boundary with `@revue/diff` and `@revue/diff-opentui`. The names above are historical. They describe the implementation at the time of this decision.
