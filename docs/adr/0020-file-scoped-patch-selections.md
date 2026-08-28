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
`patch`, including one-line comments.

`@revue/diff` owns the feedback-neutral `DiffSelection`: canonical display order, file locality,
non-emptiness, adjacent same-hunk/side normalisation, stop-to-stop selection, membership, and first
and terminal ranges. Selection stops come from original parsed hunks and never from synthesised-only
context. Normal cursor movement may retain additions-first replacement pairing; selecting uses the
complete file-local stream with both sides.

A click moves the cursor, an actual drag leaves a selection, and a double-click activates a one-line
comment. Fast drags resolve their endpoints through plan order. Wrapped selection edges are paint,
not selectable continuation gutters.

Every patch range validates independently against original hunk authority. Narration ownership is
also evaluated per range. A patch thread whose ranges share one chapter renders inline there; one
whose ranges cross chapters renders only on the Diff surface. Exactly one thread box mounts at the
canonical terminal range while all ranges receive the selection tint.

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
