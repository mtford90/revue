# ADR 0014 — ANSI diff pager

- Status: accepted
- Date: 2026-08-07

## Context

Git and Lazygit can send a unified diff through a command-specific stdin filter. Revue already owns
Patch parsing and geometry, but its interactive adapter must not be started for this use: a pager
must emit only printable text and SGR sequences, never OpenTUI modes or screen control.

## Decision

`revue pager` buffers stdin, sanitises it before parsing, and classifies the **complete** stream.
Ordinary Git/plain unified patches are rendered through `@revue/diff` and the React/OpenTUI-free
`@revue/diff-ansi` adapter. Unsupported or ambiguous input is emitted in full as sanitised direct
output, never partially rendered. The buffered input/output trade latency and memory for this safe
whole-stream fallback, syntax preparation, and exact auto-paging decisions.

The command is documented only for `pager.diff` and Lazygit's current stdin `diffRenderers` API; it
is not a `core.pager` replacement. It owns downstream paging, resolving `--pager`, `REVUE_PAGER`,
`PAGER`, then `less`, explicitly never `GIT_PAGER` to avoid recursion. Neutral surfaces are
transparent so the terminal owns its background while changed rows retain semantic tints.

## Consequences

- `less` improves interactive paging but is optional: direct output remains usable.
- The pager has no prepared-run, Git scope, chapter, state, thread, semantic-view, React, or OpenTUI
  dependency.
- Large input is intentionally retained until both classification and rendering finish.
