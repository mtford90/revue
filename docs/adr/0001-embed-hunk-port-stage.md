# ADR 0001 — Embed hunk, port Stage, fork neither

- Status: superseded by [ADR 0002](0002-own-diff-renderer.md)
- Date: 2026-06-17

## Context

revue needs the review experience of Stage, but in the **terminal** and not in a browser. That
experience puts the diff of a branch into ordered **chapters** with narration, and adds a
**prologue** at a high level.

Two MIT projects are near to that goal:

- **`ReviewStage/stage-cli`** — an *agent skill* groups a diff into chapters and writes JSON. A CLI
  validates the JSON, stores it in SQLite, and serves a React SPA. The skill and the chapter schema
  are the valuable, portable part. We do not want the web UI.
- **`modem-dev/hunk`** — a terminal diff reviewer (TypeScript/Bun/OpenTUI). It publishes
  `hunkdiff/opentui` (`HunkReviewStream`, `HunkDiffView`, `createHunkDiffFile`, `parseDiffFromFile`,
  …) as a documented component surface that you can embed. Its internal model is a flat `Changeset`
  / `DiffFile[]` with navigation by file. It has **no concept of chapters**.

Stage has chapters, but it renders in a browser. hunk renders well in a terminal, but it has no
chapters. **Both parse diffs with `@pierre/diffs`**, thus the two diff models agree.

## Decision

Build revue as the **seam** between the two projects. Do not fork either project.

1. **Port the skill and the zod schema of Stage** into revue (`skills/revue-chapters`,
   `packages/types`). The model of chapters and prologues, and the rules for clustering and
   narration, are the core of the product.
2. **Use `hunkdiff/opentui` as a library** for the diff rendering. Pin OpenTUI to `^0.1.89`. This
   version agrees with the peer range of `hunkdiff@0.15.3`.
3. **Own a new shell for chapter navigation** (`packages/tui`). The shell contains:
   - the prologue screen;
   - the sidebar of chapters;
   - the paging that shows one beat at a time;
   - the keymap.

   Neither parent project gives this part. It is what makes revue different.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| **A — Skill only; chapters as hunk annotations** | Rejected | Maps the chapter titles onto the per-line annotation API of hunk. It ships fast, but it makes the chapters into inline notes only: no sidebar, no prologue, no paging. It loses all of the Stage experience. |
| **B — Embed `hunkdiff/opentui`, own the chapter shell** | **Chosen** | Gives the Stage experience in the terminal. Gets the diff rendering of hunk from npm. There is no fork to maintain. The cost: we build the application shell (navigation, keys, layout) again on the render primitives of hunk. |
| **C — Hard-fork hunk, add a `Chapter` layer to its UI** | Rejected | Reuses the most code (the navigation, themes and watch mode of hunk). But the repo changes fast (about 20 commits each month), thus we must rebase forever. Its navigation by file is also the part most opposed to chapters. |

## Consequences

- We track two upstream projects:
  - hunk, as an npm dependency with a pinned version. Examine its OpenTUI peer range at each
    upgrade.
  - Stage, as a port that we did one time and maintain by hand. Sync the skill and the schema again
    when the changes are important.
- We build and own the shell. This is more work at the start, but we control all of the review
  experience.
- The first integration milestone is to render the **diff body** of a chapter. Filter a
  `HunkDiffFile` down to the `hunkRefs` of the chapter and give it to `<HunkReviewStream>`. This
  shows that Option B composes, before we do more work.
- `revue prep` (the git snapshot and the hunk format) comes later. Until then, the skill builds the
  chapters file from a `git diff` that a person computes.
