# Revue agent instructions

Before changing this repository, read these files completely:

1. `README.md` for the product, install, and the core review loop.
2. `docs/guide.md` for current capabilities in detail, commands, and the roadmap.
3. `CONTEXT.md` for domain language and load-bearing decisions.
4. `docs/testing.md` before adding, changing, or reviewing tests.
5. Relevant records in `docs/adr/` before changing architecture.

Do not rely on a compacted summary in place of these files. Re-read them when the task changes their subject area. If the documents conflict, stop and surface the conflict rather than silently choosing one.

Follow `docs/testing.md` strictly. Tests must protect a plausible regression or contract; do not add tests solely for coverage, snapshots of incidental output, or assertions against private implementation details.

After changing the codebase, run:

```bash
bun run typecheck
bun run lint
bun test
```

## Running the reviewer

```bash
bun run revue show examples/sample-run
```

`examples/sample-run` is committed and always works. Prefer a larger run for anything touching
layout or navigation — a seven-chapter run of a real pull request may exist locally at
`~/Playground/carewell/stage-demo-pr135/revue-run`. Most rendering faults only surface with long
paths, wide diffs, and enough chapters to scroll the sidebar.

## Seeing the TUI

A tool call cannot eyeball an OpenTUI shell. Drive it under tmux at a fixed size and capture the
pane instead. Vary the size: 160x45 and 100x36 expose different layout faults.

```bash
tmux new-session -d -s revue -x 160 -y 45 "bun run revue show examples/sample-run"
sleep 4
tmux send-keys -t revue "]"; sleep 0.5; tmux send-keys -t revue "c"   # into chapter one
tmux capture-pane -t revue -p        # -e keeps the colour escapes
tmux kill-session -t revue
```

Capture with `-e` whenever the change is a colour or a background. A plain capture cannot tell a
disabled control from an enabled one, and both `bun test` and a plain pane read as passing while
the shell is unreadable.
