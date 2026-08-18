# 06 — TUI watching: silent thread refresh and supersede banner

Status: done

## Parent

.scratch/interactive-review-loop/PRD.md

## What to build

The running TUI notices changes without being asked. A small debounced filesystem-watch module emits two events: threads-changed (the thread store was written — by an agent or a second terminal) and run-superseded (a run naming the current one appeared). Thread changes apply silently in place: badges, threads, and the Comments surface update with no layout shift and no loss of the reviewer's position; threads awaiting human verification (open, last message from an agent) sort first in the Comments surface. A superseding run raises a persistent, prominent banner summarising the update; the existing reload key switches to it and lands on the epilogue. Never auto-switch. TUI tests inject watcher events; the watch module itself is tested directly against a temporary directory, because filesystem-watch timing inside full render tests is flaky.

## Acceptance criteria

- [x] An agent reply appears in the open TUI without any keypress, preserving scroll position and focus
- [x] Awaiting-verification threads sort first in the Comments surface
- [x] A superseding run raises a banner and does not switch runs; reload lands on the epilogue
- [x] The watch module emits both events, debounced, in direct tests against a temporary directory
- [x] TUI render tests drive both behaviours by injecting events

## Blocked by

- 05-epilogue-and-progress-carry
