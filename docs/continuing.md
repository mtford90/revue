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

For this direct changed-code reload, Revue carries file progress only when the fixed file snapshots still match. It does not carry old key-change answers into stale narration.

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

The epilogue is always unread. It is the entry point for the next review pass.

## Carry review progress

A carried chapter describes unchanged code. Revue can carry its completed state into the superseding run.

This includes:

- chapter progress;
- file progress;
- answered key changes.

A stale chapter does not keep those marks. Its new narration can ask different questions about different code.

## Move threads to the new run

Prep moves open and resolved threads from the superseded run to the new run. It does not leave a second copy on the old run.

Revue remaps each anchor through the same unit matching that powers `revue delta`:

- unchanged code follows its new location;
- rewritten code keeps the comment offset when the new unit can hold it;
- deleted code becomes orphaned;
- excerpt anchors resolve against the new frozen context.

Orphaned threads remain visible in Comments. Revue never removes feedback because a new narration cannot place it.

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

Start a new review without inherited chapters, threads, or progress when that is intentional:

```bash
revue prep <scope> --no-carry
```

Do not use `--no-carry` as a repair for a continuation problem. It leaves the earlier review history behind.

## Related pages

- [Narrated reviews](narration.md)
- [Feedback and agent handoff](feedback.md)
- [Review code with Revue](guide.md)
