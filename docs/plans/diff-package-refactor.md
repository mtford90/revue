# Refactor the Patch engine into reusable core and presentation adapters

## Goal

Replace the current `@revue/diff-model` / `@revue/diff-renderer` split with the seam accepted in
[ADR 0013](../adr/0013-separate-patch-engine-from-presentation-adapters.md):

```text
@revue/prep ───────────────▶ @revue/diff
@revue/diff-opentui ───────▶ @revue/diff
@revue/tui ────────────────▶ @revue/diff + @revue/diff-opentui
future ANSI pager ─────────▶ @revue/diff
```

This refactor is behaviour-preserving except for one explicit parser bug fix: trailing whitespace on
the final patch line must survive parsing. It does not implement or publish the ANSI pager.

## Required end state

### `@revue/diff`

A Bun-targeted, React-free Patch engine under `packages/diff/`. It owns:

- unified-patch chunking and Pierre adaptation;
- Revue-owned file, hunk, change-block, line, status, and statistics types;
- language inference and binary/add/delete/rename normalisation;
- changed-line pairing and intra-line spans;
- syntax-span preparation;
- split/stack logical rows;
- terminal-column geometry and visual-row wrapping;
- terminal sanitisation;
- declarative range decorations and stable line identities; and
- pure range-to-row and anchor lookup.

Its source and manifest may depend directly on `@pierre/diffs`, but must not directly import or
declare React, OpenTUI, `@revue/theme`, Git, or review-state packages. Pierre 1.2.2 declares React
and React DOM peers itself, so this refactor cannot claim a React-free transitive installation;
publication must treat that upstream peer contract as a separate constraint. Pierre types must not
appear in the exported Revue interfaces.

### `@revue/diff-opentui`

An OpenTUI adapter under `packages/diff-opentui/`. It owns:

- `DiffBody` and `DiffFileHeader`;
- mapping `@revue/theme` values into the engine's declarative style inputs;
- pointer selection and context-menu callbacks;
- React-node inline attachments and attachment counts;
- hunk-boundary expansion controls;
- row-window mounting and renderable measurement; and
- OpenTUI-specific renderable IDs, text-selection encodings, and component presentation.

It depends on `@revue/diff` and `@revue/theme` and keeps React/OpenTUI as peer dependencies. It does
not re-export engine parsing, planning, or model APIs.

## File ownership map

| Current path | Target ownership |
| --- | --- |
| `packages/diff-model/src/model.ts` | `packages/diff/src/model.ts` |
| `packages/diff-model/src/intraline.ts` | `packages/diff/src/intraline.ts` |
| `packages/diff-model/src/types.ts` | Replaced by Revue-owned types under `packages/diff/src/types.ts` |
| `packages/diff-renderer/src/rows.ts` | `packages/diff/src/rows.ts` |
| `packages/diff-renderer/src/layout.ts` | `packages/diff/src/layout.ts` |
| `packages/diff-renderer/src/wrap.ts` | `packages/diff/src/wrap.ts` and exported through the engine's render-planning interface |
| `packages/diff-renderer/src/highlight.ts` | `packages/diff/src/highlight.ts` |
| `packages/diff-renderer/src/terminalText.ts` | `packages/diff/src/terminalText.ts` |
| Pure range lookup in `packages/diff-renderer/src/decorations.ts` | `packages/diff/src/decorations.ts` |
| OpenTUI `decorationAnchorId` from `decorations.ts` | `packages/diff-opentui/src/ids.ts` |
| `packages/diff-renderer/src/lineIds.ts` | `packages/diff-opentui/src/selectionIds.ts` |
| Pure row/range functions in `attachments.ts` | A React-free range/anchor module in `packages/diff/src/` |
| React attachment type and placement in `attachments.ts` | `packages/diff-opentui/src/attachments.ts` |
| `packages/diff-renderer/src/components.tsx` | `packages/diff-opentui/src/components.tsx` |
| `packages/diff-renderer/README.md` | `packages/diff/README.md`, revised to match the completed interfaces |

Do not preserve the old packages as forwarding facades. Internal consumers can migrate atomically,
and compatibility shims would leave the rejected seam available to new callers.

## Implementation tasks

### 1. Protect patch-byte preservation before moving code

Follow the bug-fix TDD loop against the current parser:

1. Add parameterised cases for both added and deleted lines carrying trailing whitespace. Exercise
   each once at end-of-input and once as the final line immediately before another file header, so
   both final and intermediate chunk flushes are covered.
2. Assert both the parsed side's line content and the retained per-file `patch` text preserve the
   whitespace exactly.
3. Run those cases and confirm they fail because `patchChunks().flush()` trims each chunk.
4. Replace chunk-level trimming with boundary handling that preserves patch line bytes while still
   giving Pierre a complete parseable chunk.
