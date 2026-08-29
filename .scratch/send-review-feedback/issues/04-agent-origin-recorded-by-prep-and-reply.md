# 04 — Agent origin recorded by prep and reply

Status: done

## Parent

.scratch/send-review-feedback/PRD.md

## What to build

When the agent runs `revue prep` or `revue threads reply` inside an Orca terminal
(`ORCA_WORKTREE_ID` and `ORCA_PANE_KEY` set), the command records the agent's pane in
`.revue/agent.json`: `schemaVersion`, `host`, `paneKey`, `worktreeId`, `runId`, `recordedAt`. The
write happens only after the top-level command succeeds, never from the prep library, so the TUI's
reload path never records the reviewer's own pane. A failed origin write is a warning on stderr,
not a command failure. Outside Orca nothing is written.

## Acceptance criteria

- [x] A successful `revue prep` under Orca variables writes the origin with the run id, also when prep deduplicates to an existing run
- [x] A successful `revue threads reply` under Orca variables writes the origin
- [x] A failed prep or reply writes nothing
- [x] Without Orca variables nothing is written
- [x] A reload from the TUI never writes the origin
- [x] An unwritable `.revue` directory produces a warning and the command still exits 0
- [x] CLI process tests cover all of the above

## Blocked by

None (can start immediately).
