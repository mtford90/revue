# ADR 0014 — ANSI diff pager

- Status: accepted
- Date: 2026-08-07

## Context

Git and Lazygit can send a unified diff through a stdin filter for one command. Revue already owns
the Patch parsing and the Patch geometry. But Revue must not start its interactive adapter for this
use. A pager must emit only printable text and SGR sequences. A pager must never emit OpenTUI modes
or screen control.

## Decision

`revue pager` buffers stdin. It sanitises the input before it parses the input. It then classifies
the **complete** stream. Revue renders an ordinary Git patch or plain unified patch through
`@revue/diff` and the `@revue/diff-ansi` adapter, which has no React and no OpenTUI. Revue emits
unsupported input or ambiguous input in full, as sanitised direct output, and never renders such
input in part. The buffer of the input and the output costs latency and memory. In exchange the
buffer gives this safe fallback for the whole stream, the syntax preparation, and exact decisions
about automatic paging.

The documentation covers the command only for `pager.diff` and for the present stdin `diffRenderers`
API of Lazygit. The command is not a replacement for `core.pager`. The command owns the downstream
paging. It resolves the pager in this order: `--pager`, `REVUE_PAGER`, `PAGER`, then `less`. It
never reads `GIT_PAGER`, to prevent recursion. The neutral surfaces are transparent, thus the
terminal owns its background, and the changed rows keep their semantic tints.

## Consequences

- `less` improves the interactive paging, but `less` is optional: the direct output stays usable.
- The pager has no dependency on a prepared run, on a Git scope, on a chapter, on the state, on a
  thread, on the semantic view, on React, or on OpenTUI.
- The pager keeps a large input in memory until the classification and the rendering are complete.
  This is deliberate.
