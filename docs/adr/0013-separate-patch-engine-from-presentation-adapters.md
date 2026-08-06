# ADR 0013 — Separate the Patch engine from presentation adapters

- Status: accepted
- Date: 2026-08-06
- Amends: [ADR 0002](0002-own-diff-renderer.md), [ADR 0003](0003-prep-owns-review-scope.md)

## Context

The current package split follows an earlier internal need. `@revue/diff-model` keeps patch parsing
and stable hunk identities available to headless prep without bringing in React or OpenTUI, while
`@revue/diff-renderer` supplies the TUI with the rendered Patch body. That dependency direction is
important: prep must remain deterministic and usable without a terminal runtime.

The split no longer matches the capability Revue intends to reuse. The Patch engine now spans both
packages:

- `@revue/diff-model` owns parsing, file normalisation, statistics, language inference, changed-line
  pairing, and intra-line spans;
- pure modules inside `@revue/diff-renderer` own row planning, split/stack geometry, wrapping,
  highlighting, decorations, line identities, and terminal sanitisation; and
- the same renderer package also owns React/OpenTUI components, pointer interaction, React-node
  attachments, and renderable measurement.

An embeddable OpenTUI view and a future ANSI pager need to share the first two groups without forcing
headless or non-OpenTUI consumers through the third. The current renderer barrel also re-exports the
model, obscuring which interface is reusable, while the model's public types expose Pierre's
`FileDiffMetadata` directly.

## Decision

Replace the current model/renderer seam with a Patch-engine/presentation-adapter seam:

1. **`@revue/diff` is the reusable Patch engine.** It owns unified-patch parsing, Revue-owned file
   and hunk types, statistics, language inference, changed-line pairing, intra-line spans, syntax
   spans, split/stack row planning, terminal-column geometry, wrapping, terminal sanitisation,
   declarative ranges, and stable source-line identities. Its own source and manifest have no direct
   React, OpenTUI, Revue theme, Git, or review-state dependency.
2. **`@revue/diff-opentui` is the OpenTUI adapter.** It owns `DiffBody`, `DiffFileHeader`, pointer
   selection, context-menu callbacks, React-node attachments, expansion controls, row-window
   mounting, renderable measurement, and mapping a Revue theme into the engine's declarative style
   inputs.
3. **Headless prep imports `@revue/diff` directly.** It never depends on the OpenTUI adapter.
4. **Revue's TUI imports the engine for pure planning/types and the adapter for OpenTUI
   presentation.** The adapter does not re-export the engine as a convenience facade.
5. **`@revue/diff-ansi` is an ANSI pager adapter over `@revue/diff`.** It reads unified patches and
   serialises the same planned rows to ANSI without initialising OpenTUI or an alternate screen.
   ADR 0014 records its stdin-filter and paging contract.

The engine exposes Revue-owned types rather than making Pierre's metadata shape its external
contract. Pierre remains the pinned parsing and highlighting implementation behind the engine.
Pierre 1.2.2 itself declares React and React DOM peers even for consumers using only its headless
APIs, so this decision guarantees no direct UI dependency in Revue's engine rather than a
React-free transitive installation. Publication must either accept that upstream peer contract or
resolve it separately. The initial engine remains Bun-targeted because terminal-width measurement
currently uses `Bun.stringWidth`; runtime portability is also a separate decision.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Keep `diff-model` and `diff-renderer` unchanged | Rejected | The reusable Patch engine remains split while OpenTUI concerns stay mixed into its apparent public package. |
| Merge `diff-model` into the current renderer package | Rejected | Prep and future headless consumers would inherit React, OpenTUI, native terminal peers, and theme dependencies. |
| Keep a model package, add a render-plan package, then add adapter packages | Rejected | Preserves prep isolation but creates a shallow public model seam; parsing, analysis, and row planning together form the useful Patch-engine interface. |
| One Patch engine plus presentation adapters | Chosen | Gives prep, OpenTUI, and ANSI consumers one shared algorithm without leaking a presentation runtime across the seam. |

## Consequences

- `@revue/diff-model` and `@revue/diff-renderer` are replaced rather than published under their
  current interfaces.
- Package consumers must import their owning layer directly; the OpenTUI adapter is not a facade for
  parsing or pure planning helpers. OpenTUI renderable IDs and text-selection encodings remain in
  the adapter rather than becoming engine identities.
- Moving pure renderer modules into the engine must preserve the existing Patch output. Current
  unit, component, and character/style golden tests remain the compatibility contract.
- Hunk-derived concepts span both resulting packages, so each package must retain accurate
  third-party provenance and release packaging must copy both local notices into every archive.
  This is separate from collecting licences for installed runtime dependencies.
- The Patch-view README moves to the engine. The adapter receives a smaller README covering OpenTUI
  embedding and host callbacks.
- Semantic diff, immutable runs, blob-backed context expansion, chapters, threads, and review state
  remain outside the engine. They may consume its interfaces but do not move into it.
- A known parser defect currently trims trailing whitespace from the final patch line. Exporting the
  engine makes preserving patch bytes at that boundary a prerequisite, but its fix follows the
  repository's test-first bug-fix workflow rather than being hidden inside file moves.
