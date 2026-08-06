# ADR 0003 — Prep owns immutable review scope

- Status: accepted
- Date: 2026-08-02

## Context

Revue previously accepted an agent-written chapters file plus an independently produced `--diff`
patch. Nothing proved that the narration and rendered code described the same repository state, and
`show` had no old/new file snapshots for semantic diff or full-file context.

Stage recomputes scope during display and therefore requires the repository to remain unchanged
between generation and review. Revue can avoid that coupling because its local TUI does not need a
database-backed live application.

## Decision

`revue prep` is the sole owner of review scope. It writes an immutable, content-addressed run under
`.revue/runs/<runId>/`:

```text
run.json
diff.patch
hunks.txt
blobs/<sha256>
chapters.json  # written later by the agent
```

`run.json` records branch context, actual old/new endpoints, full commit or tree SHAs, worktree
snapshot digest, file status/modes/object kinds, old/new blob hashes, commit messages, exclusions,
and totals. The run ID hashes the canonical prepared content but excludes creation time and chapter
narration. Writes are atomic and an existing valid run is reused.

Scope semantics are explicit:

- committed: merge base to compare commit by default; `A..B` requests direct endpoint comparison;
- staged: captured `HEAD` commit to captured index tree;
- unstaged: captured index tree to worktree, excluding untracked files;
- work: captured `HEAD` commit to final worktree, including sorted untracked files not ignored by
  Git's standard exclusion sources.

With no explicit scope, prep selects work when local changes exist and committed otherwise. Local
modes reject unresolved conflicts and recheck HEAD, index, patch, and included worktree bytes before
writing, failing if the source changed during capture.

Built-in lockfile/minified/binary/submodule exclusions and root `.revueignore` rules apply to both
paths of a rename before the patch and agent input are written. Excluded paths and reasons remain in
the manifest.

`@revue/diff-model` owns Pierre patch adaptation and stable identities shared by prep and rendering.
Textual hunks use `(filePath, deletionStart)`. Reviewable files without textual hunks receive one
metadata unit at `(filePath, 0)`.

`revue show` accepts exactly one run directory, verifies hashes and schemas, requires every prepared
review unit exactly once, checks key-change ranges belong to their chapter’s pinned hunks, and then
renders the pinned patch. It never invokes Git. Review state is keyed by both `runId` and chapters
content.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Keep chapters plus optional `--diff` | Rejected | Preserves two input paths and the possibility of silently mismatched scope. |
| Store one JSON file with an inline patch | Rejected | Awkward for agents and cannot represent arbitrary binary old/new snapshots cleanly. |
| Store only the patch in a run directory | Rejected | Does not unblock semantic diff or full-file context and cannot preserve symlink/executable identity. |
| Recompute Git state in `show` | Rejected | Makes display race the repository and duplicates scope logic. |
| Immutable run with patch, manifest, hunks, and blobs | Chosen | One source of truth supports current rendering and later semantic/full-context views. |

## Consequences

- The manual chapters-file and `--diff` CLI contract is removed rather than retained as a fallback.
- `.revue/runs` may consume space proportional to changed file snapshots; identical blob content is
  deduplicated within each run. Cross-run garbage collection is future work.
- Rename detection is deterministic for the pinned command but remains Git’s similarity heuristic.
- Submodules are recorded as exclusions until Revue has a dedicated gitlink model.
- A working-tree endpoint represents filesystem bytes for included files; `diff.patch` remains the
  authoritative source for line numbers.
- `examples/sample-run` is a committed complete run and exercises the production loading path.

## Amendments

- 2026-08-05 — `chapters.json` is now optional: a run without narration opens as a flat diff
  ([ADR 0006](0006-chapterless-runs.md)). `revue --pr <number|url>` fetches and pins `FETCH_HEAD`
  immediately, flowing into ordinary committed merge-base scope, so PR review inherits these
  guarantees unchanged. The pinned blobs are the sole legitimate source of file content beyond the
  patch — context expansion synthesises from them and `show` still never touches Git
  ([ADR 0007](0007-synthesised-patches-and-anchor-authority.md)). Reviewing a bare patch with no
  backing blobs remains explicitly out of scope pending its own design.

## Amendment

ADR 0013 replaces the active package boundary with `@revue/diff` plus `@revue/diff-opentui`; the historical names above describe the implementation at the time of this decision.
