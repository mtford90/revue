# ADR 0002 — Own the terminal diff renderer

- Status: accepted
- Date: 2026-08-01
- Supersedes: [ADR 0001](0001-embed-hunk-port-stage.md)

## Context

ADR 0001 embedded the published `hunkdiff/opentui` surface of Hunk. That made the first diff-view
milestone faster. But Revue now needs decorations that are exact to the line and that know the side,
for the complete set of `lineRefs` of a key change. The public surface of Hunk selects a hunk. Its
row builders and its decoration geometry are private. Its larger application model is not part of the
chapter workflow of Revue.

Both projects already use `@pierre/diffs`. Pierre gives these functions in public:

- the parser for a unified patch;
- `FileDiffMetadata`;
- the detection of the language;
- the syntax highlighting.

The layout of the terminal rows stays a concern of the host.

## Decision

Revue owns `@revue/diff-renderer` and removes the `hunkdiff` runtime dependency.

The renderer and its shared model do these things:

1. They pin `@pierre/diffs` 1.2.2 directly and use only its public package exports.
2. They own these parts:
   - a small file model;
   - the patch adapter;
   - the row model for the split layout and the stack layout;
   - the body components and the header components for OpenTUI;
   - the range decorations, which are exact, inclusive, and aware of the side;
   - stable identities and anchors for the focus;
   - the language fallback for `.env*` files.

   The pure model and the parser moved later to `@revue/diff-model`. Thus prep and rendering share
   the same identities (ADR 0003).
3. They adapt only some concepts of Hunk v0.15.3: the body, the row, the geometry, and the
   highlighting. `packages/diff-renderer/THIRD_PARTY_NOTICES.md` records the upstream version, the
   commit, the source concepts, the local modifications, and the MIT licence.
4. They exclude, on purpose, the full `renderRows.tsx` of Hunk, and also its app, controller,
   comments, notes, menu, CLI, loader, watch mode, and session broker.

The TUI of Revue continues to own these parts:

- the review controls and the collapse controls around the file headers;
- the chapter navigation;
- the scrolling;
- the persistence;
- the key handling.

We measure the visual parity against the sample review of Revue, not against the complete
application of Hunk.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Keep `hunkdiff/opentui` and decorate selected hunks | Rejected | The public component contract cannot express every exact old line range and new line range. |
| Import Hunk private renderer modules | Rejected | The package boundary is not supported. It also brings unrelated review features and session features into Revue. |
| Copy Hunk's complete row renderer | Rejected | Too much capability and too much maintenance. It breaks the bounded scope of the renderer. |
| Selectively adapt the minimum renderer concepts over public Pierre APIs | Chosen | Gives Revue exact anchors and decorations. The owned surface stays small, and we can test it. |

## Consequences

- Revue is responsible for the geometry of the terminal rows and for the visual behaviour at its
  renderer boundary.
- Revue adapts the highlighted HAST shape of Pierre locally. The pin to 1.2.2 limits that
  compatibility risk.
- Revue prepares the highlighting before React renders. The raw patch text stays as a synchronous
  fallback that you can read. Thus there are no asynchronous state updates and no `act()` warnings
  in the tests.
- Revue continues to credit Hunk as the MIT source of the selected concepts. Hunk is no longer a
  package dependency or a runtime dependency.

## Amendment

ADR 0013 replaces the active package boundary with `@revue/diff` and `@revue/diff-opentui`. The names above are historical. They describe the implementation at the time of this decision.
