# CONTEXT

Domain language and load-bearing concepts for revue. Keep this current as the design firms up.

## What Revue and Revuediff are

This monorepo ships two independent products over one shared Patch engine:

- **Revue** (`revue`) is a terminal-native tool for reviewing a git diff — a branch, a PR,
  arbitrary refs, or local changes — as a **narrated sequence of chapters**. Narration is the
  product's point but not a prerequisite: a run without chapters opens as a flat, file-by-file diff
  (`revue diff`, bare `revue`), and gains the narrative lens when an agent adds one.

Its narrative architecture follows these boundaries:

- **Stage** (`ReviewStage/stage-cli`) contributes the *chapter model* and the *agent skill* that
  clusters a diff into chapters. Stage renders to a browser; we discard that part.
- **Pierre** (`@pierre/diffs`) provides public patch parsing, metadata, language detection, and
  highlighting APIs behind Revue’s shared `@revue/diff` Patch engine.
- **Revue** owns Git scope capture, immutable run artifacts, the terminal renderer, and the
  chapter-navigation shell. Its Patch engine and OpenTUI adapter selectively adapt
  a bounded set of Hunk v0.15.3 concepts under MIT, but does not depend on Hunk at runtime.
- **Revuediff** (`revuediff`) is a standalone buffered ANSI formatter and pager for Git and
  Lazygit. It shares `@revue/diff`, `@revue/diff-ansi`, and `@revue/theme`, but has no OpenTUI,
  chapter, prepared-run, thread, skill, narrative TUI, or Revue preference dependency.

Revue is Stage's narrative brain plus a Revue-owned Pierre/OpenTUI body. `@revue/diff-ansi`
serialises the same Patch plans for Revuediff; the adapter itself has no React/OpenTUI or process
boundary. The `revue` executable intentionally does not expose a pager command.

## Glossary

- **Revuediff pager** — `revuediff`, a standalone Git/Lazygit stdin diff filter. It buffers and
  sanitises the full stream, renders only complete supported ordinary unified-diff envelopes through
  `@revue/diff-ansi`, and otherwise fails open to full sanitised passthrough. It owns downstream
  pagination and never starts OpenTUI or reads prepared-run, narrative Revue, or `~/.revue` state.
- **Chapter** — one narrative beat: a coherent group of diff hunks the reviewer absorbs as a unit,
  with a `title`, a narrated `summary`, the `hunkRefs` it covers, and any `keyChanges`. Ordered.
- **Hunk reference (`hunkRef`)** — `(filePath, oldStart)`. The stable identity of a review unit; the
  agent copies these from `hunks.txt` rather than inventing them. Textual hunks use their pre-image
  start. A file with no textual hunk (pure rename, mode-only change, or empty file) receives one
  explicit metadata review unit with `oldStart: 0`.
- **Key change** — a severity-tagged judgment-call *question* for a human reviewer (not code, not a
  changelog line), anchored to tight `lineRefs`. Empty when nothing needs human input. Severity is
  explicit on the question so its inline chapter tag and exact diff-range tint cannot drift from
  broad prologue guidance.
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
- **Surface** — a top-level tab above pages: **Story** (the narrated page sequence), **Files** (the
  whole run as one flat stream), and **Comments** (every thread with open/dealt-with status,
  jumping to its owning chapter). Internally Files — and any chapterless run — is one synthetic
  chapter covering every hunk, so all features work identically there.
