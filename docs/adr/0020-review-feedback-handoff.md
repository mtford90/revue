# ADR 0020 — Review feedback handoff

- Status: accepted
- Date: 2026-08-29

## Context

The reviewer leaves threads in the TUI. Threads are the feedback itself
([ADR 0004](0004-store-threads-by-immutable-run.md)). Threads move across supersession
([ADR 0018](0018-feedback-conversation-across-supersession.md)), so their `runId` is not a stable
key across a review.

The reviewer had no way to tell the agent that new feedback existed. The reviewer had to switch to
the agent's terminal and type a message by hand. The agent had no way to wait for feedback. It had
to poll `revue status` in a loop.

Revue needed one action, **Send to agent**, that a reviewer presses once. The action needed a
record an agent could read cold, in a new session, days later. It needed a way to nudge a live
agent terminal, when one exists, without making that nudge load-bearing. It needed to find the
right terminal without asking the reviewer every time.

## Decision

### The handoff record

Send writes one file, `.revue/handoff.json`, next to the thread store rather than inside a run. A
run is immutable, and the file that answers "what got sent" changes with each Send. The file holds
`schemaVersion`, `handoffId`, `requestedAt`, `runId`, `threadIds`, and `delivery`. Each Send
overwrites the file whole. There is no handoff history: one record, replaced.

Writes take the thread store's lock and land atomically, so a Send and a thread mutation never
interleave and a failed write never leaves a half-written record.

### `handoffId` is the identity

A waiter compares `handoffId`, not `requestedAt`. Two Sends inside one millisecond, or a clock that
runs backwards, must not read as the same batch or the wrong batch. `requestedAt` is informational
only.

### `runId` means "requested against"

`runId` on the handoff is the run the batch was requested from, not a lookup key. Threads migrate
across supersession and the handoff record does not migrate with them. `revue status` resolves
`threadIds` against the run it is reporting on and returns the ones it can still find, as
`resolvedThreadIds`. A thread the reviewer deleted after sending is in `threadIds` and not in
`resolvedThreadIds`.

### Delivery is a nudge, the record is the source of truth

The handoff record is written, and only then does Revue try to deliver a wake-up prompt to a
terminal. Delivery can fail, or there can be no host to deliver to at all. Either way the record
already holds the feedback. An agent that never sees a prompt still finds the batch on its next
`revue status`. This is why the write happens first and delivery happens after: a failed record
write stops the Send outright, but a failed delivery only changes what `delivery` says, never
whether the batch is on disk.

`delivery` is one of `queued`, `delivered` (with the host, the terminal handle, and its title), or
`copied`. Every Send starts `queued`. A later successful delivery or clipboard copy rewrites the
same record in place, guarded so that a slow result for an old handoff can never overwrite a newer
one: the rewrite only applies when the file still holds the `handoffId` the result belongs to.

### The unsent rule is derived

A thread is unsent when it is open, its last message is from a human, and that message's
`createdAt` is later than the last handoff's `requestedAt` — or there is no handoff yet. Nothing is
written to a thread to mark it sent. The rule is computed fresh from the thread store and the
handoff record each time, so a deleted or edited handoff never leaves threads in an inconsistent
state.

### The agent origin follows the last agent, and only the agent records it

`revue prep` and `revue threads reply` each write `.revue/agent.json` after they succeed, naming
the Orca pane (`paneKey`, `worktreeId`) and the `runId` the command ran against. This is a
repo-level record beside the thread store, not part of `run.json`, because `prep` returns an
existing run early on a deduplicated call and the origin still has to follow whichever pane most
recently did agent work.

The record is written only by the top-level CLI commands, never by the prep library itself. The
TUI's own reload path calls the same library functions; if the library wrote the origin, opening
the TUI would overwrite the agent's pane with the reviewer's. A failed origin write is a warning on
stderr, never a command failure — orientation must not depend on it. Outside Orca neither command
writes anything.

`revue threads reply` moves the origin to the replying agent, on purpose: the last agent to work
the review is the one Send should wake. Two reviews in one repository are told apart by the `runId`
recorded alongside the pane.

### Target order

Send resolves a terminal to nudge in this order:

1. The session target the reviewer chose in the picker this TUI session, if the host still lists
   it.
2. The recorded agent origin, if the host still lists it.
3. The sole remaining terminal, if exactly one other terminal exists.
4. The picker, when more than one terminal remains and none of the above settled it.
5. The clipboard, when there is no host at all.

A session target the host no longer lists is forgotten rather than retried. A vanished session
choice falls through the same order as if it had never been made.

### The clipboard is the no-host path

When no host can deliver a prompt to a terminal — no host detected, or every delivery attempt
failed — Revue copies the wake-up prompt to the clipboard instead of showing an error. The reviewer
pastes it into the agent by hand. This keeps Send working in a plain terminal exactly as it works
under Orca; the record on disk is the same either way, and the clipboard is only a courtesy on top
of it.

## Consequences

- Delivery failure is never a Send failure. Every host call — listing terminals, sending a prompt,
  copying to the clipboard — degrades to `queued` rather than raising an error, because the record
  on disk already holds the feedback.
- `revue status --json` reports `handoff` with `resolvedThreadIds`, and `warnings` for a handoff or
  agent-origin record too damaged to read. Orientation continues either way.
- `revue status --wait` blocks for the next handoff instead of polling, resolving on any
  `handoffId` different from the one it was told to wait past, and gives up with a distinct exit
  code on timeout.
- The thread store schema is unchanged. Send adds a sibling record; it does not touch
  `threads.json` ([ADR 0004](0004-store-threads-by-immutable-run.md)).
- A second Send before the first is answered overwrites the record with the full unsent set at that
  moment. Nothing already sent is lost, because the new record still names every thread the agent
  has not yet been told about.
- A second host can implement the same `detectHost` / `listTerminals` / `sendToTerminal` interface
  without changing the handoff record, the unsent rule, or the target order above.
