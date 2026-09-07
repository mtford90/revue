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

**CLI "proposed" state — recommended, not built.** Keep the two stored statuses (ADR 0018). Add an
optional message-level `intent: "proposal"` written by `revue threads reply --propose`. Derived
state "awaiting go-ahead" = open thread whose last message is an agent proposal. TUI: Comments row
badge *needs your go-ahead*, sorted with awaiting-reviewer; `revue status` splits `awaitingHuman`
into `awaitingGoAhead` and `awaitingVerification`. The `Proposed:` convention holds until then.

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
orphaned, and a narrated predecessor of which no chapter carried ("every read mark starts over").

**Per-unit read state — design.**

- *Identity:* `(filePath, signature)` where signature is the hunk-body digest `delta.ts` already
  computes (`hunkUnit`); metadata units keep their manifest signature. Export `reviewUnits(run)` from
  `@revue/prep` so the TUI derives the same ids from the pinned patch.
- *Storage:* `.revue/state.json[runId].readUnits: string[]`, keyed by **run ID**, not run key —
  read marks are about code, not narration. Session state (page, scroll) stays on the run key.
- *Derived marks:* file read ⇔ all its units read; chapter read ⇔ all its units read. Interludes and
  the epilogue keep an explicit mark in `chapters` (the epilogue is always unread on open). Marking a
  chapter or file marks its units. Key-change ticks stay per chapter: they are narration.
- *Carry:* on open, seed from the nearest run on the `supersedes` chain (then the reload predecessor)
  that has marks, intersected by identity. No delta needed; survives re-narration, touched-up
  summaries, chapterless ↔ narrated, and reload. Replaces `carryReviewProgress`,
  `carrySupersededProgress`, and the chapterless seed with one rule.
- *Migration:* first open of a run whose old-format state exists under its run key converts file
  marks to that file's units, then writes the new shape.
- *UI:* hunk header gains a read tick and a `toggle-hunk-review` key; file and chapter ticks derive;
  progress reads "n/m units". `j`/`k` unchanged.

## 3. Expanded context was not selectable

**Cause.** `gitRangeResolver` (was in `app.tsx`) returned `null` for lines outside every git hunk, so
`selectableStops` in `@revue/diff-opentui` dropped them — the ADR 0007 decision.

**Landed** (ADR 0022). A `context` anchor `(filePath, startLine, endLine)`, new-side, resolved against
the run's pinned new blob. The resolver maps revealed rows (both sides) to a negative-sentinel
context range; a selection of only revealed rows becomes a context anchor; a mixed selection is
refused with a notice. Context threads render inline while their lines are shown, jumping to one
reveals them, and their chapter is the one narrating the nearest hunk. Validation orphans (never
fails) when the file is gone or the range is past EOF. Prep carries them by content through the two
blobs (same place → frame held → moved → orphaned). `revue threads create --kind context`.

## 4. Stale threads landed on unrelated code

**Cause.** `carriedRange` kept the reviewer's offset inside a *modified* unit; a hunk is large, so a
deletion left the hunk and the arithmetic in place and the thread moved onto whatever slid up.

**Decision: orphan explicitly, never draw inline — after following content.** Branch
`mtford-carewell/stale-thread-anchors-on-supersede` (`1e918ad`, ADR 0021) already did this and is
merged here: same lines at the shifted place → keep; framing lines held → in-place edit, keep;
same lines elsewhere in the file → move; otherwise `migrationOrphaned`, listed in Comments as
"· code removed", counted by `revue status`, no gutter presence. Sticky across later runs.

- Not option 1 (pin to the old run's snapshot in a "stale" epilogue section): the epilogue is agent
  prose, and drawing another run's rows needs a second render authority for one thread.
- Not option 2 (nearest surviving line with a marker): that is the guess ADR 0021 rejects — the
  reviewer cannot tell a guess from a hit by looking.
- Follow-up worth doing: pin the anchored lines' text onto the thread at orphan time
  (`orphanedLines`) so Comments and `threads list` show what the comment was about.

## Verification

`bun run typecheck`, `bun run lint`, `bun test` (all packages), `bun run check`. Not pushed.
