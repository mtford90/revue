# ADR 0017 — Run supersession and the delta

- Status: accepted
- Date: 2026-08-18

## Context

A review is iterative. The agent changes code in answer to feedback. Each change makes a new run with a new `runId`. Before this decision, the new run started empty. The agent wrote all narration again, and the reviewer lost all progress.

Runs are immutable ([ADR 0004](0004-store-threads-by-immutable-run.md)). A mechanism that continues a review must not mutate an old run. It also must not change the identity of an unchanged run.

## Decision

### Lineage

`revue prep` records lineage when it creates a run. It finds the most recent narrated run with the same scope form. It writes that run's id in the new manifest as `supersedes`.

- The scope form is the shape of the prep arguments, not the resolved SHAs. A review of the same branch after new commits is the same review.
- A run is narrated when `chapters.json` exists in its directory.
- The `supersedes` field lives on the manifest, outside the run-id hash. Old runs load without it, and deduplication does not change.
- Prep writes the field one time, at creation. No process mutates it after that.
- `--carry-from <runId>` selects the predecessor. `--no-carry` prevents lineage.

### The delta

When a run supersedes a narrated predecessor, prep computes a delta and writes it to `delta.json` in the run directory. The delta puts each review unit of the new run in one class:

- `unchanged` — a unit with the same content signature as a predecessor unit
- `modified` — a unit that overlaps a predecessor unit but has different content
- `new` — a unit with no predecessor match

The content signature excludes line numbers. A rebase that moves every line does not change a unit's class.

A predecessor chapter is **carried** when each unit it narrates is unchanged. The delta re-maps the chapter's `hunkRefs` and `lineRefs` to the new positions. The map is exact because an unchanged unit holds the same lines. A chapter with a changed or removed unit is **stale**. Prep freezes the carried excerpts again, against the new run. A carried chapter with moved excerpt bytes becomes stale, because the citation is the only proof of what the reviewer sees.

Carried chapters land in `delta.json`, not in `chapters.json`:

- A partial `chapters.json` fails coverage validation in `revue show`, `revue export`, and `revue threads`.
- Lineage detection reads "`chapters.json` exists" as "narrated". A partial file would mark an un-narrated run as narrated.
- `chapters.json` stays the agent's artifact. The agent copies carried chapters into it during narration.

`revue delta <run-directory>` prints the worklist: carried chapters, stale chapters with reasons, and units without narration.

### The epilogue

The narration of a run that supersedes a narrated predecessor must end with one epilogue chapter. The epilogue is the reviewer's re-entry point. It says what changed after the review and why.

- The epilogue is an ordinary chapter with `role: "epilogue"`. An optional `threadRefs` list cites the threads that caused the changes.
- `revue show --check` fails a superseding narration with no epilogue, with two epilogues, with an epilogue not in the last position, or with a `threadRefs` id the run does not hold.

### Schema fields and the run key

The run key hashes the parsed chapters. Reviewer progress is keyed by the run key. Therefore new chapter fields must be `.optional()`, never `.default()`. A defaulted field changes the parse of every old file, changes every run key, and resets all progress on upgrade.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Re-narrate every superseding run from zero | Rejected | Loses all narration and progress after each small fix. |
| The agent compares two `hunks.txt` files itself | Rejected | Burns context, and anchor re-mapping by eye causes errors. |
| Match units by `oldStart` position | Rejected | A rebase moves every position; content survives, position does not. |
| Write carried chapters into a partial `chapters.json` | Rejected | Fails coverage validation and poisons lineage detection. |
| Mutable runs that absorb new commits | Rejected | Breaks the immutable-run model of ADR 0004. |
| Recorded lineage, a CLI delta, carried chapters in `delta.json`, one final epilogue | Chosen | Deterministic work stays in the CLI; the agent does editorial work only. |

## Consequences

- The agent's work after a fix is short: copy carried chapters, rewrite stale chapters, narrate new units, write the epilogue.
- Reviewer progress survives on carried chapters ([the run key still changes; a seed carries the marks](#schema-fields-and-the-run-key)).
- `revue diff` and bare `revue` also prep. They pay a predecessor load when lineage resolves. Watch this cost on large runs.
- A prep with no narration afterwards leaves a pending run. The next prep supersedes the last narrated run, not the pending one. Threads on the pending run strand there. This is a known gap.
- A renamed file yields new units and stale chapters. The delta matches files by path only.
- Superseded runs accumulate in `.revue/runs/`. Garbage collection is a separate product decision.

## Amendments

- 2026-08-19 — [ADR 0019](0019-agent-directed-review-granularity.md) removes `revue export`, so the
  coverage validation named above now runs only in `revue show` and `revue threads`.
