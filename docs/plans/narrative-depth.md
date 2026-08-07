# Plan — Narrative depth

Context excerpts, interludes, zoomed-out narratives, and prose yank.

- PRD: `./docs/plans/narrative-depth-prd.md` — published at https://trello.com/c/eOlXatsI
- Brief: `./docs/design-briefs/2026-08-07-narrative-depth.md`
- Design handoff: `./docs/design-briefs/narrative-depth/handoff.md` (build from section D of the
  `.dc.html`, frames `10c`, `10a`, `10b`, `10d`)

## What we are building

Four additions to the Story surface, plus the run-side machinery they need:

1. **Context excerpts** — a chapter quotes a range of unchanged code. Folded by default, opens in
   place, reads as scenery rather than work, contributes nothing to progress, and accepts comments.
2. **Interludes** — a chapter with no hunks: title, longer prose, optional excerpts and diagrams.
   An ordinary page in the sequence that participates in chapter progress.
3. **Zoomed-out narratives** — the narrative declares a depth (`full`, the `10,000ft` preset, or a
   freeform agent-written label). Below full depth, chapters deliberately omit hunks; the omitted
   ones stay reachable through the Files surface, and the UI states coverage calmly in two places.
4. **Prose yank** — narration is selectable and yankable, with an optional chapter reference.

## Decisions already taken

- **Comments on narration are out of scope.** The design dropped them in favour of prose yank; a
  chapter-level thread has no home in the decided layout and regeneration at a new depth would
  orphan it. Tracked separately, designed properly, later.
- **Excerpt content is frozen by the CLI, never transcribed by the agent.** A new
  `revue context freeze` step reads each cited range from the run's own endpoint revision and pins
  it. The reviewer therefore reads code that came off disk.
- **Interludes are inferred, not flagged.** A chapter with `hunkRefs: []` *is* an interlude; no
  `kind` field to contradict the hunk list.
- **Coverage strictness keys on declared depth.** `full` — the default, and what an absent field
  means — keeps today's exact "every review unit exactly once" rule. Only an explicitly partial
  depth may omit units. Nothing silently loosens.
- **No new theme slots, no new keybindings.** Confirmed by the handoff against the real keymap and
  palette.

## Sequencing

Phases 3–6 are independent of each other once phase 1 lands, so they can run in parallel.

```
1 foundation ──┬── 2 freeze ── 3 excerpt rendering ──┬── 7 excerpt threads ── 8 export
               ├── 4 interludes                      │
               ├── 5 coverage indicator              │
               └── 6 prose yank ─────────────────────┘
```

### Phase 1 — Narrative depth foundation

Schema and validation. Everything else depends on this.

- `packages/types/src/chapters.ts` — add `excerpts` to a chapter; add a file-level
  `narrative.depth`. `hunkRefs` already permits an empty array, so interludes need no schema change.
- `packages/prep/src/coverage.ts` — permit partial review-unit coverage when depth is explicitly
  partial; keep duplicate-unit, unknown-unit, and key-change range errors exactly as they are;
  validate excerpt refs (known file, sane range).
- `revue show --check` — report narrated/total coverage in its summary.

**Verification:** unit tests over `validateReviewCoverage` for full vs partial depth, empty
`hunkRefs`, and excerpt ranges; existing coverage tests must pass untouched.

### Phase 2 — `revue context freeze`

- One command, run by the skill after it writes `chapters.json`: reads every excerpt ref in the
  file, resolves each range against the run's `newEndpoint` via prep's existing `readSnapshot`, and
  writes `context.json` beside the chapters file.
- `context.json` is narration-side: excluded from `runId`, so freezing never invalidates a run.
  It records the frozen text plus the source revision for provenance.
- **Worktree scopes must guard against drift.** `prep` already fails on index/worktree races via
  `verifyWorktreeSnapshots`; freeze needs the same check rather than pinning content that moved
  after prep.
- `--check` requires frozen content for every excerpt and fails with an actionable message naming
  the freeze command.

**Verification:** integration tests over committed and worktree scopes, including the drift case.

### Phase 3 — Excerpt rendering

- `packages/diff/src/plan.ts` — a fourth `PlannedDiffRow` kind for excerpt rows, with fold state as
  a *planning input* so heights stay measurable under viewport windowing (ADR 0012). A folded
  excerpt is one row; an open one is header + caption + N lines.
- `packages/diff-opentui/src/components.tsx` — folded band (structurally `ExpanderBand`), open
  header, and excerpt rows reusing `Gutter`/`LineContent`. Line numbers sit in the **additions**
  gutter so quoted code lands on the same column as reviewable code; column 0 carries the rule
  glyph; the sign slot stays empty. Full width with one gutter in split layout.
