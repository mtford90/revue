# ADR 0013 — Separate the Patch engine from presentation adapters

- Status: accepted
- Date: 2026-08-06
- Amends: [ADR 0002](0002-own-diff-renderer.md), [ADR 0003](0003-prep-owns-review-scope.md)

## Context

The present package split comes from an earlier internal need. `@revue/diff-model` gives the
headless prep the patch parsing and the stable hunk identities, and it does not bring in React or
OpenTUI. `@revue/diff-renderer` gives the TUI the rendered Patch body. This direction of the
dependency is important: prep must stay deterministic, and prep must run without a terminal runtime.

The split no longer agrees with the capability that Revue must reuse. The Patch engine is now in
both packages:

- `@revue/diff-model` owns the parsing, the file normalisation, the statistics, the language
  inference, the pairing of changed lines, and the intra-line spans;
- the pure modules inside `@revue/diff-renderer` own the row plan, the geometry of the split view
  and the stack view, the wrapping, the highlighting, the decorations, the line identities, and the
  terminal sanitisation; and
- the same renderer package also owns the React/OpenTUI components, the pointer interaction, the
  React-node attachments, and the renderable measurement.

An embeddable OpenTUI view and a future ANSI pager must share the first two groups. They must not
force a headless consumer or a non-OpenTUI consumer through the third group. The barrel of the
renderer also exports the model again, thus the reusable interface is not clear. The public types of
the model also show Pierre's `FileDiffMetadata` directly.

## Decision

Replace the present seam between the model and the renderer with a seam between the Patch engine and
the presentation adapters:

1. **`@revue/diff` is the reusable Patch engine.** It owns:
   - the parsing of a unified patch;
   - the file types and the hunk types that Revue owns;
   - the statistics;
   - the language inference;
   - the pairing of changed lines;
   - the intra-line spans and the syntax spans;
   - the row plan for the split view and the stack view;
   - the geometry of the terminal columns, the wrapping, and the terminal sanitisation;
   - the declarative ranges;
   - the stable identities of the source lines.

   Its own source and its manifest have no direct dependency on React, on OpenTUI, on a Revue theme,
   on Git, or on the review state.
2. **`@revue/diff-opentui` is the OpenTUI adapter.** It owns:
   - `DiffBody` and `DiffFileHeader`;
   - the pointer selection and the callbacks of the context menu;
   - the React-node attachments;
   - the expansion controls;
   - the mounting of the row window;
   - the renderable measurement;
   - the map of a Revue theme into the declarative style inputs of the engine.
3. **The headless prep imports `@revue/diff` directly.** It never depends on the OpenTUI adapter.
4. **The TUI of Revue imports both packages.** It imports the engine for the pure plans and the pure
   types. It imports the adapter for the OpenTUI presentation. The adapter does not export the
   engine again as a facade.
5. **`@revue/diff-ansi` is an ANSI pager adapter above `@revue/diff`.** It reads unified patches and
   serialises the same planned rows to ANSI. It does not initialise OpenTUI or an alternate screen.
   ADR 0014 records its contract for the stdin filter and for the paging.

The engine shows the types that Revue owns. It does not make the metadata shape of Pierre its
external contract. Pierre stays the pinned implementation of the parsing and the highlighting behind
the engine. Pierre 1.2.2 declares React and React DOM as peers, also for a consumer that uses only
its headless APIs. Thus this decision guarantees no direct UI dependency in the engine of Revue. It
does not guarantee a transitive installation without React.

Publication must accept that peer contract of the upstream package, or resolve it separately. The
first engine stays targeted at Bun, because the measurement of the terminal width now uses
`Bun.stringWidth`. The portability to another runtime is also a separate decision.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Keep `diff-model` and `diff-renderer` unchanged | Rejected | The reusable Patch engine stays in two parts, and the OpenTUI concerns stay mixed into its apparent public package. |
| Merge `diff-model` into the current renderer package | Rejected | Prep and future headless consumers then get React, OpenTUI, native terminal peers, and theme dependencies. |
| Keep a model package, add a render-plan package, then add adapter packages | Rejected | It keeps prep isolated, but it makes a shallow public seam for the model. The parsing, the analysis, and the row plan together form the useful interface of the Patch engine. |
| One Patch engine plus presentation adapters | Chosen | It gives prep, OpenTUI, and ANSI consumers one shared algorithm, and no presentation runtime crosses the seam. |

## Consequences

- Revue replaces `@revue/diff-model` and `@revue/diff-renderer`. Revue does not publish them with
  their present interfaces.
- A consumer must import the layer that owns what it needs. The OpenTUI adapter is not a facade for
  the parsing helpers or the pure plan helpers. The renderable IDs of OpenTUI and the encodings of
  the text selection stay in the adapter. They do not become identities of the engine.
- A move of a pure renderer module into the engine must keep the present Patch output. The present
  unit tests, component tests, and golden tests of the characters and the styles stay the contract
  for compatibility.
- Concepts derived from the hunk are in both new packages. Thus each package must keep a correct
  record of its third-party provenance, and the release packaging must copy both local notices into
  every archive. This is separate from the collection of the licences of the installed runtime
  dependencies.
- The README of the Patch view moves to the engine. The adapter gets a smaller README. That README
  covers the OpenTUI embedding and the host callbacks.
- These parts stay outside the engine:
  - the semantic diff;
  - the immutable runs;
  - the context expansion from a blob;
  - the chapters;
  - the threads;
  - the review state.

  They can use the interfaces of the engine, but they do not move into it.
- A known defect of the parser now removes the trailing whitespace from the last patch line. The
  export of the engine makes the preservation of the patch bytes at that boundary a prerequisite.
  But the fix follows the test-first bug-fix workflow of the repository. Do not hide the fix inside
  a move of files.

## Amendments

- 2026-08-19 — The withdrawn agent-directed review granularity record removes the Semantic view.
  "The semantic diff" in the Consequences list of concepts that stay outside the engine is
  historical: there is no longer a semantic diff anywhere in Revue, not merely one kept outside this
  boundary.
