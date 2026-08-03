# ADR 0004 — Store review threads by immutable run

- Status: accepted
- Date: 2026-08-02

## Context

Review threads are mutable feedback, while a prepared run is an immutable record of pinned code.
Review progress is narration-sensitive and therefore keyed by `runKey`, but a thread must survive
regeneration of `chapters.json` for the same frozen patch. A path and line range alone are also
insufficient because one path can contribute multiple hunks and chapters.

A conversation needs first-class authorship so human and agent messages are visibly distinct. The
terminal renderer must still own pointer geometry and inline row placement without adopting Revue's
thread lifecycle or message model.

## Decision

Revue stores threads in repository-local `.revue/threads.json`, outside prepared run directories. The
repository root is located by walking upwards from the supplied run directory, with the invoking
repository as a fallback for portable runs outside a checkout. The validated, atomically replaced file is keyed by the full immutable `runId`. Each mutation takes
an exclusive cross-process lock, reloads the latest file inside that lock, transforms the latest
same-run thread array, validates the complete store, and then renames the replacement into place.

A **Thread** is the official feedback aggregate. It records a UUID, creation time, reversible
open/dealt-with status, ordered messages, and an anchor containing
`(filePath, oldStart, side, startLine, endLine)`. Multiple independent threads may share an anchor.
Each message records its own UUID, creation time, terminal-safe body, and terminal-safe
`{ kind: "human" | "agent", name }` author. Human TUI authors resolve once at message creation from
the reviewed repository's `git config user.name`, falling back to the system login. Public agent
create/reply commands require an explicit author name.

All display, export, and agent-readable operations load a verified run and reject thread anchors that
do not belong to exactly one pinned review unit. Chapter association is derived from
`(filePath, oldStart)`, so narration can change without moving a thread to another hunk.

`@revue/diff-renderer` exposes feedback-neutral line-range selection and inline-attachment contracts.
The TUI owns thread/message IDs, authors, persistence, lifecycle controls, and presentation. Semantic
diff remains read-only and does not create or interpret anchors.

The project was still an early scaffold when Thread replaced the flat Comment model. Existing local
feedback was explicitly declared disposable, so `.revue/comments.json` was reset and no legacy
migration or dual-schema reader was introduced. `revue comments` remains only a command-name alias;
Thread is the model and `revue threads` is the official API.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Write threads inside the run directory | Rejected | Mutates the immutable review input and complicates integrity guarantees. |
| Key threads by narration-sensitive `runKey` | Rejected | Regenerating chapters would hide feedback for unchanged frozen code. |
| Anchor only by path and line range | Rejected | Cannot distinguish review units when one path has multiple hunks. |
| Keep flat comments and attach optional replies | Rejected | Makes Thread an incidental shape instead of the official lifecycle aggregate. |
| Migrate the disposable version-one comment store | Rejected | Preserves unused compatibility code and ambiguous historical authorship. |
| Store authored, runId-keyed threads with review-unit anchors | Chosen | Preserves immutable runs, supports human/agent conversations, and validates exact patch identity. |

## Consequences

- Thread identity is independent of its anchor, so duplicate same-range conversations remain valid.
- Open/dealt-with status applies to the thread; replies do not carry separate resolution state.
- Root messages are deleted with their thread. Replies may be deleted individually; editing is not
  supported.
- Hard deletion is permanent; dealt-with threads remain visible and reversible.
- Corrupt or stale local thread state blocks display, export, and agent listing rather than silently
  relocating feedback.
- Cross-process locking prevents concurrent TUI and agent mutations from replacing same-run feedback.
- A process that dies while holding the lock leaves an explicit abandoned lock error. Revue does not
  remove it automatically because deleting a newly acquired lock would risk data loss; the reported
  `.lock` file must be removed after confirming its recorded process is gone.
- Semantic anchors and an all-threads explorer require separate product decisions.
