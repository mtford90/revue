# Revue agent instructions

Before changing this repository, read these files completely:

1. `README.md` for the product, current capabilities, commands, and roadmap.
2. `CONTEXT.md` for domain language and load-bearing decisions.
3. `docs/testing.md` before adding, changing, or reviewing tests.
4. Relevant records in `docs/adr/` before changing architecture.

Do not rely on a compacted summary in place of these files. Re-read them when the task changes their subject area. If the documents conflict, stop and surface the conflict rather than silently choosing one.

Follow `docs/testing.md` strictly. Tests must protect a plausible regression or contract; do not add tests solely for coverage, snapshots of incidental output, or assertions against private implementation details.

After changing the codebase, run:

```bash
bun run typecheck
bun run lint
bun test
```
