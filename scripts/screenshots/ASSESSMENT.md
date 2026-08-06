# Screenshot sweep assessment — GitHub-style diff presentation

Sweep of 176 captures: 10 scenarios × widths {80, 120, 180, 240} × split/stack × ayu-dark/ayu-light
(huge-hunk adds a paged shot per combination). Captures live in `out/shots/` (gitignored);
regenerate with `bun run screenshots`. Every capture was reviewed against a fixed rubric:
intra-line emphasis placement and contrast, wrap correctness, continuation gutters, split
alignment, margins, unicode width, and general legibility.

## Verdict

All ten scenarios pass. One blocker was found and fixed during the sweep; everything else is
nit-level or accepted behaviour.

| Scenario | Result |
| --- | --- |
| single-char | OK — emphasis boxes exactly the changed digits, token-aligned both sides |
| word-edit | OK — identifier-shaped emphasis, filler rows keep panes synced |
| multi-edit-line | OK — five separate spans per side, unchanged text unemphasised between them |
| unequal-block | OK after fix — see below |
| whitespace-only | OK — indent changes visible as emphasis over leading whitespace |
| unicode | OK — double-width cells aligned, token-accurate emphasis under CJK/emoji |
| long-lines | OK — 515-char line wraps through 17 rows, continuations clean |
| moved-block | OK — zero emphasis speckle on moved lines |
| mixed-typescript | OK — "very close to GitHub's gestalt" |
| huge-hunk | OK — 300-line wall renders and pages correctly at every width |

## Defect found and fixed

**Equal-count blocks paired dissimilar lines positionally** (GitHub's own rule), painting
near-whole-line emphasis across unrelated lines. Fixed by applying the similarity gate to
positional pairs as well — dissimilar pairs fall back to plain row tint. A deliberate deviation
from GitHub parity, recorded in ADR 0005 and pinned by the `equal-count-block-gate` goldens.

## Accepted behaviours (not defects)

- **One-sided emphasis when a line loses content.** `new URL(request.url).pathname` →
  `url.pathname`: every new-side token exists in the old line, so only the removed side carries
  emphasis, with a hole where the surviving `url` token sits. Honest token-LCS semantics; GitHub's
  token differ produces the same artefact class.
- **Split falls back to the unified layout at 80 columns** (existing responsive threshold), so the
  w80 split/stack captures are identical.
- **Whole-run emphasis on whitespace.** Indent changes emphasise the full new indent run rather
  than only the added columns — a side-effect of tokenising whitespace as runs that aids
  visibility.
- **Filler semantics.** Rows padding a shorter pane opposite an extra line are untinted; rows
  opposite a counterpart's wrap continuation extend the line's own tint.
- **Pane width asymmetry.** Odd split widths give the right pane one extra text column, so the
  same line can wrap 3 rows left vs 2 right; filler rows keep alignment.
- **Emoji glyph bleed.** ⏳/❌ overdraw their cells vertically in some fonts; cell allocation and
  column alignment are unaffected.

## Follow-ups filed on the board

- Light-theme diff row tints are muted relative to GitHub; a saturation bump on light appearances
  would make hunks announce themselves better (emphasis tints are fine as-is).
- Range-selection tint (`selectedHunk`) loses to emphasis backgrounds inside their spans;
  distinguishing selection decorations needs a small decoration-model change.
- Pathological single lines (50k-char minified) map to ~1000 visual rows and mount as one
  windowing unit; consider a per-line visual-row cap with an explicit marker.
- Copying a selection that crosses wrap points yields newlines at each wrap; needs logical-line
  reassembly in the copy path.
