# ADR 0005 — Intra-line emphasis pairing and spans

- Status: accepted
- Date: 2026-08-05

## Context

The patch view marks the changed characters inside a paired removed/added line with a stronger
diff-tinted background. Producing that emphasis requires two decisions per change block — a run of
N deletion lines followed by M addition lines: which removed line is a revision of which added line,
and which characters within a pair actually changed.

Existing tools answer both differently. GitHub pairs only equal-count blocks, by position, and gives
unequal blocks no emphasis at all. Delta pairs by Levenshtein distance under a 0.6 max-line-distance
gate. Git's `diff-highlight` trims a common prefix and suffix and emphasises the remainder, again
only for equal-count blocks. `codediff.nvim` defaults to similarity pairing at a 0.75 threshold with
a character-level LCS.

Revue's constraints add two more pressures. Emphasis must be cheap enough to compute for whole files
in a terminal render path, and its output must be readable at a glance: character-level results
scatter single-character highlights through a line ("confetti") that cost more attention than they
save.

## Decision

`@revue/diff-model` owns the calculation as pure functions with no renderer or OpenTUI dependency.

**Pairing** is hybrid. Equal-count blocks pair by position, matching GitHub, because the positional
reading is what reviewers already expect from the layout. Unequal blocks fall back to greedy
similarity: candidates score as common prefix length plus common suffix length, a pair is admitted
only when that score covers roughly half the shorter line, the highest-scoring candidates are taken
first, and accepted pairs forbid crossing ones so pairing stays order-preserving. Lines that clear
no gate stay unpaired and carry no emphasis.

**Spans** are token-level. For a pair, the common prefix and suffix are trimmed, the changed middle
is widened to whole token boundaries on each side, and the two token streams — word runs of letters,
digits and underscores; whitespace runs; punctuation runs — are compared by LCS. Unmatched tokens
become spans, and contiguous unmatched tokens merge into one range. Output is 0-based, end-exclusive
character ranges per side, in code units on both sides; the renderer separately owns tab and display
width. Lines over 1,000 characters get no spans, mirroring the renderer's tokenizing limit.
Whitespace-only edits do produce spans, because the background is their only visible signal.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Pair only equal-count blocks by position (GitHub) | Rejected | Leaves the common one-line-becomes-two case with no emphasis at all. |
| Pair by Levenshtein distance gate (delta) | Rejected | Quadratic in line length for a decision that a common-affix score already makes well. |
| Pair purely by similarity, including equal counts (codediff.nvim) | Rejected | Can reorder pairs the positional layout already implies, so emphasis disagrees with the rows. |
| Hybrid: position for equal counts, gated greedy similarity otherwise | Chosen | Keeps GitHub's predictable reading and still emphasises unequal blocks. |
| Prefix/suffix trim only, emphasise the whole remainder (diff-highlight) | Rejected | One changed word in the middle of a line emphasises everything between the first and last edit. |
| Character-level LCS | Rejected | Produces scattered single-character spans that read as noise, and a large LCS matrix per pair. |
| Token-level LCS after prefix/suffix trim | Chosen | Spans land on word boundaries, and trimming keeps the token streams — and the matrix — small. |

## Consequences

- Unpaired lines are a normal outcome, not a failure: a dissimilar removed line simply keeps its
  plain row tint.
- Spans on each side are computed against that side's own token boundaries, so a trim that lands
  mid-token can widen one side further than the other. The two range lists are independent, so the
  asymmetry is visible only as a slightly wider highlight.
- Punctuation runs are single tokens, so changing one character of `);` emphasises the run.
- Ranges are code-unit offsets. Widening to token boundaries keeps them off surrogate-pair and
  grapheme-run interiors, but consumers must not treat them as code-point counts.
- Greedy pairing is quadratic in the number of lines in a change block. Change blocks are small in
  practice; a pathologically large one would need a cap.
