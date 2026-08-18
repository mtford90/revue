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
- **Chapter** — one narrative beat, with a `title`, a narrated `summary`, the `hunkRefs` it covers,
  any `keyChanges`, and any context `excerpts` it quotes. Usually a coherent group of diff hunks the
  reviewer absorbs as a unit; a chapter with no hunks at all is an **interlude**. Fenced `ascii` and
  `mermaid` blocks in the summary leave the prose and draw as **diagrams** beside the excerpts; every
  other fence stays inline as a snippet. Ordered.
- **Diagram** — a figure a chapter draws rather than a range it quotes, wearing the excerpt's chrome
  over a blank gutter because it cites no file. An `ascii` figure is the drawing itself. A `mermaid`
  figure is source Revue draws: a `flowchart`/`graph` is parsed and laid out as ASCII boxes and
  arrows, always top to bottom whatever direction it declares, because columns are the scarce axis in
  a terminal. Everything outside that subset — another diagram type, unmodelled flowchart syntax, a
  cycle, malformed source, or a figure too wide for the content column — falls back to showing the
  author's source, labelled and coloured as source. Never half-drawn.
- **Interlude** — a chapter with no hunks: a title, prose that may run longer than a normal summary,
  and optionally excerpts and diagrams. It is *inferred* from an empty `hunkRefs`, never flagged, so
  no field can contradict the hunk list. An ordinary page otherwise — it navigates, marks read, and
  counts toward chapter progress — but it shows no file list and completes on the mark-read key
  alone, since it has no files to complete it vacuously.
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
- **Thread** — the official mutable feedback aggregate, independently identified and anchored by one
  of two anchor kinds. A `hunk` anchor is `(filePath, oldStart, side, startLine, endLine)`; the
  review-unit `oldStart` keeps it tied to exactly one pinned hunk even when a path appears in
  multiple chapters. An `excerpt` anchor is `(filePath, startLine, endLine)` over quoted code and
  resolves against the frozen context rather than the patch; it deliberately carries no `oldStart`
  and no `side`, because `oldStart: 0` is already the metadata review unit's sentinel and an excerpt
  borrowing it would be indistinguishable from a thread on a file with no textual hunk. The two
  kinds fail differently: a hunk anchor that no longer resolves is corruption and blocks the load,
  while an excerpt anchor the frozen context no longer covers is surfaced as **orphaned** and never
  pruned, because re-narrating at another depth legitimately drops a citation. A thread has ordered
  messages and a thread-level `open` or reversible `dealt-with` status; multiple threads may share
  an anchor.
- **Carried thread** — a thread prep moved onto a run from the run it **supersedes**, open and
  dealt-with alike, so the conversation and its history stay with the code rather than stranding on
  a dead run. Threads move rather than copy — the superseded run is left with none — and keep their
  identity, status, and every message, gaining only a note of the run they came from. Hunk anchors
  are re-mapped through the run delta's unit matching: a unit that came through with its content
  intact shifts exactly, one the change rewrote keeps the offset it was commented at, and an anchor
  no unit of the new run can hold is orphaned rather than fatal, because supersession legitimately
  deletes code. That leniency is the carried thread's alone; an anchor written against the run it
  names can only stop resolving through corruption. Excerpt anchors are re-resolved against the new
  run's frozen context and orphan exactly as they always have.
- **Thread message** — one independently identified root message or reply containing a terminal-safe
  body, creation time, and `{ kind: "human" | "agent", name }` author. Human TUI names resolve from
  repository-aware `git config user.name`, then the system login. Agent CLI messages require an
  explicit author name. Root messages are removed with their thread; replies may be deleted alone.
- **Prologue** — a high-level overview of the whole change: motivation, outcome, optional Mermaid
  diagram (drawn as a **diagram**, in a bordered box of its own), 2–5 key changes, 1–5 focus areas,
  and a complexity rating. Shown before chapter one.
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
  Cited context excerpts render in Patch only.
- **File display** — All (the default chapter stream) or Focused (only the selected file). The
  reviewer moves the focused surface through the chapter with file navigation. It applies to both
  diff views and persists machine-wide as a reviewer preference rather than per-run state.
- **Path display** — how file lists render paths: **smart** (common-prefix elision plus directory
  abbreviation, the default), **tree** (a collapsed directory tree), or **full**. A reviewer
  preference, computed by a pure module rather than generic truncation.