5. Confirm the new cases and the existing plain/Git/mixed-header patch-boundary tests pass.

Keep this as a distinct behavioural change so the later file moves cannot conceal it.

### 2. Create the engine with Revue-owned types

Create `packages/diff/package.json`, `tsconfig.json`, and `src/index.ts`. Move the model and pure
renderer modules according to the ownership table.

Replace exported `FileDiffMetadata` usage with Revue-owned structural types containing only fields
actually consumed by prep, planning, highlighting, and adapters. Keep the Pierre conversion inside
`model.ts`. Confirm every existing status, mode, hunk-content, line-array, and previous-path case is
represented before removing the Pierre type from the interface.

The engine should expose intentional capabilities rather than every internal helper. Its public
surface must cover patch parsing and normalisation, changed-line pairing and intra-line spans,
syntax preparation, terminal-safe spans, declarative decorations/ranges, anchor lookup, and one
width-aware visual planner shared by every presentation adapter.

That planner must be concrete rather than a bag of helpers:

- **Input:** one parsed file; explicit `split` or `stack`; available width; line-number and hunk-header
  visibility; plain colour/style slots; decorations and optional span emphasis; and a declarative
  gutter-chrome request giving the focus-marker and attachment-marker columns the adapter intends
  to render.
- **Output:** ordered visual rows with total height and resolved pane/code widths. A hunk-header row
  carries its source hunk identity. A line row carries its logical file/hunk/side/line identity,
  continuation index, change sign, optional first-row gutters, fully wrapped styled spans, and
  split cells already padded to equal visual height.
- **Invariant:** an adapter serialises or mounts the plan; it does not call `wrapSpans`, recalculate
  pane widths, invent continuation rows, or realign split cells itself.

Refactor `DiffBody` to consume this visual plan. Move the current wrapping, continuation-row
construction, split padding, and associated height calculations out of `components.tsx` and into the
planner. The OpenTUI adapter requests its existing one-column focus and three-column attachment
chrome. A future ANSI adapter can request zero columns for chrome it does not render.

Keep host policy out: the engine accepts split or stack and a width; it does not decide which layout
a product should choose. Keep OpenTUI renderable IDs and text-selection ID parsing in the adapter;
the engine's identities describe source rows and ranges only.

### 3. Move tests to the module that owns the contract

Move, without weakening, the existing tests:

- parser/model and intra-line tests to `packages/diff/`;
- row emphasis, wrapping, engine source-row identity, geometry, decoration, sanitisation, and
  highlighting tests to `packages/diff/`;
- the existing `lineIds.test.ts` tests for rendered-node encoding/selection recovery, OpenTUI
  component interaction tests, and character/style goldens to `packages/diff-opentui/`.

The committed goldens are a compatibility contract. Their contents must not be re-blessed during a
package-only refactor. Any changed character or style is a behavioural change to diagnose, not an
expected consequence of moving files.

Update `goldens:update` only to its new path.

### 4. Create the OpenTUI adapter

Create `packages/diff-opentui/package.json`, `tsconfig.json`, and `src/index.ts`. Move the components
and React-specific attachment concerns into it.

Split mixed types so the engine has no `React.ReactNode`. Keep the adapter interface focused on
rendering and host callbacks. Callers needing `DiffFile`, planned row types, `DiffLineRange`, parsing,
or pure planning import those from `@revue/diff`, not through adapter re-exports. The adapter owns
`diffLineId`, `diffRangeWithin`, `decorationAnchorId`, and any other encoding whose purpose is naming
or recovering OpenTUI renderables.

Retain the existing behaviour for:

- split and stacked bodies;
- compact headers and file statistics;
- exact side-aware decorations;
- pointer range selection and context menus;
- inline attachments;
- hunk expansion controls;
- optional row windows; and
- attachment measurement.

### 5. Migrate prep and TUI consumers

Update `@revue/prep` to depend on and import `@revue/diff`. Its package and TypeScript configuration
must remain free of React/OpenTUI.

Update `@revue/tui` to declare both new dependencies. Import pure concerns directly from
`@revue/diff`, including parsing, range types, layout types, sanitisation, row planning, and anchor
lookup. Import only components and OpenTUI host contracts from `@revue/diff-opentui`.

Pay particular attention to:

- `packages/tui/src/diff.ts`;
- `packages/tui/src/virtualRows.ts`;
- `packages/tui/src/expand.ts`;
- `packages/tui/src/layout.ts`;
- `packages/tui/src/semantic.ts`;
- `packages/tui/src/sourceLink.ts`;
- `packages/tui/src/threads.ts`; and
- `packages/tui/src/app.tsx`.

