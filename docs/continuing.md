# Continue a review

A review can continue after the code changes. Revue creates a new fixed run, carries safe state forward, and records what needs new narration.

Return to the [documentation index](README.md) or read [Feedback and agent handoff](feedback.md).

## Check review status

Run this command from the reviewed repository:

```bash
revue status
```

Use JSON when an agent or script needs the result:

```bash
revue status --json
```

Status reads the repository files. It does not depend on an earlier terminal or agent session.

The report can contain:

- **activeRun**: the newest narrated run, its scope, and reusable prep arguments when available;
- **pendingRun**: a newer run that supersedes the active run but has no complete narration;
- **threads**: feedback that awaits the agent or reviewer, plus resolved and orphaned counts;
- **handoff**: the last batch that the reviewer sent;
- **drift**: whether a new prep would capture different code;
- **warnings**: damaged optional records that did not block the status report.

A repository without prepared runs reports that state and exits successfully.

## Understand drift

A run is a fixed snapshot. The working tree can change after prep.

Status reports drift when the same prep scope would now produce a different run. Drift does not modify the active review. It tells you that the review no longer represents all current code.

Prepare or reload the scope when you want a new snapshot.

## Reload from the TUI

Press `Ctrl-r` or `F5` to prepare the current scope again.

If the scope is unchanged, Revue reuses the same run. It keeps:

- narration;
- progress;
- threads;
- cursor position;
- open and folded content.

If the code changed, Revue creates a new run. A direct reload can open that run as a flat diff before the agent updates the narration. The status bar reports that the narration is stale.

For a changed-code reload, Revue carries uniquely identical hunks independently, even inside a
partly changed file or after line shifts. It does not carry old key-change answers into new narration.

### Reload a PR review

A PR run cannot recreate its scope from the recorded head label. Reload rereads the existing fixed run and does not fetch a newer PR head.

Prepare the PR again with its original number or URL. Include the recorded base when you set one explicitly:

```bash
revue prep --pr 123
revue prep --pr <pull-request-url> --base <base-ref>
```

Give the new run to the agent so it can continue the narration.

## Supersede a narrated run

Prep links a new run to the narrated run that it replaces. The new run supersedes the old run.

Prep classifies each review unit:

- **unchanged**: the code content remains the same, even if its line moved;
- **modified**: the new change rewrites the same earlier unit;
- **new**: no earlier unit matches it.

It also classifies chapters:

- **carried**: every unit in the chapter is unchanged;
- **stale**: at least one unit needs new narration;
- **unnarrated**: a unit in the new run is not covered by a carried chapter.

Run this command to see the recorded worklist:

```bash
revue delta <run-directory>
```

The command prints JSON. It does not compare the worktree again.

## Finish a pending narration

When `revue status` reports a pending run, the agent continues that run instead of preparing another one.

If the agent preps again instead, the new run still continues the last narrated run. Prep chains through the pending runs: the narrated run supplies the chapters, and the feedback that moved onto each pending run moves on again. `--carry-from` accepts a pending run and resolves the same way.

The agent follows this sequence:

1. read `revue status --json`;
2. select `pendingRun`;
3. read `revue delta <run-directory>`;
4. copy carried chapters without rewriting them;
5. rewrite stale chapters and cover all unnarrated units;
6. add one final epilogue;
7. freeze cited context;
8. validate with `revue show <run-directory> --check`.

The installed Revue skill contains the full authoring rules.

## Epilogue

A superseding narration ends with an epilogue named **Changes since your review**.

For a local fix, the epilogue presents the new or modified units and cites the threads that caused the change.

For a large structural change, it can instead tell the reviewer which chapters need another read. This form can contain no hunks.

The epilogue is the entry point for the next review pass. Its code completion comes from its
hunks; a no-hunk orientation note starts unread and is marked read explicitly.

## Carry review progress

Code ticks belong to the fixed run, not to chapter wording or grouping. Narrative and Diff share
one set of original-hunk marks, including metadata-only changes. A file or chapter derives its
completion from the units it covers; questions and no-hunk chapters remain narration-specific.

Across runs, a hunk carries only when its exact signature occurs once in each complete same-path
unit set. Changed, new or ambiguous hunks stay unread. Editorial chapter carry does not decide code
progress, and a changed neighbour does not erase an unchanged hunk's tick.

An already initialized destination, even one you cleared completely, keeps its own state. Within
the selected lineage, the newest initialized pending review takes precedence over older positives,
including manual unread marks. Direct flat reload continuity persists across reopening too.

Older chapter/file records migrate once using available current or flat narration. Revue does not
guess ownership from an unavailable historical narration.

## Move threads to the new run

Prep moves open and resolved threads from the superseded run to the new run. It does not leave a second copy on the old run.

Hunk, patch and revealed-context anchors follow exact code only when it occurs once in both
pinned files on the same side. A patch must map every range into the new patch or detach as a whole.
Changed code detaches even when its neighbours survived. Duplicate matches detach rather than
choosing the nearest occurrence. Detachment recorded by prep is sticky across later runs.

Threads preserve `originalEvidence`: the source run, original anchor and exact lines for every
range. Select a detached thread in Comments to read that code; `threads list --json` includes it
alongside the conversation. Historical stores still load. Evidence is captured on the first carry
only for never-carried historical threads; an already-carried thread without evidence is unverified
and non-inline even when its coordinates fit. It reports evidence unavailable rather than pretending
those coordinates are original.

Excerpt threads need frozen destination coverage and unchanged, unambiguous evidence before they
render inline. Missing narration is temporarily unverified, not proof of changed code: an identical
quotation can become visible after freezing, even when it moved outside the patch. Freeze remaps a
unique exact frozen destination and records changed or ambiguous evidence from either the previous
or replacement context as permanent detachment before replacing context. Restoring a quotation and
freezing the same run again cannot revive detached feedback. Prep and freeze use the same thread
lock and preserve concurrent replies. Reading a run never writes thread state. Overlapping
quotations of the same physical lines count as one occurrence.

Detached and unverified threads remain in Comments, never on replacement code. Revue never removes
feedback because a new narration cannot place it.

## Receive updates in an open TUI

The open TUI watches the repository for:

- thread changes;
- handoff changes;
- a complete narrated run that supersedes the current run.

Thread and handoff changes update in place.

A complete superseding run displays a persistent banner. Revue does not switch runs by itself. Press reload to follow the banner. Revue opens the new run on its epilogue and keeps carried progress.

Revue does not offer a half-written run. It waits until the run and narration load successfully.

## Wait for the next review pass

An agent can wait without polling:

```bash
revue status --wait --since <handoffId>
```

The command returns when a different handoff arrives. It prints the normal status report.

The default timeout is 15 minutes. Use `--timeout-ms <n>` to change it. A timeout exits with status 3.

## Start without carry

Prep normally selects the narrated predecessor for the same scope.

Use an explicit predecessor when automatic detection selects the wrong run:

```bash
revue prep <scope> --carry-from <run-id>
```

Prep prints a warning when a choice costs the reviewer something: open threads on a run this run does not continue, a carried thread that detached, or a narrated predecessor of which no chapter carried, which needs new narration. Code ticks are independent of that editorial result.

Start a new review without inherited chapters, threads, or progress when that is intentional:

```bash
revue prep <scope> --no-carry
```

Do not use `--no-carry` as a repair for a continuation problem. It leaves the earlier review history behind.

## Related pages

- [Narrated reviews](narration.md)
- [Feedback and agent handoff](feedback.md)
- [Review code with Revue](guide.md)
