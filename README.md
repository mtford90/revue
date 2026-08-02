# revue

Narrative code review in your terminal.

`revue` takes the best idea from [Stage](https://github.com/ReviewStage/stage-cli) — organising a
branch's diff into ordered, narrated **chapters** with a high-level **prologue** — and renders it in
a terminal UI with a Revue-owned renderer built on public [Pierre](https://github.com/pierrecomputer/diffs) APIs, instead of a browser.

`revue prep` freezes a Git scope into an immutable local run. An agent (via the bundled
`revue-chapters` skill) reads that run’s numbered hunks, clusters them into chapters, and writes
`chapters.json` beside the pinned patch. `revue show` validates the complete run and opens an
interactive reviewer you drive from the keyboard.

> **Status: early scaffold.** Prep, the chapter model and skill, the navigable TUI shell, review
> persistence, and per-chapter rendering through `@revue/diff-renderer` run today. Prep supports
> committed, staged, unstaged, and working-tree scopes; comments and semantic Difftastic rendering
> remain on the roadmap.

## How it relates to its parents

revue combines ideas from MIT projects without taking on their application shells:

- **Stage is the brain.** Its real value is the *skill* (chapter-clustering + prologue rules) and the
  *chapter data model* — not its React/SQLite web UI. We port the skill and the zod schema.
- **Pierre parses and highlights.** `@revue/diff-renderer` uses public `@pierre/diffs` APIs, then owns
  the terminal split/stack rows, exact side-aware range decorations, and OpenTUI presentation.
- **Hunk informed bounded terminal surfaces.** Revue selectively adapts Hunk v0.15.3
  body/row/geometry/highlighting concepts in the renderer and menu-bar/controller concepts in the
  TUI under MIT; Hunk is not a runtime dependency.

See [`docs/adr/0002-own-diff-renderer.md`](docs/adr/0002-own-diff-renderer.md) for the current decision
and [`packages/diff-renderer/THIRD_PARTY_NOTICES.md`](packages/diff-renderer/THIRD_PARTY_NOTICES.md)
for Hunk provenance.

## Layout

```
packages/
  diff-model/     Shared Pierre patch model and stable file/hunk identities
  diff-renderer/  Revue-owned OpenTUI presentation over the shared model
  prep/           Git scope resolution, immutable snapshots, filtering, and hunk formatting
  types/          zod schemas for chapters, review state, and run manifests
  tui/            The CLI and OpenTUI chapter-navigation shell
skills/
  revue-chapters/  The chapter-generating agent skill (adapted from stage-chapters)
examples/
  sample-run/      A complete prepared run that works without a Git repository
```

## Quickstart

Requires [Bun](https://bun.sh) ≥ 1.3.

```bash
bun install

# validate the complete sample run and print a summary
bun run check

# open the interactive reviewer on the same pinned run
bun run revue show examples/sample-run

# prepare the current repository; stdout is only the new run directory
RUN=$(bun run revue prep)

# have the revue-chapters skill read "$RUN/hunks.txt" and write "$RUN/chapters.json"
bun run revue show "$RUN"
```

## Development

Read [`AGENTS.md`](AGENTS.md) before making changes. It requires coding agents to load this README,
the domain context, relevant architecture decisions, and the testing policy rather than relying on a
compacted summary.

Tests follow [`docs/testing.md`](docs/testing.md): protect meaningful behaviour and contracts, choose
the narrowest realistic boundary, and do not add tests merely to increase coverage.

The top File/View menu makes the main actions discoverable with a mouse or keyboard. Press `F10` to
open it, use arrow keys and `Enter`, and press `Escape` or click outside to close. Patch view is the
current checked mode; the read-only Semantic diff entry is disabled until Difftastic support lands.

Review controls and state are shown inline as `[ ]` / `[x]` checkboxes; `▸` identifies the active
chapter, file, and key change. `x` toggles the chapter, `f` toggles the focused file, and `r` toggles
the focused key change; `1`–`9` remain direct key-change shortcuts. Clicking chapter, file, or key-
change content navigates without changing review state—only its checkbox toggles it.

Navigation follows Vim/less conventions: `j`/`k` (or `↑`/`↓`) scroll by line · `d`/`u` or
`Ctrl-d`/`Ctrl-u` scroll by half-page · `Space`/`b`, `Ctrl-f`/`Ctrl-b`, or `Page Down`/`Page Up`
scroll by page · `g`/`G` jump to the top/bottom · `]c`/`[c` move between chapters · `{`/`}` focus key
changes · `tab`/`shift-tab` focus files · `enter` toggles the focused diff · `c`/`e` collapse/expand
all diffs · `a` jumps to the next unreviewed chapter · `F10` opens the menu · `?` toggles shortcut
help · `q`/`esc` quits.
Mouse-wheel and trackpad scrolling are supported. Progress persists to `.revue/state.json`, keyed
by both the pinned run and its chapter narration.

## Roadmap

- [x] Chapters/prologue zod schema (ported from Stage)
- [x] `revue show` — load and validate a complete run, navigable TUI shell, `--check` summary
- [x] Render each chapter's **diff body** via `@revue/diff-renderer` (`hunkRefs` → filtered hunks; `lineRefs` → exact decorations)
- [x] **Mark-as-reviewed** at chapter / file / key-change level, with progress + auto-advance, persisted to `.revue/state.json`
- [x] Per-chapter **file list** with reviewed checkboxes and `+a -d` stats
- [x] `revue prep` — pin Git scope, old/new blobs, patch, exclusions, and stable `(filePath, oldStart)` review identities
- [x] Scroll long diffs; choose split/stack layout by terminal width
- [x] File/View application menu with pointer and keyboard operation
- [ ] Read-only **Difftastic semantic diff** view over the pinned old/new snapshots
- [ ] Inline **comments** you can author in the TUI (build a Revue-owned model)
- [ ] Decide static-file vs live agent-driven session
- [ ] Mermaid prologue diagram rendering (ASCII)

## Credits

Built with [@pierre/diffs](https://github.com/pierrecomputer/diffs), selectively adapted renderer
concepts from [hunk](https://github.com/modem-dev/hunk) (MIT), and the chapter model + skill from
[stage-cli](https://github.com/ReviewStage/stage-cli) (MIT). Thanks to all three.
