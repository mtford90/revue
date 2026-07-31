# revue

Narrative code review in your terminal.

`revue` takes the best idea from [Stage](https://github.com/ReviewStage/stage-cli) — organising a
branch's diff into ordered, narrated **chapters** with a high-level **prologue** — and renders it in
a terminal UI built on [hunk](https://github.com/modem-dev/hunk), instead of a browser.

An agent (via the bundled `revue-chapters` skill) clusters the diff into chapters and writes a JSON
file. `revue show` validates that file and opens an interactive reviewer you drive from the keyboard.

> **Status: early scaffold.** The chapter model, schema, skill, the navigable TUI shell, and
> per-chapter **diff rendering** through hunk's `<HunkReviewStream>` all run today against a
> hand-written / agent-written chapters file (+ a unified-diff patch via `--diff`). The main piece
> still to build is `revue prep` — snapshotting git state and formatting hunks — so the patch is
> produced automatically instead of supplied by hand. See [the roadmap](#roadmap).

## How it relates to its parents

revue is the **seam** between two MIT projects — it forks neither:

- **Stage is the brain.** Its real value is the *skill* (chapter-clustering + prologue rules) and the
  *chapter data model* — not its React/SQLite web UI. We port the skill and the zod schema.
- **hunk is the renderer.** It publishes `hunkdiff/opentui` — `HunkReviewStream`, `HunkDiffView`,
  `createHunkDiffFile`, … — as an embeddable OpenTUI component surface. We depend on it as a library.

See [`docs/adr/0001-embed-hunk-port-stage.md`](docs/adr/0001-embed-hunk-port-stage.md) for the full
decision and the options we rejected (hard-forking hunk; chapters-as-annotations).

## Layout

```
packages/
  types/   zod schema for the chapters file (ported from stage-cli)
  tui/     the OpenTUI app — `revue show`, the chapter-navigation shell
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

Review controls and state are shown inline as `[ ]` / `[x]` checkboxes; `▸` identifies the active
chapter, file, and key change. `f` toggles the focused file: reviewing collapses it and moves to the
next unreviewed file (or chapter), while unreviewing stays put and expands it. `space`/`x` toggles the
whole chapter and `[`/`]` focus any key change with `r` toggling it; `1`–`9` remain direct shortcuts.
The checkboxes are also clickable in terminals with pointer support.

Navigation: `j`/`k` (or `↑`/`↓`) move between beats · `Page Up`/`Page Down` (or mouse wheel /
trackpad) scroll · `tab`/`shift-tab` focus files · `enter` toggles the focused diff · `c`/`e`
collapse/expand all diffs · `a` jumps to the next unreviewed chapter · `g`/`G` first/last · `?`
toggles the in-app shortcut reference · `q`/`esc` quits. Progress persists to `.revue/state.json`.

## Roadmap

- [x] Chapters/prologue zod schema (ported from Stage)
- [x] `revue show` — load + validate a chapters file, navigable TUI shell, `--check` summary
- [x] Render each chapter's **diff body** via hunk's `<HunkReviewStream>` (`--diff <patch>`; `hunkRefs` → filtered hunks)
- [x] **Mark-as-reviewed** at chapter / file / key-change level, with progress + auto-advance, persisted to `.revue/state.json`
- [x] Per-chapter **file list** with reviewed checkboxes and `+a -d` stats
- [ ] `revue prep` — snapshot git state, format hunks with stable `(filePath, oldStart)` ids (drops the manual `--diff`)
- [x] Scroll long diffs; choose split/stack layout by terminal width
- [ ] Inline **comments** you can author in the TUI (hunk's comment model is unexported — build our own / fork `AgentInlineNote` / drive the session daemon)
- [ ] Decide static-file vs live agent-driven session (hunk's session daemon)
- [ ] Mermaid prologue diagram rendering (ASCII)

## Credits

Built on [hunk](https://github.com/modem-dev/hunk) (MIT) and the chapter model + skill from
[stage-cli](https://github.com/ReviewStage/stage-cli) (MIT). Thanks to both.
