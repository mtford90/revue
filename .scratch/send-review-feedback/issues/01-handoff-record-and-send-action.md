# 01 — Handoff record and the Send action

Status: ready-for-agent

## Parent

.scratch/send-review-feedback/PRD.md

## What to build

The reviewer presses `S` on any surface, or picks "Send feedback to agent" from the File menu.
Revue collects the unsent threads (open, a human spoke last, that message newer than the last
handoff) and writes one handoff record to `.revue/handoff.json`: `handoffId` (UUID),
`requestedAt`, `runId`, `threadIds`, `delivery: queued`. The write is atomic and under the thread
store lock. A notice says "Queued for polling (N threads)", or "Nothing to send" when the unsent
set is empty. Nothing is delivered yet; this slice is the durable path only.

`revue status` gains `handoff`: the record plus `resolvedThreadIds`, the ids found on the current
active or pending run (threads move across supersession; the handoff does not). The human format
prints it. A malformed handoff file is reported as a warning in the JSON and treated as absent.

The work lives behind one feedback controller supplied to the TUI as a prop, so render tests use
a fake. The TUI keeps only key handling and the notice.

## Acceptance criteria

- [ ] `S` and the File menu item write a handoff with the unsent thread ids and `queued`
- [ ] Threads whose last message is from the agent, and threads sent by an earlier handoff, are excluded
- [ ] An empty unsent set writes nothing and shows "Nothing to send"
- [ ] A failed write shows an error notice and writes no partial file
- [ ] `S` works from the page and from the Comments surface; `s` still toggles the sidebar
- [ ] `revue status --json` reports `handoff` with `resolvedThreadIds`, and null when absent
- [ ] After a supersession, `resolvedThreadIds` names the migrated threads on the new run
- [ ] A malformed handoff file yields a warning, not a failing `revue status`
- [ ] Controller tests run against a scratch `.revue` directory; CLI process tests cover the status shape

## Blocked by

None (can start immediately).
