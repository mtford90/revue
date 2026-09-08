# Design notes — review feedback loop

Observed 2026-09-07 on the storefront review: runs `cf64` → `7e94` → `3c33` → (`8c3f`) → `35d4`,
threads `3749bb3c` and `9548e7f2`. Four problems; what was found, what landed, what is still a design.

## 1. The skill acted on feedback before confirming

**Cause.** `skills/revue/SKILL.md` Step 8, lane "Clear, and you agree": *Make the change, then reply.*

**Landed.** The lane now replies with a proposal (`Proposed:` prefix), the pass ends with a wait
(`revue status --wait --since <handoffId>`), and code moves only on the go-ahead — unless the comment
is itself an instruction ("rename this to X"), which is the go-ahead. Regeneration follows the
changes, never the proposal round. The chat report counts proposed / changed on instruction /
pushed back / needs your call.

**Message intent — landed.** The two stored thread statuses remain unchanged. Agent replies may
carry `intent: "proposal" | "completed"` through `revue threads reply --intent ...`; absent intent
retains the legacy awaiting-reviewer meaning. Inline cards and Comments share the labels *needs
approval*, *ready to verify*, *awaiting reviewer*, *awaiting agent*, and *dealt with*. Status reports
split the reviewer-facing aggregate into approval, verification, and legacy counters. Sending does
not approve anything; only the reviewer marks a thread dealt-with.

## 2. Regeneration lost every read mark

**Per step.**

- `7e94` — auto lineage picked `cf64` (narrated): 7 chapters carried, 3 stale. Threads moved
  `cf64 → 7e94`. Never narrated: the agent kept fixing.
- `3c33` — `resolveSupersedes` considered only narrated runs, so `cf64` again. Thread migration read
  only `supersedes`, so the threads stayed on `7e94`. ADR 0017 listed this as a known gap.
- `8c3f` (not in the report) — supersedes `3c33`, so `--carry-from 3c33`; HEAD `b475412` has `7e70`'s
  totals, i.e. a wrong checkout. It got a reload seed of 33 file marks (state key `b339…`). A detour.
- `35d4` — `--carry-from 7e94`: an unnarrated predecessor was accepted as is, `recordRunDelta` found
  no `chapters.json`, so 0 carried / 106 unnarrated. The agent re-narrated everything; 7 chapters
  came out byte-identical to `cf64`, but `supersededProgress` needs `delta.carried` and the run key
  is `sha(runId + chapters)`, so `cf64`'s marks (key `0ce1ab1a`) were unreachable.

**Landed.** `resolveLineage` (prep): `supersedes` is the narrated ancestor; feedback moves from every
pending run of the lineage, each remapped against the run it sat on; `--carry-from <pending>`
resolves to its narrated ancestor and says so. `prepareRun` returns warnings the CLI prints: open
threads left on runs this one does not continue (with the `--carry-from` to fix it), carried threads
orphaned, and a narrated predecessor of which no chapter carried (narration must be rewritten).

**Per-unit read state — active in the TUI.**

- `@revue/prep.reviewUnits(run)` exports the existing pinned-unit extraction. Run-local ids are
  JSON `[filePath, oldStart]`, not content-only ids that conflate duplicate hunks.
- `openCodeReviewStore` (`packages/tui/src/codeProgress.ts`) composes
  `.revue/state.json["code:" + runId] = { version: 1, hunks, continuedFrom? }` with narration-keyed
  question ticks, explicit no-hunk chapter marks and session position. Initialization is saved even
  when empty. Reword/reorder/regroup/flat↔narrated therefore share the code record.
- Chapter/file predicates accept the actual chapter and derive completion from its original units;
  a chapter-local file touches only that chapter's units. Bulk toggles leave questions alone. A
  hunk-bearing epilogue has no hidden narration veto; no-hunk narration remains explicit.
