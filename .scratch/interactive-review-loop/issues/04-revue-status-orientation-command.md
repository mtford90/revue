# 04 — `revue status` orientation command

Status: done

## Parent

.scratch/interactive-review-loop/PRD.md

## What to build

A `revue status --json` command that lets a cold agent (or human) find their bearings in one call: the active run (most recent narrated run per the lineage chain), the prep arguments that define its scope, open thread counts split into awaiting-agent (last message from a human) versus awaiting-human (last message from an agent), and whether the working tree has drifted since the run was prepped. Human-readable output without `--json`. The command reads only on-disk state — nothing depends on session memory.

## Acceptance criteria

- [x] In a repo with a supersede chain, status names the newest narrated run as active
- [x] Open threads are split correctly by the author kind of their last message
- [x] Working-tree drift since prep is reported as a boolean
- [x] A repo with no runs reports that plainly rather than erroring
- [x] CLI process tests spawn the binary in a scratch repository and assert the JSON shape for each situation

## Blocked by

- 01-recorded-lineage-on-prep
