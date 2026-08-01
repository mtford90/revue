# revue

Narrative code review in your terminal.

`revue` takes the best idea from [Stage](https://github.com/ReviewStage/stage-cli) — organising a
branch's diff into ordered, narrated **chapters** with a high-level **prologue** — and renders it in
a terminal UI with a Revue-owned renderer built on public [Pierre](https://github.com/pierrecomputer/diffs) APIs, instead of a browser.

An agent (via the bundled `revue-chapters` skill) clusters the diff into chapters and writes a JSON
file. `revue show` validates that file and opens an interactive reviewer you drive from the keyboard.

> **Status: early scaffold.** The chapter model, schema, skill, the navigable TUI shell, and
> per-chapter **diff rendering** through `@revue/diff-renderer` all run today against a hand-written /
> agent-written chapters file (+ a unified-diff patch via `--diff`). The main piece
> still to build is `revue prep` — snapshotting git state and formatting hunks — so the patch is
> produced automatically instead of supplied by hand. See [the roadmap](#roadmap).

## How it relates to its parents

revue combines ideas from MIT projects without taking on their application shells:

- **Stage is the brain.** Its real value is the *skill* (chapter-clustering + prologue rules) and the
  *chapter data model* — not its React/SQLite web UI. We port the skill and the zod schema.
- **Pierre parses and highlights.** `@revue/diff-renderer` uses public `@pierre/diffs` APIs, then owns
  the terminal split/stack rows, exact side-aware range decorations, and OpenTUI presentation.
- **Hunk informed the renderer.** A bounded set of Hunk v0.15.3 body/row/geometry/highlighting
  concepts was selectively adapted under MIT; Hunk is not a runtime dependency.

See [`docs/adr/0002-own-diff-renderer.md`](docs/adr/0002-own-diff-renderer.md) for the current decision
and [`packages/diff-renderer/THIRD_PARTY_NOTICES.md`](packages/diff-renderer/THIRD_PARTY_NOTICES.md)
for Hunk provenance.

## Layout

```
packages/
  diff-renderer/  Revue-owned Pierre/OpenTUI patch renderer
  types/          zod schema for the chapters file (ported from stage-cli)
  tui/            the OpenTUI app — `revue show`, the chapter-navigation shell
skills/
  revue-chapters/  the chapter-generating agent skill (adapted from stage-chapters)
examples/
  sample-chapters.json   a valid chapters file you can run without a repo
```

## Quickstart

Requires [Bun](https://bun.sh) ≥ 1.3.

```bash
bun install

# validate the sample and print a summary (no TUI)
bun run check

# open the interactive reviewer on the sample (chapter metadata only)
bun run revue show examples/sample-chapters.json

# ...or with a real diff, so each chapter renders its actual code
bun run revue show examples/sample-chapters.json --diff examples/sample.diff
```

## Development

Read [`AGENTS.md`](AGENTS.md) before making changes. It requires coding agents to load this README,
the domain context, relevant architecture decisions, and the testing policy rather than relying on a
compacted summary.

Tests follow [`docs/testing.md`](docs/testing.md): protect meaningful behaviour and contracts, choose
the narrowest realistic boundary, and do not add tests merely to increase coverage.

Review controls and state are shown inline as `[ ]` / `[x]` checkboxes; `▸` identifies the active
chapter, file, and key change. `x` toggles the chapter, `f` toggles the focused file, and `r` toggles
the focused key change; `1`–`9` remain direct key-change shortcuts. Clicking chapter, file, or key-
change content navigates without changing review state—only its checkbox toggles it.

Navigation follows Vim/less conventions: `j`/`k` (or `↑`/`↓`) scroll by line · `d`/`u` or
`Ctrl-d`/`Ctrl-u` scroll by half-page · `Space`/`b`, `Ctrl-f`/`Ctrl-b`, or `Page Down`/`Page Up`
scroll by page · `g`/`G` jump to the top/bottom · `]c`/`[c` move between chapters · `{`/`}` focus key
changes · `tab`/`shift-tab` focus files · `enter` toggles the focused diff · `c`/`e` collapse/expand
all diffs · `a` jumps to the next unreviewed chapter · `?` toggles shortcut help · `q`/`esc` quits.
Mouse-wheel and trackpad scrolling are supported. Progress persists to `.revue/state.json`.

## Roadmap

- [x] Chapters/prologue zod schema (ported from Stage)
- [x] `revue show` — load + validate a chapters file, navigable TUI shell, `--check` summary
- [x] Render each chapter's **diff body** via `@revue/diff-renderer` (`--diff <patch>`; `hunkRefs` → filtered hunks; `lineRefs` → exact decorations)
- [x] **Mark-as-reviewed** at chapter / file / key-change level, with progress + auto-advance, persisted to `.revue/state.json`
- [x] Per-chapter **file list** with reviewed checkboxes and `+a -d` stats
- [ ] `revue prep` — snapshot git state, format hunks with stable `(filePath, oldStart)` ids (drops the manual `--diff`)
- [x] Scroll long diffs; choose split/stack layout by terminal width
- [ ] Inline **comments** you can author in the TUI (build a Revue-owned model)
- [ ] Decide static-file vs live agent-driven session
- [ ] Mermaid prologue diagram rendering (ASCII)

## Credits

Built with [@pierre/diffs](https://github.com/pierrecomputer/diffs), selectively adapted renderer
concepts from [hunk](https://github.com/modem-dev/hunk) (MIT), and the chapter model + skill from
[stage-cli](https://github.com/ReviewStage/stage-cli) (MIT). Thanks to all three.
