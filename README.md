# revue

Narrative code review in your terminal.

`revue` takes the best idea from [Stage](https://github.com/ReviewStage/stage-cli) — organising a
branch's diff into ordered, narrated **chapters** with a high-level **prologue** — and renders it in
a terminal UI built on [hunk](https://github.com/modem-dev/hunk), instead of a browser.

An agent (via the bundled `revue-chapters` skill) clusters the diff into chapters and writes a JSON
file. `revue show` validates that file and opens an interactive reviewer you drive from the keyboard.

> **Status: early scaffold.** The chapter model, schema, skill, and the navigable TUI shell exist and
> run today against a hand-written / agent-written chapters file. The two big pieces still to build:
> `revue prep` (snapshot git + format hunks) and wiring hunk's `<HunkReviewStream>` so each chapter
> renders its actual **diff body**, not just its metadata. See [the roadmap](#roadmap).

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

# open the interactive reviewer on the sample
bun run revue show examples/sample-chapters.json
```

Keys: `j`/`k` or `↑`/`↓` to move between beats, `g`/`G` first/last, `q` to quit.

## Roadmap

- [x] Chapters/prologue zod schema (ported from Stage)
- [x] `revue show` — load + validate a chapters file, navigable TUI shell, `--check` summary
- [ ] Render each chapter's **diff body** via hunk's `<HunkReviewStream>` (map `hunkRefs` → a filtered `HunkDiffFile`)
- [ ] `revue prep` — snapshot git state, format hunks with stable `(filePath, oldStart)` ids
- [ ] Render `keyChanges` as inline annotations using hunk's `AgentContext` model
- [ ] Decide static-file vs live agent-driven session (hunk's session daemon)
- [ ] Mermaid prologue diagram rendering (ASCII)

## Credits

Built on [hunk](https://github.com/modem-dev/hunk) (MIT) and the chapter model + skill from
[stage-cli](https://github.com/ReviewStage/stage-cli) (MIT). Thanks to both.
