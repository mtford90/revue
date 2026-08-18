# 05 — Epilogue chapter and progress carry

Status: done

## Parent

.scratch/interactive-review-loop/PRD.md

## What to build

A superseding run's chapters always end with an epilogue — "Changes since your review" — the reviewer's designated re-entry point. For localized fixes it narrates the fix hunks, each linked to the thread that prompted it; after a structural rework it shrinks to an orientation note naming the rewritten chapters to re-read. The TUI renders thread links in the epilogue as navigable references. Read-progress marks on carried-forward chapters survive supersession via the existing run-key progress mechanics, so only stale, rewritten, and epilogue chapters present as unread. Validation (`revue show --check`) verifies the epilogue's references the way it verifies any chapter's.

## Acceptance criteria

- [x] A superseding run whose epilogue references fix hunks and threads passes `--check`; dangling thread references fail it
- [x] Carried-forward chapters retain their read marks after supersession; stale and epilogue chapters do not
- [x] The epilogue renders in the Story surface with working links to its threads and hunks
- [x] TUI render tests cover progress carry and epilogue rendering

## Blocked by

- 02-delta-and-chapter-carry-forward
- 03-thread-migration-across-supersession
