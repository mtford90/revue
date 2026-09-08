# ADR 0022 — Context anchors on revealed lines

- Status: accepted
- Date: 2026-09-07
- Extends: [ADR 0007](0007-synthesised-patches-and-anchor-authority.md), [ADR 0014](0014-narrative-depth-and-frozen-context.md)

## Context

ADR 0007 refuses comments on revealed unchanged context, because a hunk anchor cannot name a line
outside every git hunk. ADR 0014 then gave quoted excerpts an anchor of their own. A reviewer who
expands context to read the code around a hunk and finds a problem there has no way to say so: the
lines are visible, selectable in appearance, and inert.

The frozen excerpt and the revealed line come from the same bytes. An excerpt is those bytes pinned
by narration; a revealed line is those bytes pinned by the run's blob.

## Decision

A `context` anchor is `(filePath, startLine, endLine)` on the new side, like an excerpt anchor,
and resolves against the run's pinned new blob for that file.

- Historical standalone `context` anchors remain new-side ranges. The TUI resolves every revealed
  row of an expanded file to a side-aware context segment. A new selection made only of revealed
  rows, or mixing changed and revealed lines, becomes one version-3 segmented `selection` anchor;
  every patch/context segment retains its actual side and authority.
- A context thread renders inline only while its lines are revealed. Landing on it from the
  Comments surface reveals them. Its chapter is the one narrating the nearest hunk of its file.
- Validation orphans, never fails, a context anchor whose file the run does not pin or whose range
  lies past the pinned file's end.
- Prep carries a context anchor by exact, unique content through the two runs' blobs. Changed or
  ambiguous content detaches, even with an identical frame, under the 2026-09-08 amendment to
  ADR 0021. The thread preserves its original code evidence.
- `revue threads create --kind context` writes one from the CLI.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Keep refusing | Rejected | The reviewer can see the code and cannot comment on it. |
| Reuse the excerpt anchor against the blob | Rejected | An excerpt's failure means "the narration stopped quoting"; a blob-backed anchor fails for a different reason and must say so. |
| Hunk anchor on the synthesised widened hunk | Rejected | Synthesised geometry changes with what is revealed; ADR 0007's reason stands. |
| A new-side file anchor resolved against the pinned blob | Chosen | Same shape as an excerpt, honest failure mode, carried by content. |

## Consequences

- The sentinel `hunkOldStart` for context rows in the TUI is negative, apart from real units (non-negative) and excerpts (zero).
- The historical context addition was the fourth anchor kind. Version 3 adds `selection` as the
  fifth kind while migrating strict version-1 and version-2 stores without reinterpretation.
- A context thread has no gutter presence until its lines are revealed, so the Comments surface is where it is found.