- Carry requires the same-path signature to occur once in each **complete** run unit set. Changed,
  new or ambiguous units stay unread; uniquely identical shifted units carry independently of the
  editorial delta matcher. Metadata units participate; excerpts/revealed context/diagrams do not.
- Current/flat legacy records migrate only with available narration. Saved empty destinations win;
  unknown historical narration hashes are never decoded or guessed. The newest initialized pending
  continuation, including empty/manual-unread state, beats an older explicit reload predecessor.
  Reload provenance and initialized marks persist for entirely flat reviews too.
- Initial open, ordinary reload and watched supersession all use that store with the actual
  previous run. The shell uses only hunk-derived code completion. `m`, per-original-hunk and
  metadata checkboxes, and View → Toggle hunk reviewed share an in-place transition. Existing
  `x`/`f` actions retain collapse/advance and reopening behaviour; `r` remains independent.
- Widened display hunks resolve back to the chapter's original pinned units. Current expansion
  deliberately keeps touching hunks separate. Scenery and cross-hunk selections cannot become an
  arbitrary hunk target. Pending discovery stops at a different narrated branch.

## 3. Expanded context was not selectable

**Cause.** `gitRangeResolver` (was in `app.tsx`) returned `null` for lines outside every git hunk, so
`selectableStops` in `@revue/diff-opentui` dropped them — the ADR 0007 decision.

**Landed** (ADR 0022). Historical `context` anchors remain new-side ranges resolved against the
run's pinned new blob. The resolver maps revealed rows to side-aware context segments. New
changed/revealed selections persist as one version-3 `selection` anchor whose patch/context segments
retain their actual sides. Context segments render inline while their lines are shown; jumping to one
reveals them, and their chapter is the one narrating the nearest hunk. Validation orphans (never
fails) when the file is gone or the range is past EOF. Prep carries them by exact, unique content through the two
blobs; changed or ambiguous code detaches, regardless of its frame. `revue threads create --kind context`.

## 4. Stale threads landed on unrelated code

**Cause.** `carriedRange` kept the reviewer's offset inside a *modified* unit; a hunk is large, so a
deletion left the hunk and the arithmetic in place and the thread moved onto whatever slid up.

**Landed in this slice.** Hunk, patch and context anchors require exact text with a unique
occurrence in both pinned files. No frame fallback, nearest-duplicate choice or delta-unit shortcut.
A changed or ambiguous range detaches the whole thread, permanently across subsequent prep runs.

Threads preserve `originalEvidence: { runId, anchor, lines }` at creation or first carry of
never-carried historical feedback. It retains every original range and its actual code, including
mixed old/new patch ranges. Already-carried legacy feedback without evidence stays unverified and
non-inline on load, with evidence unavailable; fitting coordinates are not proof of the subject. Comments shows selected detached
feedback's labelled original code; `threads list --json` includes the evidence and availability.

Excerpts remain unverified/non-inline until frozen destination coverage verifies the original code.
Missing narration alone is not sticky. A changed frozen source is detached at load and marked
permanently by the next prep before it can map onward; overlapping quotations count once.
Reads never write thread state. Original bytes stay raw in storage; terminal display sanitises them.
Original evidence introduced during the version-2 era remains optional for historical reads. New
writes are version 3 (segmented selections and reply intent); strict version-1 and version-2 stores
migrate without reinterpreting their anchors, while older binaries may reject version-3 writes.

## Verification

Regression red/green and verification logs are outside the repository (`/tmp/revue-*.log`).
State and component regressions cover persisted empty/manual-unread lineage, flat continuation,
partial files split across chapters, both surfaces, bulk actions, hunk ticks, metadata, widened
original-unit controls, independent questions and keymap/menu routing. Verification uses a temporary,
checkout-scoped Git include to exclude only the protected user transcript from release enumeration;
fixture repositories retain their own excludes. Legitimate generated route markers are refreshed.
Manual visual capture remains unperformed: sandbox socket creation is blocked, and no socket attempts
were made. Changes remain unstaged and uncommitted; independent review is still required.
