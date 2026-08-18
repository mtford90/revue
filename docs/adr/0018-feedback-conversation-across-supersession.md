# ADR 0018 — The feedback conversation across supersession

- Status: accepted
- Date: 2026-08-18

## Context

Threads are keyed by `runId` ([ADR 0004](0004-store-threads-by-immutable-run.md)). Run supersession ([ADR 0017](0017-run-supersession-and-the-delta.md)) makes a new `runId` for each code change. Without migration, each re-prep strands the open threads on the old run. Those threads hold the feedback the agent answered.

The workflow is also a protocol between two parties. The reviewer writes feedback in the TUI. The agent answers it. The protocol must say who resolves a thread, and what an unresolved anchor means after code changes.

## Decision

### Threads move to the superseding run

Prep migrates threads when it records lineage. Each thread of the predecessor moves to the new run:

- The thread keeps its id, status, messages, and creation time. Prep rewrites `runId` and removes the thread from the predecessor's key.
- Open threads and dealt-with threads both move. History stays readable from the active run.
- Threads move; prep does not copy them. A copy would split one conversation across two runs, and replies would diverge.
- Migration is idempotent. A re-prep that deduplicates to the same run does not change `threads.json`.
- A migrated thread records the old run id in `migratedFrom`.

### Anchor re-mapping and the orphan exception

Prep re-maps a migrated hunk anchor with the delta's unit match. An unchanged or modified unit gives the anchor its new `oldStart` and line range.

A hunk anchor whose unit no longer exists becomes **orphaned**: listed, marked, never removed, and never fatal. This is an exception to the rule of ADR 0004, which treats an unresolvable hunk anchor as corruption. The exception applies only to threads with `migratedFrom`. Supersession deletes code as a normal action, so a dead anchor on a migrated thread is not corruption. Excerpt anchors keep their existing orphan behaviour.

### The reviewer closes threads

The agent replies to threads. The agent never marks a thread dealt-with. This applies to fix threads and to answered questions equally.

- `revue threads mark-dealt` and `revue threads reopen` belong to the reviewer.
- "Awaiting verification" is a derived state: a thread that is open, with an agent as the last author. It is not a stored status. The Comments surface sorts these threads first.
- A third stored status was rejected. The two-status schema stands.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Leave threads on the old run | Rejected | Each re-prep hides the feedback the agent answered. |
| Copy threads to the new run | Rejected | One conversation in two places; replies and statuses diverge. |
| Fatal load on a dead migrated hunk anchor | Rejected | Supersession deletes code as a normal action; that is not corruption. |
| Prune threads with dead anchors | Rejected | Feedback must never disappear without the reviewer's action. |
| The agent marks threads dealt-with | Rejected | "Dealt-with" then means "the agent claims so", and unverified fixes look verified. |
| A third stored status, "addressed" | Rejected | The open-plus-agent-last state already shows it; a schema change buys nothing. |
| Move threads, orphan dead anchors, reviewer closes | Chosen | One conversation, one home; "dealt-with" means "reviewer accepted". |

## Consequences

- `revue threads list <newRun>` shows the whole conversation after each supersession.
- The TUI marks orphaned migrated threads the same way as excerpt orphans.
- `revue status` splits open threads into awaiting-agent and awaiting-human by the last author.
- The revue skill instructs the agent: reply always, close never.
- `threads.json` does not grow with each supersession, because threads move.
- Thread mutation is legitimate: runs are immutable, `threads.json` is the mutable overlay ([ADR 0004](0004-store-threads-by-immutable-run.md)).