- **Diff view** — Patch (the default, authoritative line-numbered review surface) or Semantic (a
  lazy, read-only Difftastic rendering of the same run's pinned old/new blobs). Chapter/file focus
  survives switching and the reviewer’s relative chapter position transfers between modes. Semantic
  uses coloured side-by-side output when wide and coloured inline output when narrow; styling is
  translated into safe OpenTUI spans. Key-change anchors navigate and carry severity-tinted exact
  ranges in both views by source line number; Difftastic output is never parsed into durable anchors.
- **File display** — All (the default chapter stream) or Focused (only the selected file). The
  reviewer moves the focused surface through the chapter with file navigation. It applies to both
  diff views and persists machine-wide as a reviewer preference rather than per-run state.
- **Path display** — how file lists render paths: **smart** (common-prefix elision plus directory
  abbreviation, the default), **tree** (a collapsed directory tree), or **full**. A reviewer
  preference, computed by a pure module rather than generic truncation.
- **Context expansion** — GitHub-style revealing of unchanged lines around hunks. Each inter-hunk
  gap is a numbered boundary; revealing rewrites the patch from the run's pinned blobs and
  re-parses it. Blobs are the sole source of extra file content — `show` never touches Git — and
  revealed lines never accept comment anchors.
- **Selection** — the gutter-drag line range that says what the reviewer is acting on. Comment,
  copy-text, copy-location, and copy-GitHub-link are verbs hung off the one selection, reachable
  from the composer footer keys and the right-click menu alike. A GitHub permalink is offered per
  side only when that side's endpoint is a pinned commit; unpinned sides are greyed out with the
  reason.
- **Keybindings** — every shortcut derives from one typed keymap registry (handler, help overlay,
  menu hints, and CLI all read it). Reviewers override actions via hand-edited JSONC at
  `~/.revue/keybindings.json`; escape, digits, and chord prefixes are reserved, and validation
  drops just the broken entry with a surfaced warning. `revue keybindings` prints the effective
  map.
- **View state** — per-run review progress: which chapters / files / key changes are marked reviewed.
  Ported from Stage's three-level model, flattened to id arrays (`chapter.id`,
  `chapterId::filePath`, `chapterId#index`). Marking all of a chapter's files reviewed auto-completes
  the chapter, and vice-versa. Persisted locally, keyed by **run key**.
- **Review session state** — narration-sensitive location within one run: current page, focused
  file/hunk/question, collapsed files, and scroll offsets. It is stored beside review progress under
  the same run key in `.revue/state.json`. It restores a saved review rather than becoming part of
  the immutable run. Unfinished thread drafts are deliberately excluded.
- **Run** — an immutable directory under `.revue/runs/<runId>/` containing `run.json`, the pinned
  `diff.patch`, agent-facing `hunks.txt`, content-addressed old/new blobs, and — optionally — the
  agent-written `chapters.json`. `show` consumes this directory and never recomputes Git state. A
  run without chapters is fully reviewable as a flat diff; narration is an overlay, not
  scaffolding.
- **Run ID** — the full sha256 of the canonical prepared input: resolved scope/endpoints, patch and
  hunk hashes, file snapshots/modes, commit messages, effective ignore inputs, exclusions, and
  totals. Creation time and narration are deliberately excluded. Content-addressing means
  re-preparing an unchanged scope reproduces the same runId, which is what makes the TUI's reload
  action a true no-op when the reviewed content hasn't moved.
- **Run key** — `sha256(runId + chapters)`, truncated for local persistence; a chapterless run
  hashes `runId` plus a chapterless sentinel so its progress keys on the snapshot alone. Review
  progress belongs to one pinned code snapshot narrated one specific way; changing either starts
  fresh, except that a newly narrated run seeds its view state from any chapterless progress for
  the same snapshot (a one-way migration). Threads use the full immutable **run ID** instead, so
  feedback survives chapter regeneration for unchanged frozen code.
- **Reviewed / mark-as-reviewed** — the core Stage mechanic. hunk has no such concept; it's entirely
  revue's, persisted to `.revue/state.json` (a `{ [runKey]: ViewState }` map).
- **The chapters file** — `chapters.json` inside a run. It mirrors Stage’s agent output
  (`{ chapters, prologue? }`). The narration is the source of truth; there is no database.
- **prep** — the CLI step that resolves committed/staged/unstaged/work scope, freezes the exact patch
  and old/new file bytes, uses Git's standard exclusions to discover untracked files, applies
  built-in, root `.revueignore`, and session `--ignore` filtering, and emits numbered hunks.
  Persistent rules run before session rules; both rename paths are tested, and every effective input
  and omission reason is pinned in the run. Local modes detect
  index/worktree races and fail rather than produce a mixed snapshot.
- **Theme** — the single palette Revue paints with, derived from one bundled editor theme rather
  than hand-picked: neutral surfaces, foregrounds, diff row tints, semantic status colours, and the
  Shiki theme highlighted source uses. Derivation enforces WCAG contrast floors, so a theme stays
  readable whatever surface it lands on. Selection is the reviewer's, not the run's: `--theme`
  names one for a session, the in-app picker previews and accepts one, and the accepted id persists
  machine-wide to `~/.revue/preferences.json` with the reviewer's layout choices. Without a named
  or remembered theme Revue uses `ayu-dark`; explicit `auto` asks the terminal to choose between
  `ayu-light` and `ayu-dark`. Transparent mode drops the neutral surfaces while keeping diff tints.
  Reviewers can also author custom themes as derivation-input files under `~/.revue/themes/`,
  either `extends`-ing a bundled theme or supplying their own background/foreground, with
  `overrides` pinning individual colour slots verbatim after derivation; a custom id matching a
  bundled one shadows it in the picker/listing. Validation is lenient and per-file, dropping just
  the broken theme or key rather than all custom themes.
