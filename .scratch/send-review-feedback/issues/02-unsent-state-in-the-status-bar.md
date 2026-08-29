# 02 — Unsent state in the status bar

Status: ready-for-agent

## Parent

.scratch/send-review-feedback/PRD.md

## What to build

The thread-count slot in the status bar becomes one state-driven slot; nothing is added beside
it. States: `3 threads` (nothing unsent, no handoff); `3 threads · 2 unsent`; `3 threads · sent ✓`
(delivered) or `3 threads · sent · queued`. Narrow width keeps only the state half; tiny width
drops the slot as today. The slot reads the handoff through the run watcher, extended with the
handoff path, so it reflects the file and not memory.

While unsent > 0 the footer hints show `S send`. After the reviewer posts a comment, the notice
reads "Comment added — S sends it to the agent". While a Send is in flight, further presses show
"Sending…" and do nothing.

## Acceptance criteria

- [ ] The slot shows each state at wide and narrow widths, and disappears at tiny width
- [ ] The slot updates when the handoff file changes on disk without a reload
- [ ] The `S send` hint appears only while something is unsent
- [ ] Posting a comment shows the composer notice
- [ ] A second press during an in-flight Send shows "Sending…" and writes no second record
- [ ] Render tests inject a fake controller and watcher events

## Blocked by

- 01-handoff-record-and-send-action
