# CONTEXT

Domain language and load-bearing concepts for revue. Keep this current as the design firms up.

## What revue is

A terminal-native tool for reviewing a git branch as a **narrated sequence of chapters** rather than
a flat diff. It combines two existing MIT projects without forking either:

- **Stage** (`ReviewStage/stage-cli`) — contributes the *chapter model* and the *agent skill* that
  clusters a diff into chapters. Stage renders to a browser; we discard that part.
- **hunk** (`modem-dev/hunk`) — contributes the *diff renderer*, embeddable as the published
  `hunkdiff/opentui` OpenTUI component surface.

revue is the seam: Stage's brain, hunk's body, glued by a chapter-navigation shell we own.

## Glossary

- **Chapter** — one narrative beat: a coherent group of diff hunks the reviewer absorbs as a unit,
  with a `title`, a narrated `summary`, the `hunkRefs` it covers, and any `keyChanges`. Ordered.
- **Hunk reference (`hunkRef`)** — `(filePath, oldStart)`. The stable identity of a diff hunk; the
  agent copies these from the diff rather than inventing them. `oldStart` is `0` for new files.
- **Key change** — a judgment-call *question* for a human reviewer (not code, not a changelog line),
  anchored to tight `lineRefs`. Empty when nothing needs human input.
- **Line ref** — `(filePath, side, startLine, endLine)`. `side` is `additions` (new-side line
  numbers) or `deletions` (old-side).
- **Prologue** — a high-level overview of the whole change: motivation, outcome, optional Mermaid
  diagram, 2–5 key changes, 1–5 focus areas, and a complexity rating. Shown before chapter one.
- **Focus area** — a typed/severity-tagged spot in the prologue worth a reviewer's attention.
- **Page** — a TUI navigation unit: the prologue (if present) followed by each chapter in order.
- **The chapters file** — the JSON artifact the skill writes and `revue show` reads. Mirrors Stage's
  `AgentOutputSchema` (`{ chapters, prologue? }`). The agent's output *is* the source of truth — there
  is no database (unlike Stage).
- **prep** (planned) — the step that snapshots git state and formats hunks with stable ids for the
  agent. Stage has this; revue does not yet.

## Key decisions

- **Embed hunk, port Stage, fork neither.** See `docs/adr/0001`.
- **Bun single-toolchain.** hunk runs on Bun; Bun executes `.tsx` directly, no build step.
- **OpenTUI pinned to `^0.1.89`** to match `hunkdiff@0.15.3`'s peer requirement — *not* the latest
  `0.4.x`, which is a breaking API gap that would defeat embedding hunk's components.
- **Static file, not (yet) a live session.** revue currently loads a finished chapters file. hunk also
  supports a live agent-driven session via a loopback daemon; whether revue adopts that is open.

## Open questions

- Static viewer vs live session (does the agent push chapters into a running TUI)?
- How to render a chapter whose `hunkRefs` cover a *subset* of a file's hunks — filter a
  `HunkDiffFile` down to just those hunks before handing it to `<HunkReviewStream>`.
- Do we reimplement Stage's `prep` or shell out to git directly from the TUI process?