- **Context expansion** — GitHub-style revealing of unchanged lines around hunks. Each inter-hunk
  gap is a numbered boundary; revealing rewrites the patch from the run's pinned blobs and
  re-parses it. Blobs are the sole source of extra file content — `show` never touches Git — and
  revealed lines never accept comment anchors. Distinct from a **context excerpt**, which is
  narration and does accept them.
- **Context excerpt** — a range of *unchanged* code a chapter cites so the reviewer can see what the
  change has to satisfy: a file path, an inclusive new-side line range, and an optional caption.
  The agent cites; it never transcribes. `revue context freeze` resolves each citation against the
  run's own recorded new endpoint and pins the bytes into `context.json`, so quoted code came off
  disk. A cited file need not appear in the diff — quoting the untouched caller is the point. Folded
  to a single band by default, opens in place, reads as scenery rather than work, contributes
  nothing to review progress, and accepts comments on its lines, because a citation is pinned
  narration rather than an ad-hoc reveal. Patch view only; the semantic view quotes nothing.
  Quoted lines are currently rendered unhighlighted.
- **Narrative depth** — the chapters file's own declaration of how much of the prepared diff it sets
  out to cover: `full`, or `partial` carrying the label the reviewer sees (the `10,000ft` preset, or
  freeform words for a bespoke request). An absent declaration means full, so every chapters file
  written before depth existed keeps its meaning. It is the only thing that permits a narrative to
  leave review units out.
- **Coverage** — how many prepared review units the narration actually cites, against how many exist.
  `revue show --check` reports it for every run; the TUI states it in exactly two places — a
  status-bar segment after the file count, and the chapter-index header plus one line beneath it —
  and in neither at full depth, because full is the baseline rather than a mode. Whatever the
  narrative omits stays reachable through the Files surface.
- **Selection** — the gutter-drag line range that says what the reviewer is acting on. Comment,
  copy-text, copy-location, and copy-GitHub-link are verbs hung off the one selection, reachable
  from the composer footer keys and the right-click menu alike. A GitHub permalink is offered per
  side only when that side's endpoint is a pinned commit; unpinned sides are greyed out with the
  reason.
- **Keybindings** — every shortcut derives from one typed keymap registry (handler, keys surface,
  menu hints, and CLI all read it). Reviewers override actions via hand-edited JSONC at
  `~/.revue/keybindings.json`; escape and digits are reserved, and validation drops just the broken
  entry with a surfaced warning. Most actions carry several keys so that muscle memory from Vim,
  `less`, the diff TUIs and plain arrow-key use all resolve; `revue keybindings` prints the
  effective map, including the aliases the keys surface holds back.
- **View state** — per-run review progress: which chapters / files / key changes are marked reviewed.
  Ported from Stage's three-level model, flattened to id arrays (`chapter.id`,
  `chapterId::filePath`, `chapterId#index`). Marking all of a chapter's files reviewed auto-completes
  the chapter, and vice-versa. Excerpts appear in it nowhere: quoted code is scenery, not work.
  Persisted locally, keyed by **run key**.
- **Review session state** — narration-sensitive location within one run: current page, focused
  file/hunk/question, collapsed files, which excerpts and diagrams have been opened (both fold shut
  by default, so only the openings are recorded), and scroll offsets. It is stored beside review progress under
  the same run key in `.revue/state.json`. It restores a saved review rather than becoming part of
  the immutable run. Unfinished thread drafts are deliberately excluded.
- **Run** — an immutable directory under `.revue/runs/<runId>/` containing `run.json`, the pinned
  `diff.patch`, agent-facing `hunks.txt`, content-addressed old/new blobs, and — optionally — the
  agent-written `chapters.json`, the `context.json` that `revue context freeze` pins the code
  the narration quotes into, and — when the run supersedes another — the `delta.json` prep records.
  All three are narration-side and excluded from the run ID, so narrating, freezing, or carrying
  narration forward can never invalidate the code it describes. `show` consumes this
  directory and never recomputes Git state. A
  run without chapters is fully reviewable as a flat diff; narration is an overlay, not
  scaffolding.
