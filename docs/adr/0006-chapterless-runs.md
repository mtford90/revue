# ADR 0006 — Runs are reviewable without chapters

- Status: accepted
- Date: 2026-08-05
- Amends: [ADR 0003](0003-prep-owns-review-scope.md), [ADR 0004](0004-store-threads-by-immutable-run.md)

## Context

ADR 0003 assumed every run gains an agent-written `chapters.json` before `show`. That made an agent
a hard prerequisite: without narration there was no way to review at all, even though prep had
already pinned everything a flat diff review needs. Revue also wanted to serve the "just show me
this diff" case (bare `revue`, `revue diff [refs]`) that tools like Hunk cover, without becoming a
second product.

## Decision

`ReviewRun.chapters` is nullable. A run directory without `chapters.json` opens as a flat,
file-by-file diff with a Files surface; narration is an optional overlay, not required scaffolding.

There is no second data path. Internally a chapterless run (and the "All files" surface inside a
narrated run) is one synthetic chapter covering every file and hunk, so threads, semantic view,
selection, copy, context expansion, and per-file reviewed state work identically in both modes.
Bare `revue` and `revue diff [refs]` prep and open in one step, through the same immutable-run
pipeline — a bare patch with no blobs remains out of scope until it gets its own design.

Progress keying: with narration, `runKey = sha256(runId + chapters)` as before; without, the key
hashes `runId` plus a chapterless sentinel, so flat-review progress keys on the snapshot alone.
When a run is later narrated, its fresh view state is seeded from any chapterless progress for the
same `runId` — a one-way migration from flat review into narrated review.

Thread validation keeps the anchor-inside-one-review-unit invariant but skips the exactly-one-
chapter-owner check when chapters are absent. Markdown export refuses a chapterless run — it
formats a narrative, and there is none.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Require narration before any review (status quo) | Rejected | Makes an agent a prerequisite for looking at a diff. |
| A separate lightweight diff mode bypassing prep | Rejected | Loses pinned blobs, thread anchoring, and the single-input-path guarantee of ADR 0003. |
| A parallel "flat" representation beside chapters | Rejected | Two data paths through every feature; the synthetic chapter gets each feature for free. |
| Discard progress when narration arrives | Rejected | Punishes reviewing early; the snapshot is identical, only the lens changed. |
| Nullable chapters + synthetic all-files chapter | Chosen | One model, one pipeline, narration as overlay. |

## Consequences

- Every future feature must work in both modes by construction, because both modes are chapters.
- The chapterless sentinel key means the same snapshot has at most two progress records: one flat,
  one per narration.
- The seeding migration is one-way; chapterless progress is not updated by narrated review.
- ADR 0003's run layout now reads `chapters.json` as optional; ADR 0004's chapter-ownership check
  is conditional on narration existing.
