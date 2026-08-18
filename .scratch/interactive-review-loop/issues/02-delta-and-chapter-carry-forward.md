# 02 — Delta classification and chapter carry-forward

Status: done

## Parent

.scratch/interactive-review-loop/PRD.md

## What to build

When a run supersedes a narrated predecessor, the CLI computes a delta: every hunk of the new run is classified as unchanged, modified, or new relative to the predecessor. Chapters whose covered hunks are all unchanged are pre-copied into the new run with their hunk references re-mapped to the new run's review units; chapters with any changed hunk are marked stale. Frozen context for carried-forward excerpts is re-resolved against the new run automatically. The delta is surfaced to the agent as a worklist: stale chapters, unnarrated (new/modified) hunks, and the carried chapters it need not touch.

## Acceptance criteria

- [x] After a localized fix, untouched chapters appear verbatim in the superseding run with valid re-mapped hunk references
- [x] Chapters covering changed hunks are reported stale and not carried
- [x] New and modified hunks are listed as unnarrated work with their review-unit identities
- [x] Carried excerpt citations resolve against re-frozen context with the pinned bytes intact
- [x] `revue show --check` passes on a run consisting of carried chapters plus the reported worklist once narrated
- [x] Prep-library integration tests against a scratch git repository cover classification, carry-forward, staleness, and re-freeze

## Blocked by

- 01-recorded-lineage-on-prep
