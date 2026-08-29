# ADR 0004 — Store review threads by immutable run

- Status: accepted
- Date: 2026-08-02

## Context

A review thread is mutable feedback. A prepared run is an immutable record of pinned code. The
review progress is sensitive to the narration, thus its key is `runKey`. But a thread must survive
when the agent writes `chapters.json` again for the same frozen patch. A path and a line range alone
are not enough, because one path can give more than one hunk and more than one chapter.

A conversation needs an author on each message. Then a reader sees the difference between a human
message and an agent message. The terminal renderer must still own the pointer geometry and the
placement of the inline rows. It must not take the thread lifecycle or the message model of Revue.

## Decision

Revue stores the threads in `.revue/threads.json` in the repository. That file is outside the
prepared run directories. To find the repository root, Revue goes up from the run directory that you
supply. For a portable run outside a checkout, Revue uses the repository that calls the command.
Revue validates the file and replaces it atomically. The key of the file is the full immutable
`runId`.

Each mutation does these steps:

1. It takes an exclusive lock across processes.
2. It loads the latest file again inside that lock.
3. It transforms the latest thread array of the same run.
4. It validates the complete store.
5. It renames the replacement into place.

A **Thread** is the official aggregate for feedback. It records:

- a UUID;
- the creation time;
- an open status or a dealt-with status, which you can reverse;
- the messages, in order;
- an anchor that contains `(filePath, oldStart, side, startLine, endLine)`.

More than one independent thread can use the same anchor. Each message records its own UUID, its
creation time, a body that is safe for the terminal, and an author
`{ kind: "human" | "agent", name }` that is also safe for the terminal. For a human author in the
TUI, Revue resolves the name one time, when the message is created. It reads `git config user.name`
from the reviewed repository, and it falls back to the system login. The public agent commands that
create a thread or reply to one need an explicit author name.

Every operation for display, export, and agent reading loads a verified run. Each operation refuses
a thread anchor that does not belong to exactly one pinned review unit. Revue derives the chapter of
a thread from `(filePath, oldStart)`. Thus the narration can change, and the thread stays on its
hunk.

`@revue/diff-renderer` gives contracts for the selection of a line range and for inline attachment.
These contracts are neutral about feedback. The TUI owns the thread IDs and the message IDs, the
authors, the persistence, the lifecycle controls, and the presentation. The semantic diff stays
read-only. It does not create an anchor, and it does not interpret one.

Thread replaced the flat Comment model while the project was still an early scaffold. We declared
the local feedback of that time disposable. Thus we reset `.revue/comments.json`. We added no
migration for the legacy data and no reader for two schemas. `revue comments` stays only an alias
for the command name. Thread is the model, and `revue threads` is the official API.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Write threads inside the run directory | Rejected | It changes the immutable review input and makes the integrity guarantees difficult. |
| Key threads by narration-sensitive `runKey` | Rejected | New chapters would then hide the feedback on frozen code that did not change. |
| Anchor only by path and line range | Rejected | It cannot tell review units apart when one path has more than one hunk. |
| Keep flat comments and attach optional replies | Rejected | Thread becomes an incidental shape and not the official aggregate for the lifecycle. |
| Migrate the disposable version-one comment store | Rejected | It keeps compatibility code that nobody uses, and historical authorship that is not clear. |
| Store authored, runId-keyed threads with review-unit anchors | Chosen | It keeps the runs immutable, supports conversations between humans and agents, and validates the exact identity of the patch. |

## Consequences

- The identity of a thread is independent of its anchor. Thus two conversations on the same range
  are both valid.
- The open status and the dealt-with status apply to the thread. A reply carries no separate
  resolution state.
- Revue deletes a root message with its thread. You can delete a reply on its own. You cannot edit a
  message.
- A hard deletion is permanent. A dealt-with thread stays visible, and you can make it open again.
- Corrupt or stale local thread state stops the display, the export, and the agent list. Revue does
  not move the feedback to another place without a message.
- The lock across processes stops a mutation from the TUI and a mutation from an agent at the same
  time. Thus one of them cannot replace the feedback of the same run.
- If a process stops while it holds the lock, Revue gives an explicit error about an abandoned lock.
  Revue does not remove the lock automatically, because it could remove a lock that another process
  just took, and then data could be lost. First make sure that the recorded process of the lock
  stopped. Then remove the reported `.lock` file.
- Semantic anchors and an explorer for all threads need their own product decisions.

## Amendments

- 2026-08-05 — The authority of an anchor is now formally the same in every view. An anchor always
  resolves against the original git hunks, whatever view created it. Revue refuses a comment on a
  line that exists only in a synthesised patch
  ([ADR 0007](0007-synthesised-patches-and-anchor-authority.md)). The check for exactly one chapter
  owner applies only when narration exists ([ADR 0006](0006-chapterless-runs.md)).

  Revue offers a GitHub permalink from an anchor for one side only when the `RunScope` endpoint of
  that side is `kind: "commit"`. An index-tree endpoint and a worktree endpoint are not pinned. Thus
  Revue disables their copy-link action and gives the reason. Revue does not emit a link that could
  resolve to different content.

  Known gap: the threads CLI writes messages only with the author kind `agent`. Human authorship
  exists only through the TUI.
- 2026-08-07 — [ADR 0014](0014-narrative-depth-and-frozen-context.md) extends this ADR. It does not
  supersede it. There are now two kinds of anchor. The tuple above describes the `hunk` anchor. A
  thread on quoted code that the narration cites takes an `excerpt` anchor of
  `(filePath, startLine, endLine)`, which resolves against the frozen context of the run. An excerpt
  anchor carries no `oldStart` and no `side`, on purpose, because `oldStart: 0` is already the
  sentinel of the metadata review unit.

  If the frozen context no longer covers an excerpt anchor, Revue shows that anchor as orphaned and
  the load continues. A hunk anchor that does not resolve is still fatal.
- 2026-08-18 — [ADR 0018](0018-feedback-conversation-across-supersession.md) adds one exception to
  the fatal-anchor rule above. Prep moves threads to the run that supersedes their own, and it
  records the old run id in `migratedFrom`. A migrated hunk anchor that does not resolve becomes
  orphaned, not fatal, because supersession deletes code as a normal action. A hunk anchor without
  `migratedFrom` that does not resolve remains fatal.
- 2026-08-19 — [ADR 0019](0019-agent-directed-review-granularity.md) removes Markdown export, so
  "display, export, and agent reading" above names only display and agent reading now.
- 2026-08-29 — [ADR 0020](0020-review-feedback-handoff.md) adds the handoff record beside
  `.revue/threads.json`, next to the thread store this ADR defines but outside it, and does not
  change the thread schema.

## Amendment

ADR 0013 replaces the active package boundary with `@revue/diff` and `@revue/diff-opentui`. The names above are historical. They describe the implementation at the time of this decision.
