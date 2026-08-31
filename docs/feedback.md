# Feedback and agent handoff

Revue stores review feedback as threads on the fixed code snapshot. A reviewer can send those threads to an agent and read the reply without leaving the TUI.

Return to the [documentation index](README.md) or [start a review](guide.md).

## Create a thread

Move the review line cursor to a changed line and press `Enter`. You can also click a line-number gutter.

Press `v` to select a range before you open the composer. A selection:

- stays inside one file;
- can include old and new lines;
- can cross multiple hunks;
- uses real source line numbers.

Press `Ctrl+Enter` to save the comment. Press `Escape` to cancel it.

You can create more than one thread on the same code range.

## Reply and change status

A thread contains ordered messages from humans and agents. Each message records its author and creation time.

Thread cards are review cursor stops. When a thread is focused:

- press `R` to reply;
- press `X` to resolve it;
- press `X` again to reopen it;
- press `D` twice to delete the complete thread;
- press `A` to send only that thread to the agent.

Deleting a complete thread uses a two-press confirmation in the status bar. Press `Escape` after the first `D` to cancel the deletion.

The pointer controls can delete one reply. Revue uses a modal confirmation for that action. Deleting the root message deletes the complete thread.

Use resolved status for feedback that no longer needs action. Revue keeps resolved threads visible and includes them in the review history.

## Use the Comments surface

Press `o` to open Comments. This surface lists every thread in the review.

Threads that await the reviewer appear first. These threads have an agent reply as their last message. Open threads that await the agent have a human message last.

Use `j` and `k` to select a thread. Press `Enter` to jump to its code. Orphaned threads stay in the list when their code or excerpt no longer exists in the current run.

## Understand unsent feedback

A thread is unsent when all these conditions are true:

- the thread is open;
- a human wrote the last message;
- the last handoff does not include that message state.

A new human reply makes the thread unsent again, even if an earlier handoff included the thread.

The status bar shows open and unsent feedback. Its Send control uses the same action as the `S` key.

## Send feedback

Press `S` to send all unsent threads. Press `A` to send only the focused unsent thread.

Revue first writes `.revue/handoff.json`. This file records:

- the handoff ID;
- the run ID;
- the thread IDs;
- the request time;
- the delivery state.

The durable write happens before delivery. A delivery failure cannot lose the feedback.

Each Send replaces the previous handoff record. The threads remain in `.revue/threads.json`.

## Delivery through Orca

When the TUI runs in Orca, Revue can send the wake-up prompt to another terminal in the same worktree.

Revue selects a target in this order:

1. the terminal that the reviewer selected earlier in this TUI session;
2. the Orca pane where the agent last prepared the run or replied;
3. the only other writable terminal in the worktree.

Revue opens a terminal picker when more than one target remains possible. The selected terminal becomes the target for later sends while it stays available.

Revue never sends the prompt to the TUI's own terminal.

If Orca cannot receive the prompt, Revue copies the prompt to the clipboard when possible. Paste it into the agent terminal. If copying also fails, the handoff stays queued on disk.

Delivery is a notification only. The thread data is always read from the repository.

## Agent response workflow

The wake-up prompt tells the agent to run:

```bash
revue status --json
```

The agent then lists the threads for the active or pending run:

```bash
revue threads list <run-directory> --json
```

The agent can reply:

```bash
revue threads reply <run-directory> <thread-id> \
  --author "Fix agent" \
  --body "Changed the limit and added the boundary check."
```

Use `--body-file <path>` for a longer reply. Use `--body-file -` to read the body from standard input.

Responding agents reply and leave each thread open. An open thread with an agent reply is ready for the reviewer to check. Only the reviewer resolves or reopens it.

A reviewer can use the CLI when needed:

```bash
revue threads mark-dealt <run-directory> <thread-id>
revue threads reopen <run-directory> <thread-id>
```

Agents should use the public `revue threads` commands for listing and replies. They should not edit `.revue/threads.json`.

The open TUI watches the thread store. Agent replies appear without a reload.

## Wait for another handoff

An agent can wait for the first handoff on disk:

```bash
revue status --wait
```

After the agent handles one handoff, it can wait for a different handoff ID:

```bash
revue status --wait --since <handoffId>
```

The default timeout is 15 minutes. A timeout exits with status 3. Use `--timeout-ms <n>` to change the limit.

`revue status --wait` returns an existing handoff immediately. This prevents a new agent session from waiting through feedback that it has not read.

## Thread anchor types

Revue stores three anchor forms:

- A **patch anchor** contains one or more canonical ranges in one file. The TUI uses this form for new diff comments.
- A **hunk anchor** contains one old hunk start and one range. The agent CLI supports this form.
- An **excerpt anchor** contains a range in frozen quoted code. The agent CLI also supports this form.

A patch anchor can contain old and new ranges and can cross hunks. It cannot cross files.

The agent CLI creates hunk or excerpt anchors:

```bash
revue threads create <run-directory> \
  --file src/value.ts --old-start 4 \
  --side additions --start-line 8 --end-line 10 \
  --author "Review agent" --body "Should this limit be lower?"

revue threads create <run-directory> --kind excerpt \
  --file src/value.ts --start-line 30 --end-line 34 \
  --author "Review agent" --body "Does this caller still hold?"
```

`revue threads list` returns all anchor forms in JSON. Agents must preserve the supplied anchor meaning when they answer feedback.

## Persistence and supersession

Threads live in `.revue/threads.json` at the reviewed repository root. They are keyed by the full run ID.

Each write takes a cross-process lock and reads the latest state before it writes. This prevents the TUI and an agent from replacing each other's messages.

When a run supersedes an earlier run, prep moves its threads to the new run. Revue remaps anchors when possible. It marks a thread orphaned instead of deleting it when its code no longer exists.

Read [Continue a review](continuing.md) for migration and epilogue behaviour.

## Related pages

- [Review code with Revue](guide.md)
- [Continue a review](continuing.md)
- [Troubleshoot delivery and copying](troubleshooting.md)
