# CONTEXT

Domain language and load-bearing concepts for revue. Keep this current as the design firms up.

## What revue is

A terminal-native tool for reviewing a git branch as a **narrated sequence of chapters** rather than
a flat diff.

- **Stage** (`ReviewStage/stage-cli`) contributes the *chapter model* and the *agent skill* that
  clusters a diff into chapters. Stage renders to a browser; we discard that part.
- **Pierre** (`@pierre/diffs`) provides public patch parsing, metadata, language detection, and
  highlighting APIs through Revue’s shared `@revue/diff-model` adapter.
- **Revue** owns Git scope capture, immutable run artifacts, the terminal renderer, and the
  chapter-navigation shell. Its renderer selectively adapts
  a bounded set of Hunk v0.15.3 concepts under MIT, but does not depend on Hunk at runtime.

revue is Stage's narrative brain plus a Revue-owned Pierre/OpenTUI body.

## Glossary

- **Chapter** — one narrative beat: a coherent group of diff hunks the reviewer absorbs as a unit,
  with a `title`, a narrated `summary`, the `hunkRefs` it covers, and any `keyChanges`. Ordered.
- **Hunk reference (`hunkRef`)** — `(filePath, oldStart)`. The stable identity of a review unit; the
  agent copies these from `hunks.txt` rather than inventing them. Textual hunks use their pre-image
  start. A file with no textual hunk (pure rename, mode-only change, or empty file) receives one
  explicit metadata review unit with `oldStart: 0`.
- **Key change** — a judgment-call *question* for a human reviewer (not code, not a changelog line),
  anchored to tight `lineRefs`. Empty when nothing needs human input.
- **Line ref** — `(filePath, side, startLine, endLine)`. `side` is `additions` (new-side line
  numbers) or `deletions` (old-side).
- **Thread** — the official mutable feedback aggregate, independently identified and anchored by
  `(filePath, oldStart, side, startLine, endLine)`. The review-unit `oldStart` keeps it tied to exactly
  one pinned hunk even when a path appears in multiple chapters. A thread has ordered messages and a
  thread-level `open` or reversible `dealt-with` status; multiple threads may share an anchor.
- **Thread message** — one independently identified root message or reply containing a terminal-safe
  body, creation time, and `{ kind: "human" | "agent", name }` author. Human TUI names resolve from
  repository-aware `git config user.name`, then the system login. Agent CLI messages require an
  explicit author name. Root messages are removed with their thread; replies may be deleted alone.
- **Prologue** — a high-level overview of the whole change: motivation, outcome, optional Mermaid
  diagram, 2–5 key changes, 1–5 focus areas, and a complexity rating. Shown before chapter one.
- **Focus area** — a typed/severity-tagged spot in the prologue worth a reviewer's attention.
- **Page** — a TUI navigation unit: the prologue (if present) followed by each chapter in order.
- **Diff view** — Patch (the default, authoritative line-numbered review surface) or Semantic (a
  lazy, read-only Difftastic rendering of the same run's pinned old/new blobs). Chapter/file focus
  survives switching and the reviewer’s relative chapter position transfers between modes. Semantic
  uses coloured side-by-side output when wide and coloured inline output when narrow; styling is
  translated into safe OpenTUI spans. Exact key-change anchors, range highlights, and threads are
  Patch-only; Difftastic output is never parsed into durable anchors.
- **View state** — per-run review progress: which chapters / files / key changes are marked reviewed.
  Ported from Stage's three-level model, flattened to id arrays (`chapter.id`,
  `chapterId::filePath`, `chapterId#index`). Marking all of a chapter's files reviewed auto-completes
  the chapter, and vice-versa. Persisted locally, keyed by **run key**.
- **Run** — an immutable directory under `.revue/runs/<runId>/` containing `run.json`, the pinned
  `diff.patch`, agent-facing `hunks.txt`, content-addressed old/new blobs, and the agent-written
  `chapters.json`. `show` consumes this directory and never recomputes Git state.
- **Run ID** — the full sha256 of the canonical prepared input: resolved scope/endpoints, patch and
  hunk hashes, file snapshots/modes, commit messages, effective ignore inputs, exclusions, and
  totals. Creation time and narration are deliberately excluded.
- **Run key** — `sha256(runId + chapters)`, truncated for local persistence. Review progress belongs
  to one pinned code snapshot narrated one specific way; changing either starts fresh. Threads use
  the full immutable **run ID** instead, so feedback survives chapter regeneration for unchanged
  frozen code.
- **Reviewed / mark-as-reviewed** — the core Stage mechanic. hunk has no such concept; it's entirely
  revue's, persisted to `.revue/state.json` (a `{ [runKey]: ViewState }` map).
- **The chapters file** — `chapters.json` inside a run. It mirrors Stage’s agent output
  (`{ chapters, prologue? }`). The narration is the source of truth; there is no database.
- **prep** — the CLI step that resolves committed/staged/unstaged/work scope, freezes the exact patch
  and old/new file bytes, applies built-in, root `.revueignore`, and session `--ignore` filtering,
  and emits numbered hunks. Persistent rules run before session rules; both rename paths are tested,
  and every effective input and omission reason is pinned in the run. Local modes detect
  index/worktree races and fail rather than produce a mixed snapshot.
