# 05 — Orca delivery to the agent terminal

Status: done

## Parent

.scratch/send-review-feedback/PRD.md

## What to build

Under Orca, Send also nudges the agent. A host module detects Orca, lists the worktree's
terminals through the Orca CLI (`ORCA_CLI_COMMAND` when set, otherwise `orca`; no shell; short
timeout), removes the TUI's own pane, sanitises titles, and sends text plus Enter to one terminal.

The controller resolves the target: the recorded origin when it is in the list, with a matching
`runId` preferred; otherwise the sole remaining terminal. It sends the one-line wake-up prompt,
then rewrites the record as `delivered` with host, handle, and title — under the lock, and only
when the file still holds the same `handoffId`. The notice reads "Delivered to <title> (N
threads)". A list failure, a send failure, or more than one candidate with no origin leaves the
record `queued` with the queued notice; the picker comes in the next slice.

## Acceptance criteria

- [x] With a fake `orca` via `ORCA_CLI_COMMAND`, Send delivers to the origin terminal and the record reads `delivered`
- [x] The TUI's own pane is never a candidate
- [x] A `runId` match on the origin wins over a mismatch; the sole other terminal is used when there is no origin
- [x] A list or send failure leaves `queued`; no error dialog
- [x] A newer handoff written mid-flight is not overwritten by the older result
- [x] Terminal titles with control characters are sanitised before display and storage
- [x] Host module tests use the fake CLI; controller tests cover the resolution order and guarded finalisation

## Blocked by

- 01-handoff-record-and-send-action
- 04-agent-origin-recorded-by-prep-and-reply
