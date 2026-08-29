# 03 — `revue status --wait`

Status: done

## Parent

.scratch/send-review-feedback/PRD.md

## What to build

An agent blocks until the reviewer sends feedback: `revue status --wait [--since <handoffId>]
[--timeout-ms <n>]`. It returns the status report when a handoff whose id differs from `--since`
exists, at once when one already does, and exits with a distinct non-zero code on timeout
(default 15 minutes). The waiter is race-free: read, watch the `.revue` directory, read again,
then wait for events. It is separate from the TUI run watcher. `--since` without `--wait` is an
error.

The skill's orient section documents `--wait` for an agent told to wait for the next round.

## Acceptance criteria

- [x] `--wait` returns at once when a handoff newer than `--since` already exists
- [x] `--wait` returns when a new handoff lands after the wait started, with no missed write between the first read and the watch
- [x] Timeout exits non-zero with a distinct code and a clear message
- [x] `--since` without `--wait` is rejected
- [x] CLI process tests cover all of the above in a scratch repository

## Blocked by

- 01-handoff-record-and-send-action
