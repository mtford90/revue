# ADR 0004 — Store comments by immutable run

- Status: accepted
- Date: 2026-08-02

## Context

Inline comments are mutable review feedback, while a prepared run is an immutable record of pinned
code. Review progress is narration-sensitive and therefore keyed by `runKey`, but a comment must
survive regeneration of `chapters.json` for the same frozen patch. A path and line range alone are
also insufficient because one path can contribute multiple hunks and chapters.

The terminal renderer must own pointer geometry and inline row placement without adopting Revue's
comment lifecycle or Hunk's comment model.

## Decision

Revue stores comments in repository-local `.revue/comments.json`, outside prepared run directories.
The validated, atomically replaced file is keyed by the full immutable `runId`. Every independently
identified comment records a UUID, creation time, body, reversible open/dealt-with status, and an
anchor containing `(filePath, oldStart, side, startLine, endLine)`.

All display, export, and agent-readable operations load a verified run and reject comment anchors
that do not belong to exactly one of its pinned review units. Chapter association is derived from
`(filePath, oldStart)`, so narration can change without moving an anchor to a different hunk.

`@revue/diff-renderer` exposes comment-neutral line-range selection and inline-attachment contracts.
The TUI owns comment IDs, persistence, lifecycle controls, and presentation. Semantic diff remains
read-only and does not create or interpret anchors.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Write comments inside the run directory | Rejected | Mutates the immutable review input and complicates integrity guarantees. |
| Key comments by narration-sensitive `runKey` | Rejected | Regenerating chapters would hide feedback for unchanged frozen code. |
| Anchor only by path and line range | Rejected | Cannot distinguish review units when one path has multiple hunks. |
| Store a chapter ID in every anchor | Rejected | Couples durable feedback identity to regeneratable narration. |
| Keep a validated runId-keyed mutable store with review-unit anchors | Chosen | Preserves immutable runs, survives narration changes, and validates exact patch identity. |

## Consequences

- Multiple comments may share an anchor because identity belongs to each UUID, not the range.
- Hard deletion is permanent; dealt-with status remains visible and reversible.
- Corrupt or stale local comment state blocks display, export, and agent listing rather than silently
  relocating feedback.
- Atomic replacement prevents readers from observing a partially written comments file; concurrent
  session coordination beyond preserving other run keys remains future work.
- Replies, root-comment editing, and semantic anchors require separate product decisions.
