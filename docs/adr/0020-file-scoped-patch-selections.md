# ADR 0020 — File-scoped patch selections

- Status: accepted
- Date: 2026-08-21
- Extends: [ADR 0004](0004-store-threads-by-immutable-run.md),
  [ADR 0007](0007-synthesised-patches-and-anchor-authority.md), and
  [ADR 0018](0018-feedback-conversation-across-supersession.md)

## Context

A hunk anchor can express only one side and one original Git hunk. A reviewer can, however, have one
concern spanning removed and added lines or separate hunks in one file. Treating that concern as
several threads fragments one conversation. Reinterpreting historical hunk anchors would break the
persisted feedback contract.

Pointer handling also conflated a click, drag, and activation. Keyboard selection depended on the
currently mounted visual rows, so it could not reliably cross a windowed hunk or file boundary.

## Decision

A thread anchor has a third kind, `patch`:

```ts
{
  kind: "patch",
  filePath: string,
  ranges: NonEmptyArray<{
    oldStart: number,
    side: "additions" | "deletions",
    startLine: number,
    endLine: number
  }>
}
```

Historical `hunk` and `excerpt` anchors retain their schemas and meaning. The public threads CLI
continues to create them with its existing syntax. New comments created on the TUI diff surface use
`patch`, including one-line comments. Because patch anchors make the persisted format incompatible,
the store is version 2. Readers migrate strict historical version-1 hunk/excerpt stores without
reinterpreting their anchors; every subsequent write emits version 2.

`@revue/diff` owns the feedback-neutral `DiffSelection`: file locality, non-emptiness, stop-to-stop
selection, membership, and first and terminal ranges. It also owns logical presentation-row
identity, separate from wrapping: a split row may expose old and new stops, while one stacked
context row may retain both authorities without becoming two keyboard steps. Split vertical motion
stays in the current pane. Horizontal motion prefers a same-row counterpart, then the nearest
changed row on the requested side anywhere in the file; an equal-distance tie resolves to the row
below. The same rule extends selections. A split selection that crosses sides becomes the rectangle
of available old/new stops over the selected presentation-row span. Stacked motion and selection
follow visible old-then-new rows.
A drag confined to one split gutter remains in that side's visible lane.

Persisted selections cross a separate seam: they use one layout-neutral canonical order and merge
adjacent or overlapping ranges whenever hunk and side authority match, even when mixed interaction
order interleaved those ranges. Selection stops come from original parsed hunks and never from
synthesised-only context. Ordinary cursor movement may cross expanded files; selection remains
file-local and uses the complete original-hunk presentation stream.

A click moves the cursor, an actual drag leaves a selection, and a double-click activates a one-line
comment. Fast drags resolve their endpoints through plan order. Wrapped selection edges are paint,
not selectable continuation gutters.

Every patch range validates independently against original hunk authority. Narration ownership is
also evaluated per range. A patch thread whose ranges share one chapter renders inline there; one
whose ranges cross chapters renders only on the Diff surface. Exactly one thread box mounts at the
canonical terminal range. Each attachment carries only a semantic placement (`full`, `deletions`, or
`additions`): the OpenTUI adapter maps that to active split-pane geometry and falls back to full
width when stacked or when a pane is narrower than the adapter's documented usable minimum.
Old-only drafts and saved threads use the deletion pane, new-only ones the addition pane, and mixed
ones full width. Persisted threads do not tint their ranges: attachment placement and count carry
their history without obscuring key-change or intra-line styling. A live selection or composer
continues to highlight every selected range.

Supersession remaps every patch range as one transaction and normalises only after every segment
succeeds. If one segment cannot remap, prep marks the whole carried thread orphaned; no partial
selection is retained.

Selection verbs are deliberately asymmetric: location copy emits one line per range, a permalink is
available only for one normalised range, and editor-open uses the first additions-side range or
refuses. Excerpt verbs do not change.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Reinterpret `hunk` as multi-range | Rejected | It changes historical persisted meaning. |
| Create one thread per range | Rejected | It fragments one concern and its replies. |
| Permit cross-file selections | Rejected | Ownership, editor, and display semantics become ambiguous. |
| Store one file-scoped patch anchor and keep selection in `@revue/diff` | Chosen | It preserves compatibility while making one concern one conversation. |

## Consequences

- Patch selections can cross sides, context rows backed by original hunks, and hunk boundaries, but
  never files or chapters during keyboard movement.
- Windowing and wrapping do not define semantic selection.
- Cross-chapter feedback remains discoverable in Comments and has one unambiguous home on Diff.
- A carried multi-range thread is either wholly remapped or wholly orphaned.
- After version-2 feedback is written, older binaries that understand only version 1 cannot read the
  thread store.
