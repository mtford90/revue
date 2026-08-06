# ADR 0007 — Alternate views synthesise patches; anchors stay on the git hunks

- Status: accepted
- Date: 2026-08-05

## Context

After ADR 0002, patch view owns a full pipeline: `parsePatch` → row model → syntax highlighting →
decorations → threads → selection. The semantic (Difftastic) view and GitHub-style context
expansion both needed to render content that is not the pinned patch verbatim — Difftastic's
aligned lines in one case, unchanged lines recovered from blobs in the other. Building either as
its own renderer would duplicate that pipeline and fork thread placement, selection, and
highlighting behaviour per view.

Threads also had to stay coherent across views: an anchor created in one view must render in every
other, or feedback silently disappears depending on how the reviewer happens to be looking.

## Decision

Alternate ways of looking at a run are expressed as **synthesised unified patches replayed through
the one canonical pipeline**, never as parallel renderers:

- Semantic view runs `difft --display=json` over the run's pinned blobs and synthesises a standard
  unified patch from the aligned lines, feeding it through the same `parsePatch` → body pipeline as
  patch view, with two narrow extension points (`resolveRange`, span emphasis) instead of bespoke
  rendering.
- Context expansion treats each inter-hunk gap as a numbered boundary and reveals fixed steps by
  rewriting the patch text from the run's content-addressed blobs, then re-parsing it. `show`
  never touches Git; the pinned blobs are the sole legitimate source of extra file content.

**Anchor authority is invariant across views**: comment anchors always resolve against the
original git patch hunks, never the synthesised or widened ones. Each view's `resolveRange` maps
display rows back onto those hunks, and commenting is refused on Difftastic-only alignment lines
and on revealed unchanged context. Displayed geometry may vary per view; anchor authority may not.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| A dedicated semantic renderer over Difftastic JSON | Rejected | Duplicates highlighting, threads, selection, and decorations; drifts from patch view. |
| Zip Difftastic line numbers onto its scraped ANSI output | Rejected | Fragile and a dead end for exact range highlighting. |
| Allow comments on revealed/alignment-only lines | Rejected | Those threads could not render in patch view, breaking cross-view symmetry. |
| Read the working tree for context expansion | Rejected | Races the repository and violates ADR 0003's frozen-input guarantee. |
| Inject expansion rows directly into the renderer | Rejected | Bypasses the parse pipeline and hunk metadata. |
| Synthesised patches + hunk-anchored `resolveRange` | Chosen | Every feature of the pipeline arrives free in every view, and threads render everywhere. |

## Consequences

- A future view (word diff, blame, three-way) starts by asking "what patch do I synthesise", not
  "what do I render".
- Commentable ranges are a strict subset of displayed ranges; the UI must communicate why a line
  refuses a comment.
- Expansion works offline against any old run because blobs are pinned (ADR 0003).
- The renderer's extension surface (`resolveRange`, emphasis spans, expansion controls) is the
  contract alternate views program against, extending the ADR 0002 boundary.