- **Intra-line emphasis** — patch-view marking of the changed characters *within* a paired
  removed/added line: a stronger diff-tinted background behind the changed spans, syntax
  foregrounds untouched. Only lines the differ pairs as revisions of each other carry it;
  unpaired lines keep the plain row tint.
- **Novel emphasis** — semantic-view bold/dim marking of the tokens Difftastic reports as novel.
  A distinct concept from intra-line emphasis: novelty is structural, computed by Difftastic;
  intra-line emphasis is textual, computed by revue's own patch differ.
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
  `@revue/diff` owns Pierre adaptation, Revue structural types, analysis, sanitisation and the
  complete width-aware visual plan; `@revue/diff-opentui` owns React/OpenTUI presentation, pointer
  handling, attachments, measurement and renderable IDs. `@pierre/diffs` is pinned directly to 1.2.2.
- **One derived palette, not two hand-picked ones.** See `docs/adr/0008`. `@revue/theme` owns
  colour maths, the bundled
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
- **Intra-line emphasis is owned, textual, and patch-only.** See `docs/adr/0005`. `@revue/diff` pairs changed lines (by position for equal-count blocks, similarity-gated otherwise) and computes
  token-level spans; emphasis is background-only and never appears in semantic view, where novelty
  is Difftastic's structural concept.
- **Chapters are an optional overlay, not required scaffolding.** See `docs/adr/0006`. A run
  without `chapters.json` opens as a flat diff through the same immutable-run pipeline, modelled
  internally as one synthetic chapter so every feature works in both modes by construction.
  Chapterless progress seeds narrated progress one way; markdown export refuses a chapterless run.
- **Alternate views synthesise patches; anchors stay on the git hunks.** See `docs/adr/0007`.
  Semantic view and context expansion synthesise unified patches replayed through the one
  canonical pipeline rather than owning renderers. Displayed geometry varies per view; comment
  anchors always resolve against the original git hunks, so every thread renders in every view and
  synthesised-only lines refuse comments.
- **One keymap registry; user-owned overrides.** See `docs/adr/0009`. Shortcuts exist once, in the
  typed registry; `~/.revue/keybindings.json` overrides action-to-keys with reserved keys,
  fixed-point merging, and per-entry lenient validation.
- **Preferences belong to the reviewer; progress belongs to the repository.** See `docs/adr/0010`.
  `~/.revue` holds machine-wide reviewer state, split into machine-written (`preferences.json`)
  and hand-edited (`keybindings.json`, `themes/`) files that never mix; `./.revue` holds run
  progress, session state, and threads. All such writes are non-fatal.
- **Independent native release trains.** Revue retains `vX.Y.Z` tags, synchronises the root and
  TUI package versions, and gates each platform artefact with the real-PTY alternate-screen smoke
  test recorded by `docs/adr/0011`. Revuediff starts at 0.1.0, uses `revuediff-vX.Y.Z` tags, versions
  only `packages/revuediff`, and runs a separate stdin-formatting smoke test with the same native
  platform matrix but no OpenTUI alternate-screen requirement. Release Please uses path-specific
  outputs to dispatch only the matching build workflow; Homebrew formulae, installers, assets, and
  checksums are product-specific. Neither product is distributed through npm, and difftastic remains
  an optional Revue-only runtime probe.
- **The TUI owns viewport windowing.** See `docs/adr/0012`. OpenTUI culling still pays full layout
  cost, so Revue mounts only near-window row segments and preserves scroll geometry with
  fixed-height gaps; reveals are offset-based, and diff-body components need measurable heights.
- **Agents never launch the TUI.** An agent validates with `revue show "$RUN" --check` and hands
  the human the exact `revue show` command for their own terminal; the TUI cannot run inside an
  agent harness, and the skill forbids suggesting otherwise.
- **Semantic diff is a read-only external view.** The TUI invokes a compatible `difft` lazily and
  passes only verified blob paths from the supplied run (using an empty temporary side for an absent
  added/deleted snapshot). It parses only Difftastic’s presentation styling into terminal-safe spans,
  not unstable JSON or durable line identities. Binary, symlink, mode-only, and content-identical
  metadata states receive explicit descriptions rather than fabricated semantic output;
  availability or process failures return the reviewer to Patch.

## Open questions

- Static prepared run vs live session (does the agent push chapters into a running TUI)?
