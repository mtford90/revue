# 01 — Recorded lineage on prep

Status: done

## Parent

.scratch/interactive-review-loop/PRD.md

## What to build

When `revue prep` creates a run, it detects the most recent narrated run whose prep arguments match and records a `supersedes` reference to it in the new run's metadata at creation time. A `--carry-from <runId>` flag forces a specific predecessor; `--no-carry` suppresses lineage for a deliberately fresh review of the same scope. Runs remain immutable: `supersedes` is written once at creation and never mutated, consistent with the immutable-runs ADR. Re-prepping an unchanged scope still dedupes to the identical run and records no self-lineage.

## Acceptance criteria

- [x] Re-prepping the same scope after new commits produces a run whose metadata names the previous narrated run in `supersedes`
- [x] A predecessor with no narration is not auto-selected as a supersede target
- [x] `--carry-from` overrides auto-detection; `--no-carry` produces a run with no lineage
- [x] An unchanged scope dedupes to the existing run unchanged
- [x] Prep-library integration tests against a scratch git repository cover all of the above

## Blocked by

None - can start immediately