- **Run delta** — what a run inherits from the narrated run it **supersedes**, recorded once at
  creation in `delta.json` and printed by `revue delta`. Every review unit of the new run is
  classified against the predecessor's by content rather than position — **unchanged** however far
  its lines moved, **modified** where it rewrites the same pre-image lines differently, otherwise
  **new**. A chapter every one of whose units came through unchanged is **carried forward**:
  pre-copied with its hunk references and key-change line ranges re-mapped, and with the code it
  quotes re-frozen against the new run. Any other chapter is **stale**, named with the reason, and
  re-narrated rather than patched. What no carried chapter covers is the agent's worklist. Like
  `chapters.json` and `context.json` the delta is narration-side and outside the run ID. The same
  unit classification re-anchors **carried threads**, so feedback and narration follow the code by
  one shared rule.
- **Run ID** — the full sha256 of the canonical prepared input: resolved scope/endpoints, patch and
  hunk hashes, file snapshots/modes, commit messages, effective ignore inputs, exclusions, and
  totals. Creation time and narration are deliberately excluded. Content-addressing means
  re-preparing an unchanged scope reproduces the same runId, which is what makes the TUI's reload
  action a true no-op when the reviewed content hasn't moved.
- **Run key** — `sha256(runId + chapters)`, truncated for local persistence; a chapterless run
  hashes `runId` plus a chapterless sentinel so its progress keys on the snapshot alone. Review
  progress belongs to one pinned code snapshot narrated one specific way; changing either starts
  fresh, except for two seeds into an as-yet unreviewed run: a newly narrated run inherits any
  chapterless progress for the same snapshot (a one-way migration), and a run opened by reload
  inherits the progress of the run it replaced, keeping a file's mark only where that file's frozen
  snapshots are identical in both runs. Threads use the full immutable **run ID** instead, so
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
- **Status** — `revue status`, the one call that answers "where is this review?" entirely from disk,
  so a fresh agent session orients without remembering anything. It names the **active run** (the
  newest narrated run of the lineage) and the prep arguments that reproduce its scope, any newer run
  that supersedes it and is not narrated yet along with what its delta still owes, the run's open
  threads split into those **awaiting the agent** (a human spoke last) and those **awaiting the
  reviewer** (an agent did) plus the anchors it orphaned, and **drift**: whether re-prepping the
  active run's scope would capture code the run never pinned. Drift is asked of the run ID rather
  than of Git, because a run ID is a content address. A repository with no runs is reported as such,
  not as an error.
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
  How strictly show checks coverage keys on the narrative's declared depth (see `docs/adr/0014`):
  at full depth — which is also what an absent declaration means — it still requires every prepared
  review unit exactly once, so the default case is unchanged. Only an explicitly partial depth may
  omit units. Duplicate units, unknown units, and key-change line ranges outside their chapter’s
  pinned hunks are rejected at every depth.
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
  from replacing one another's feedback — including prep, which takes the same lock to move threads
  onto a run that supersedes the one they were left on. Durable hunk anchors include review-unit
  `oldStart`;
  excerpt anchors carry none and resolve against the run's frozen context instead
  (see `docs/adr/0014`). The renderer exposes only feedback-neutral gutter
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
  canonical pipeline rather than owning renderers. Displayed geometry varies per view; hunk anchors
  always resolve against the original git hunks, so every such thread renders in every view and
  synthesised-only lines refuse comments. Narration-cited excerpts are a second anchor authority
  resolving against the frozen context (see `docs/adr/0014`); *ad hoc* context expansion still
  refuses comments, because revealed lines are not pinned narration.
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
- **A narrative declares its depth; Revue freezes the code it quotes.** See `docs/adr/0014`, which
  extends ADRs 0003, 0004 and 0007 rather than superseding them. Coverage strictness keys on the
  declared depth so nothing loosens by default; excerpt citations are frozen off disk by
  `revue context freeze` rather than transcribed by the agent, and may name files outside the diff;
  and quoted code carries its own anchor kind, whose failure to resolve is orphaning rather than
  corruption.
- **Mermaid flowcharts are drawn; everything else stays source.** See `docs/adr/0016`. The parser
  and the ASCII layout live in `@revue/diff` beside the rest of the visual plan, so a diagram block
  says whether it holds a drawing or source and every adapter renders that decision identically.
  The subset is deliberately narrow and the fallback is a designed path: nothing is half-drawn.
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