- **Theme** — the single palette Revue paints with, derived from one bundled editor theme rather
  than hand-picked: neutral surfaces, foregrounds, diff row tints, semantic status colours, and the
  Shiki theme highlighted source uses. Derivation enforces WCAG contrast floors, so a theme stays
  readable whatever surface it lands on. Selection is the reviewer's, not the run's: `--theme`
  names one for a session, the in-app picker previews and accepts one, and the accepted id persists
  to `.revue/preferences.json`. Without a named theme the terminal's own background chooses between
  the light and dark defaults. Transparent mode drops the neutral surfaces while keeping diff tints.
- **Markdown export** — a deterministic, read-only rendering of a validated run's prologue, ordered
  chapters, pinned file metadata, review questions, authored threads, and optional local review
  progress. Full review is the default; prologue and one chapter by stable id/order are explicit
  selections. Prologue-only output omits threads. Export never recomputes Git state or writes state.

## Key decisions

- **The CLI owns the skill text; the skills CLI owns distribution.** The `revue` skill
  is embedded in the CLI at build time and stamped with the CLI version, so an installed binary
  always distributes its matching skill. `revue skill install` hands that stamped copy to the
  open skills CLI (vercel-labs/skills) via npx/pnpm/bunx/yarn, which detects installed coding
  agents and owns every per-harness path — revue maintains no agent matrix. `revue skill print`
  covers machines without a package runner, and `revue doctor` reports drift for the Claude Code
  copy. The skill advises how to install the CLI when it is missing but never installs binaries
  itself.
- **Share the diff model; own the renderer.** See `docs/adr/0002` (supersedes ADR 0001).
  `@revue/diff-model` owns Pierre parsing adaptation and stable file/hunk identities;
  `@revue/diff-renderer` owns split/stack rows, terminal presentation, exact inclusive old/new
  decorations, and focus anchors. `@pierre/diffs` is pinned directly to 1.2.2.
- **One derived palette, not two hand-picked ones.** `@revue/theme` owns colour maths, the bundled
  editor-theme table, and the derivation; the shell reads it through one React context and the
  renderer takes it as a prop, so no package keeps a palette of its own. Highlighting is prepared
  per syntax theme and the diff keeps the last prepared colours while a new theme is highlighting,
  rather than dropping to unhighlighted text. Terminal background detection is OpenTUI's.
- **Bounded Hunk adaptation.** The renderer adapts Hunk v0.15.3
  body/row/geometry/highlighting concepts; the TUI separately adapts its small menu chrome and
  controller concepts. Provenance and MIT terms live in each package’s `THIRD_PARTY_NOTICES.md`.
  Do not import Hunk at runtime, use private Pierre paths, or adopt Hunk’s app, comments, or session
  model.
- **Bun single-toolchain.** Bun executes `.tsx` directly; there is no build step.
- **OpenTUI compatibility stays on `^0.1.89`.** The renderer and TUI share compatible peer/runtime
  versions; upgrades need visual and terminal-behaviour verification.
- **Immutable local run, not (yet) a live session.** Prep writes a finished run directory and the
  agent adds narration before `show`; whether Revue later drives the agent live remains open.
- **Prep owns scope; show never touches Git.** See `docs/adr/0003`. Old/new blobs and Git modes are
  stored with the patch so semantic diff and full-file context can consume the same frozen input.
  Show rejects missing, extra, or duplicate review units and line ranges outside their chapter’s
  pinned hunks before claiming the run is valid.
- **We build the review shell ourselves — by design.** Chapter navigation, file list, review state,
  collapse controls, application menus, and inline threads belong to Revue. Menu actions call the
  same Revue handlers as shortcuts; the renderer owns only patch presentation.
- **Export formats verified runs, not repositories.** Markdown export calls the same public run
  loading and coverage validation path as `show`, reads persisted state under the same run key, and
  delegates to a pure formatter package with no OpenTUI dependency.
- **Threads are mutable state keyed by immutable code.** See `docs/adr/0004`. Revue locates the
  reviewed repository from the supplied run, validates and atomically replaces its
  `.revue/threads.json`, keyed by full `runId`; prepared run directories remain immutable. Mutations
  take a cross-process lock and transform the latest same-run state, preventing TUI/agent writers
  from replacing one another's feedback. Durable anchors include review-unit `oldStart`, while the
  renderer exposes only feedback-neutral gutter
  selection and inline attachment placement. Revue owns thread/message UUIDs, authors, lifecycle,
  presentation, CLI operations, and chapter association. The disposable pre-thread comment store
  was reset rather than introducing a legacy migration.
- **Semantic diff is a read-only external view.** The TUI invokes a compatible `difft` lazily and
  passes only verified blob paths from the supplied run (using an empty temporary side for an absent
  added/deleted snapshot). It parses only Difftastic’s presentation styling into terminal-safe spans,
  not unstable JSON or durable line identities. Binary, symlink, mode-only, and content-identical
  metadata states receive explicit descriptions rather than fabricated semantic output;
  availability or process failures return the reviewer to Patch.

## Open questions

- Static prepared run vs live session (does the agent push chapters into a running TUI)?
