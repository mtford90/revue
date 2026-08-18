# ADR 0003 — Prep owns immutable review scope

- Status: accepted
- Date: 2026-08-02

## Context

Before this decision, Revue accepted a chapters file from an agent and a `--diff` patch made
independently. Nothing proved that the narration and the rendered code described the same state of
the repository. Also, `show` had no old file snapshots and no new file snapshots. Thus `show` could
not do a semantic diff or show the full file context.

Stage computes the scope again during the display. Thus the repository must stay unchanged between
the generation and the review. Revue does not need that coupling, because its local TUI does not
need a live application with a database.

## Decision

`revue prep` is the only owner of the review scope. It writes an immutable run, addressed by
content, under `.revue/runs/<runId>/`:

```text
run.json
diff.patch
hunks.txt
blobs/<sha256>
chapters.json  # written later by the agent
```

`run.json` records these items:

- the branch context;
- the actual old endpoint and new endpoint;
- the full commit SHAs or tree SHAs;
- the digest of the worktree snapshot;
- the status, the modes, and the object kinds of each file;
- the old blob hash and the new blob hash;
- the commit messages;
- the exclusions;
- the totals.

The run ID is a hash of the canonical prepared content. It excludes the creation time and the
chapter narration. Each write is atomic. Prep uses an existing valid run again.

The scope has these explicit meanings:

- committed: from the merge base to the compare commit, by default. `A..B` asks for a direct
  comparison of the two endpoints.
- staged: from the captured `HEAD` commit to the captured index tree.
- unstaged: from the captured index tree to the worktree. It excludes untracked files.
- work: from the captured `HEAD` commit to the final worktree. It includes the untracked files, in
  sorted order, that the standard exclusion sources of Git do not ignore.

If you give no explicit scope, prep selects work when local changes exist, and committed when they
do not. The local modes refuse unresolved conflicts. Before they write, they examine HEAD, the
index, the patch, and the included worktree bytes again. If the source changed during the capture,
prep fails.

The built-in exclusions for lockfiles, minified files, binary files, and submodules apply to both
paths of a rename. The rules in the root `.revueignore` apply in the same way. They apply before
prep writes the patch and the agent input. The manifest keeps the excluded paths and the reason for
each one.

`@revue/diff-model` owns the adaptation of the Pierre patch. It also owns the stable identities that
prep and rendering share. A textual hunk uses `(filePath, deletionStart)`. A reviewable file with no
textual hunk gets one metadata unit at `(filePath, 0)`.

`revue show` accepts exactly one run directory. It then does these steps:

1. It examines the hashes and the schemas.
2. It requires every prepared review unit exactly one time.
3. It makes a check that each key-change range belongs to the pinned hunks of its chapter.
4. It renders the pinned patch.

`show` never calls Git. The key of the review state is both the `runId` and the content of the
chapters.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Keep chapters plus optional `--diff` | Rejected | Keeps two input paths. The scope can differ between them without a message. |
| Store one JSON file with an inline patch | Rejected | It is difficult for agents. It cannot hold arbitrary binary snapshots of the old file and the new file. |
| Store only the patch in a run directory | Rejected | It does not permit a semantic diff or the full file context. It cannot keep the identity of a symlink or of an executable file. |
| Recompute Git state in `show` | Rejected | The display then races the repository, and the scope logic exists two times. |
| Immutable run with patch, manifest, hunks, and blobs | Chosen | One source of truth. It supports the rendering of today and the later semantic view and full-context view. |

## Consequences

- We remove the CLI contract for the manual chapters file and for `--diff`. We do not keep it as a
  fallback.
- `.revue/runs` can use space in proportion to the snapshots of the changed files. Inside one run,
  blobs with the same content are stored one time. The garbage collection across runs is future
  work.
- The detection of a rename is deterministic for the pinned command. But it stays the similarity
  heuristic of Git.
- Prep records submodules as exclusions. This continues until Revue has a dedicated gitlink model.
- A working-tree endpoint holds the filesystem bytes of the included files. `diff.patch` stays the
  authority for the line numbers.
- `examples/sample-run` is a complete run in the repository. It uses the production load path.

## Amendments

- 2026-08-05 — `chapters.json` is now optional. A run with no narration opens as a flat diff
  ([ADR 0006](0006-chapterless-runs.md)). `revue --pr <number|url>` fetches `FETCH_HEAD`, pins it
  immediately, and flows into the usual committed merge-base scope. Thus a PR review keeps these
  guarantees without change. The pinned blobs are the only legitimate source of file content after
  the patch: context expansion synthesises from them, and `show` still never touches Git
  ([ADR 0007](0007-synthesised-patches-and-anchor-authority.md)). The review of a bare patch with no
  blobs behind it stays out of scope until it gets its own design.
- 2026-08-07 — [ADR 0014](0014-narrative-depth-and-frozen-context.md) extends this ADR. It does not
  supersede it. The requirement above says that `show` accepts every prepared review unit exactly
  one time. That requirement now applies at the full depth that the narrative declares. An absent
  declaration has the same meaning as full depth. Only an explicitly partial depth can omit units.

  At every depth, these stay errors:
  - a duplicate unit;
  - an unknown unit;
  - a key-change range outside its chapter.

  The run directory also gets `context.json`. `context.json` is an artifact on the narration side.
  The run ID excludes it, exactly as the run ID excludes `chapters.json`.

## Amendment

ADR 0013 replaces the active package boundary with `@revue/diff` and `@revue/diff-opentui`. The names above are historical. They describe the implementation at the time of this decision.