Do not move semantic generation, context expansion, viewport planning, source links, or thread state
into either new package merely because they consume diff types.

### 6. Remove the old packages and update repository wiring

After all imports have migrated:

- delete `packages/diff-model/` and `packages/diff-renderer/`;
- update the root `typecheck` and `goldens:update` scripts;
- update workspace package manifests and the Bun lockfile;
- update screenshot/test paths that name the old renderer package;
- update `.github/workflows/release.yml`, which currently copies the old renderer notice by path;
  and
- grep the repository, including hidden `.github` files, for `@revue/diff-model`,
  `@revue/diff-renderer`, `packages/diff-model`, and `packages/diff-renderer`.

Every remaining occurrence must be historical prose that is intentionally retained or amended; no
code, manifest, script, or active instruction may point at the removed packages.

### 7. Preserve provenance and update architecture documentation

Split the current third-party notice according to where the adapted concepts land:

- engine notice: Pierre use plus Hunk row model, geometry, highlighting, and terminal-safety
  concepts;
- OpenTUI notice: Hunk body and compact-header presentation concepts.

Each distributed package must carry the applicable MIT text. The existing licence collector covers
runtime dependencies only and cannot prove that Hunk notices ship because Hunk is not a dependency.
Extract the local-notice copy list from the release workflow into a small packaging script, make the
workflow call it, and add a packaging test that stages an archive directory and asserts that both new
notices—along with the existing TUI, theme, types, and skill notices—are present. Keep the existing
external-dependency licence collector test unchanged except for any package-path migration it
actually requires.

Move the Patch-view README to `packages/diff/README.md` and remove statements that describe wrapping
or the render plan as internal once those interfaces are exported. Add a concise adapter README with
an embedding example and a link to the engine document. Update `README.md`, `CONTEXT.md`,
`docs/guide.md`, `docs/testing.md`, and every active package-layout or testing instruction to use the
new names. Amend older ADR wording only where it otherwise states a current package name as an active
contract; retain the historical decision and link to ADR 0013.

## Acceptance criteria

- `@revue/diff` has no direct React, OpenTUI, or Revue theme import, manifest dependency, or exported
  type. Pierre's own React peer declaration is recorded rather than misrepresented as absent.
- `@revue/prep` depends only on the engine and remains headless.
- `@revue/diff-opentui` contains every React/OpenTUI-specific diff concern.
- No exported engine type contains `React.ReactNode`, an OpenTUI type, Pierre's
  `FileDiffMetadata`, or an OpenTUI renderable-ID encoding.
- `DiffBody` consumes the engine's visual plan without independently wrapping spans, constructing
  continuation rows, or padding split cells.
- Existing Patch characters and styles remain byte-for-byte identical in every golden.
- Existing pointer selection, decorations, attachments, expansion controls, and windowing behaviour
  still pass their integration tests.
- The final line of a patch preserves meaningful trailing whitespace.
- No active import, manifest, script, or instruction references either removed package.
- The engine README describes current behaviour; ANSI pager language remains clearly marked as a
  future adapter.
- No ANSI output mode, Lazygit configuration, semantic diff change, or review-workflow feature is
  added by this refactor.

## Verification

Run all repository checks:

```bash
bun install
bun run typecheck
bun run lint
bun test
bun run revue show examples/sample-run --check
```

Then verify dependency direction:

```bash
git grep --untracked -nE '@revue/diff-model|@revue/diff-renderer|packages/diff-model|packages/diff-renderer'
rg '@opentui|from "react"|@revue/theme' packages/diff/src packages/diff/package.json
rg '@revue/diff-opentui' packages/prep
```

The first search intentionally includes tracked and untracked files, including newly created package
files, `.github` workflows, and `docs/testing.md`. Inspect every result: only amended historical ADR
text and the migration documents may retain the old names. The last two searches must return no
production dependency or source import.

Because this moves the renderer interface, manually inspect the TUI at both required sizes without
re-blessing goldens:

```bash
tmux new-session -d -s revue -x 160 -y 45 "bun run revue show examples/sample-run"
sleep 4
tmux send-keys -t revue "]"; sleep 0.5; tmux send-keys -t revue "c"
tmux capture-pane -t revue -p -e
tmux kill-session -t revue

tmux new-session -d -s revue -x 100 -y 36 "bun run revue show examples/sample-run"
sleep 4
tmux send-keys -t revue "]"; sleep 0.5; tmux send-keys -t revue "c"
tmux capture-pane -t revue -p -e
tmux kill-session -t revue
```

Inspect the captured split/stack geometry, gutters, wrapping, emphasis, file headers, and chapter
integration. Any visual difference requires diagnosis and explicit approval rather than automatic
golden regeneration.