- `packages/tui/src/app.tsx` — place excerpts in narration order within `ChapterView`; caption row
  above the block; fold state beside `collapsedFiles` in `ReviewSessionState`, default folded.

**Verification:** golden row-plan snapshots at several widths, folded and open; `virtualRows` tests
for the fold's effect on the window plan.

### Phase 4 — Interludes

- Sidebar: `¶` glyph on the index entry, no file list, no "What to review".
- Content column: the `── end of chapter ──` close and its two dim keys.
- Progress: `isChapterReviewed` unchanged; an interlude with no files completes on `x` alone.
- Diagram blocks (`diagram · ascii`, `diagram · mermaid source`) reusing the excerpt chrome, and
  fenced code blocks in `packages/tui/src/markdown.tsx` — the one renderer addition.

**Verification:** snapshot tests of an interlude page; a progress test for the no-files case.

### Phase 5 — Coverage indicator

- `packages/tui/src/statusBar.tsx` — a `muted` segment on `panel` after the files count, shedding
  the word `hunks` then the whole segment, but only after the gauge and thread count have gone.
- `packages/tui/src/app.tsx` — depth label on the `Chapters (N)` header and the coverage line under
  it.
- Both absent entirely at full depth.

**Verification:** status-bar width tests down to 80 columns; a full-depth run renders no coverage
chrome at all.

### Phase 6 — Prose yank

- Narration selects with the pointer and yanks with `y` (existing `copy-selection`).
- A reduced variant of `buildRangeMenu`: copy selected text, copy with chapter reference, and a
  disabled `Copy path:line`. No GitHub link, no comment verb.
- `Copy with chapter reference` prepends `Ch N · {title}` and quotes the prose; notice reads
  `Copied narration · Ch N`.

**Verification:** unit tests over the reduced menu and the reference-formatting helper.

### Phase 7 — Threads on excerpt lines

- `packages/types/src/threads.ts` — a new anchor kind for excerpt ranges, keyed to `runId`.
- `packages/tui/src/threads.ts` — validation against `context.json` rather than patch hunks;
  attachment placement in the excerpt gutter; `revue threads create` accepts the new anchor.
- Amend ADR 0007: narration-cited excerpts accept comments; *ad hoc* context expansion still does
  not.

`validateThreadsForRun` currently **throws** on an anchor it cannot resolve. Regenerating a
narrative at a different depth can legitimately remove an excerpt, so unresolvable excerpt anchors
are surfaced as orphaned in the Comments surface — never fatal, never pruned. Re-narrating a run is
a normal act and must not be destructive.

**Verification:** anchor round-trip tests through the CLI; a regeneration test covering the
orphan path.

### Phase 8 — Export, skill, docs

- `packages/markdown-export` — chapters with no hunks, excerpts, the depth and coverage header, and
  excerpt threads. It currently throws when a chapter references a file outside the manifest, which
  excerpts of untouched files will now do legitimately.
- `skills/revue/SKILL.md` — the depth argument (presets and freeform), excerpt citation rules, the
  freeze step, interlude guidance, the relaxed coverage expectation, and an up-front comparison of
  the skill's own stamped version against `revue --version` so drift is caught before narration
  rather than after validation rejects it.
- Loading a chapters file that fails on unknown keys explains itself in terms of `revue skill
  install` / `revue doctor` instead of surfacing a raw schema error. No version marker is added to
  the file.
- `CONTEXT.md` glossary — four new terms (context excerpt, interlude, narrative depth, coverage)
  and four amendments, since the current definitions of **Chapter**, **Thread**, and **Run**, and
  the recorded decision that show rejects missing review units, all become false.
- A new ADR for narrative depth, frozen excerpts, and excerpt anchors. It **extends** rather than
  supersedes ADR 0007 and ADR 0003, which both remain correct in substance and gain pointer lines.
  Extension is a new convention here; the only precedent is supersession (0002 over 0001).
- Golden snapshots and the vhs screenshot sweep.

## Risks

- **Coverage relaxation is a safety regression if mis-scoped.** Mitigated by keying strictness on
  declared depth and defaulting to `full`.
- **`chapters.json` is a `strictObject` with no version field.** A newer skill's output hard-fails
  on an older CLI with a raw zod error, and this work adds fields. Mitigated by the skill checking
  its own stamp up front and by a friendlier load error, not by a version marker.
- **Excerpt threads can orphan** on narration regeneration; they surface as orphaned (see phase 7).
- **`@revue/diff` row-kind change touches the shared plan type**, so the semantic view and every
  existing golden snapshot are in blast radius.
