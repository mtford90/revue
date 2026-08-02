# ADR 0002 — Own the terminal diff renderer

- Status: accepted
- Date: 2026-08-01
- Supersedes: [ADR 0001](0001-embed-hunk-port-stage.md)

## Context

ADR 0001 embedded Hunk's published `hunkdiff/opentui` surface. That accelerated the first diff-view
milestone, but Revue now needs line-exact, side-aware decorations for a key change's complete set of
`lineRefs`. Hunk's public surface selects a hunk; its row builders and decoration geometry are
private and its broader application model is not part of Revue's chapter workflow.

Both projects already use `@pierre/diffs`. Pierre publicly provides unified-patch parsing,
`FileDiffMetadata`, language detection, and syntax highlighting, while terminal row layout remains a
host concern.

## Decision

Revue owns `@revue/diff-renderer` and removes the `hunkdiff` runtime dependency.

The renderer and its shared model:

1. pin `@pierre/diffs` 1.2.2 directly and use only its public package exports;
2. own a small file model, patch adapter, split/stack row model, OpenTUI body/header components,
   exact inclusive side-aware range decorations, stable focus identity/anchors, and `.env*`
   language fallback; the pure model/parser later moved to `@revue/diff-model` so prep and rendering
   share identities (ADR 0003);
3. selectively adapts only Hunk v0.15.3 body, row, geometry, and highlighting concepts, with the
   upstream version, commit, source concepts, local modifications, and MIT licence recorded in
   `packages/diff-renderer/THIRD_PARTY_NOTICES.md`; and
4. deliberately excludes Hunk's full `renderRows.tsx`, app, controller, comments, notes, menu, CLI,
   loader, watch mode, and session broker.

Revue's TUI continues to own file headers' surrounding review/collapse controls, chapter navigation,
scrolling, persistence, and key handling. Visual parity is measured against Revue's sample review,
not Hunk's complete application.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Keep `hunkdiff/opentui` and decorate selected hunks | Rejected | Cannot express every exact old/new line range through the public component contract. |
| Import Hunk private renderer modules | Rejected | Unsupported package boundary and would pull unrelated review/session features into Revue. |
| Copy Hunk's complete row renderer | Rejected | Excess capability and maintenance burden; violates the bounded renderer scope. |
| Selectively adapt the minimum renderer concepts over public Pierre APIs | Chosen | Gives Revue exact anchors and decorations while keeping the owned surface small and testable. |

## Consequences

- Revue is responsible for terminal row geometry and visual behaviour at its renderer boundary.
- Pierre's highlighted HAST shape is adapted locally; pinning 1.2.2 bounds that compatibility risk.
- Highlighting is prepared before React rendering. Raw patch text remains a synchronous readable
  fallback, avoiding asynchronous state updates and test `act()` warnings.
- Hunk remains credited as the MIT source of selected concepts, but is no longer a package/runtime
  dependency.
