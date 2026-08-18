# ADR 0006 — Runs are reviewable without chapters

- Status: accepted
- Date: 2026-08-05
- Amends: [ADR 0003](0003-prep-owns-review-scope.md), [ADR 0004](0004-store-threads-by-immutable-run.md)

## Context

ADR 0003 assumed that an agent writes `chapters.json` for every run before `show`. Thus an agent was
a hard prerequisite. Without narration there was no way to review at all, although prep already
pinned everything that a flat diff review needs.

Revue also needed to serve the case where the reviewer wants only to see the diff (bare `revue`,
`revue diff [refs]`). Tools such as Hunk cover that case. Revue must serve it and stay one product.

## Decision

`ReviewRun.chapters` is nullable. A run directory without `chapters.json` opens as a flat diff, file
by file, with a Files surface. Narration is an optional overlay. It is not a necessary part.

There is no second data path. Internally, a chapterless run is one synthetic chapter that covers
every file and every hunk. The "All files" surface inside a narrated run is the same synthetic
chapter. Thus these features work in the same way in both modes:

- the threads;
- the semantic view;
- the selection;
- the copy;
- the context expansion;
- the reviewed state of each file.

Bare `revue` and `revue diff [refs]` prep and open in one step, through the same immutable-run
pipeline. A bare patch with no blobs stays out of scope until it gets its own design.

The key for the progress has two forms. With narration, `runKey = sha256(runId + chapters)`, as
before. Without narration, the key is a hash of `runId` plus a chapterless sentinel. Thus the
progress of a flat review keys on the snapshot alone. When an agent narrates a run later, Revue
seeds the fresh view state from any chapterless progress for the same `runId`. This migration from
flat review into narrated review goes one way only.

The thread validation keeps the invariant that an anchor is inside one review unit. But it skips the
check for exactly one chapter owner when the chapters are absent. The Markdown export refuses a
chapterless run, because it formats a narrative and there is no narrative.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Require narration before any review (status quo) | Rejected | An agent then becomes a prerequisite to look at a diff. |
| A separate lightweight diff mode bypassing prep | Rejected | It loses the pinned blobs, the thread anchors, and the guarantee of one input path from ADR 0003. |
| A parallel "flat" representation beside chapters | Rejected | Two data paths through every feature. The synthetic chapter gets each feature with no more work. |
| Discard progress when narration arrives | Rejected | It punishes a reviewer who starts early. The snapshot is identical; only the view changed. |
| Nullable chapters + synthetic all-files chapter | Chosen | One model, one pipeline, and narration as an overlay. |

## Consequences

- Every future feature must work in both modes. It does so by construction, because both modes are
  chapters.
- The chapterless sentinel key means that one snapshot has a maximum of two progress records: one
  for the flat review, and one for each narration.
- The seed migration goes one way only. A narrated review does not update the chapterless progress.
- The run layout of ADR 0003 now reads `chapters.json` as optional. The chapter-ownership check of
  ADR 0004 applies only when narration exists.
