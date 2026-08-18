# 03 — Thread migration across supersession

Status: done

## Parent

.scratch/interactive-review-loop/PRD.md

## What to build

When prep creates a run that supersedes another, open threads on the predecessor are migrated onto the new run: their anchors are re-resolved against the new run's review units and frozen context. A hunk anchor that no longer resolves — because supersession legitimately deleted the code — falls back to the existing orphaned-but-listed behaviour instead of being treated as corruption or pruned. Dealt-with threads migrate too so history stays queryable from the active run. Thread identity and message history are preserved; the store's cross-process locking discipline is respected.

## Acceptance criteria

- [x] Open threads on a superseded run are listed by `revue threads list` against the superseding run
- [x] A thread anchored to an unchanged hunk resolves to the same code in the new run
- [x] A thread whose anchored code was deleted is surfaced as orphaned, never pruned, and does not block loading
- [x] Thread ids, statuses, and full message history survive migration
- [x] Prep-library integration tests against a scratch git repository cover resolved, shifted, and orphaned anchors

## Blocked by

- 01-recorded-lineage-on-prep
