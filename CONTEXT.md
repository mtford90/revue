# CONTEXT

Domain language and load-bearing concepts for revue. Keep this current as the design firms up.

## What revue is

A terminal-native tool for reviewing a git branch as a **narrated sequence of chapters** rather than
a flat diff.

- **Stage** (`ReviewStage/stage-cli`) contributes the *chapter model* and the *agent skill* that
  clusters a diff into chapters. Stage renders to a browser; we discard that part.
- **Pierre** (`@pierre/diffs`) provides public patch parsing, metadata, language detection, and
  highlighting APIs.
- **Revue** owns the terminal renderer and chapter-navigation shell. Its renderer selectively adapts
  a bounded set of Hunk v0.15.3 concepts under MIT, but does not depend on Hunk at runtime.

revue is Stage's narrative brain plus a Revue-owned Pierre/OpenTUI body.

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
- **View state** — per-run review progress: which chapters / files / key changes are marked reviewed.
  Ported from Stage's three-level model, flattened to id arrays (`chapter.id`,
  `chapterId::filePath`, `chapterId#index`). Marking all of a chapter's files reviewed auto-completes
  the chapter, and vice-versa. Persisted locally, keyed by **run key**.
- **Run key** — a stable sha256 of the chapters content (not the temp file path), so progress
  survives re-runs that produce the same chapters; different chapters → fresh progress.
- **Reviewed / mark-as-reviewed** — the core Stage mechanic. hunk has no such concept; it's entirely
  revue's, persisted to `.revue/state.json` (a `{ [runKey]: ViewState }` map).
- **The chapters file** — the JSON artifact the skill writes and `revue show` reads. Mirrors Stage's
  `AgentOutputSchema` (`{ chapters, prologue? }`). The agent's output *is* the source of truth — there
  is no database (unlike Stage).
- **prep** (planned) — the step that snapshots git state and formats hunks with stable ids for the
  agent. Stage has this; revue does not yet.

## Key decisions

- **Own the renderer; use public Pierre APIs.** See `docs/adr/0002` (supersedes ADR 0001).
  `@revue/diff-renderer` owns parsing adaptation, split/stack rows, terminal presentation, exact
  inclusive old/new decorations, and focus anchors. `@pierre/diffs` is pinned directly to 1.2.2.
- **Bounded Hunk adaptation.** Only Hunk v0.15.3 body/row/geometry/highlighting concepts were adapted;
  provenance and MIT terms live in `packages/diff-renderer/THIRD_PARTY_NOTICES.md`. Do not import
  Hunk, private Pierre paths, or Hunk app/controller/comments/menu/session code.
- **Bun single-toolchain.** Bun executes `.tsx` directly; there is no build step.
- **OpenTUI compatibility stays on `^0.1.89`.** The renderer and TUI share compatible peer/runtime
  versions; upgrades need visual and terminal-behaviour verification.
- **Static file, not (yet) a live session.** revue currently loads a finished chapters file; whether
  it adopts a live agent-driven flow is open.
- **We build the review shell ourselves — by design.** Chapter navigation, file list, review state,
  collapse controls, and later comments belong to Revue. The renderer owns only patch presentation.

## Open questions

- Static viewer vs live session (does the agent push chapters into a running TUI)?
- Do we reimplement Stage's `prep` or shell out to git directly from the TUI process?
