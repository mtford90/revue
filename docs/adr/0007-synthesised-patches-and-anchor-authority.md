# ADR 0007 — Alternate views synthesise patches; anchors stay on the git hunks

- Status: accepted
- Date: 2026-08-05

## Context

After ADR 0002, the patch view owns a full pipeline: `parsePatch` → row model → syntax highlighting
→ decorations → threads → selection. Two features need to render content that is not the pinned
patch word for word:

- the semantic view (Difftastic), which renders the aligned lines of Difftastic;
- the context expansion in the style of GitHub, which renders unchanged lines from the blobs.

A separate renderer for either feature would duplicate that pipeline. It would also fork the thread
placement, the selection, and the highlighting behaviour in each view.

The threads must also stay coherent across the views. An anchor that one view created must render in
every other view. If it does not, the feedback disappears without a message, and the loss depends on
the view that the reviewer selects.

## Decision

An alternate view of a run is a **synthesised unified patch that Revue replays through the one
canonical pipeline**. An alternate view is never a parallel renderer.

- The semantic view runs `difft --display=json` over the pinned blobs of the run. It synthesises a
  standard unified patch from the aligned lines. It sends that patch through the same `parsePatch` →
  body pipeline as the patch view. It uses two narrow extension points, `resolveRange` and the span
  emphasis, and no special rendering.
- The context expansion treats each gap between two hunks as a numbered boundary. To reveal a fixed
  step, it writes the patch text again from the content-addressed blobs of the run, and then parses
  that text again. `show` never touches Git. The pinned blobs are the only legitimate source of more
  file content.

**The authority of an anchor is the same in every view.** A comment anchor always resolves against
the original hunks of the git patch. It never resolves against a synthesised hunk or a widened hunk.
The `resolveRange` of each view maps the display rows back onto those hunks. Revue refuses a comment
on an alignment line that exists only in Difftastic, and on revealed unchanged context. The
displayed geometry can differ in each view. The authority of an anchor cannot.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| A dedicated semantic renderer over Difftastic JSON | Rejected | It duplicates the highlighting, the threads, the selection, and the decorations. It also moves away from the patch view. |
| Zip Difftastic line numbers onto its scraped ANSI output | Rejected | It breaks easily, and it cannot give exact highlighting of a range. |
| Allow comments on revealed/alignment-only lines | Rejected | Those threads could not render in the patch view. That breaks the symmetry between the views. |
| Read the working tree for context expansion | Rejected | It races the repository and breaks the frozen-input guarantee of ADR 0003. |
| Inject expansion rows directly into the renderer | Rejected | It goes around the parse pipeline and the hunk metadata. |
| Synthesised patches + hunk-anchored `resolveRange` | Chosen | Every view gets every feature of the pipeline with no more work, and the threads render in every view. |

## Consequences

- A future view (word diff, blame, three-way) starts with this question: what patch do I synthesise?
  It does not start with the question: what do I render?
- The ranges that accept a comment are a strict subset of the displayed ranges. The UI must tell the
  reviewer why a line refuses a comment.
- The expansion works offline against any old run, because the blobs are pinned (ADR 0003).
- The extension surface of the renderer is the contract that an alternate view programs against.
  That surface has `resolveRange`, the emphasis spans, and the expansion controls. It extends the
  boundary of ADR 0002.

## Amendments

- 2026-08-07 — [ADR 0014](0014-narrative-depth-and-frozen-context.md) extends this ADR. It does not
  supersede it. The authority of an anchor now has two kinds. A hunk anchor still resolves against
  the original git hunks in every view, exactly as this ADR decides above. A context excerpt that
  the narration cites is a second authority: it resolves against the frozen context of the run, and
  its key is the run ID. An excerpt accepts comments, because it is pinned narration.

  An *ad hoc* context expansion still refuses comments, because a revealed line is not pinned
  narration. If an excerpt anchor no longer resolves, Revue shows it as orphaned. A hunk anchor that
  does not resolve is still fatal.
