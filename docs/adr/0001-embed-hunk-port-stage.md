# ADR 0001 — Embed hunk, port Stage, fork neither

- Status: accepted
- Date: 2026-06-17

## Context

revue wants Stage's reviewing experience — a branch's diff organised into ordered, narrated
**chapters** with a high-level **prologue** — but rendered in the **terminal** instead of a browser.

Two MIT projects sit on either side of that goal:

- **`ReviewStage/stage-cli`** — an *agent skill* clusters a diff into chapters and writes JSON; a CLI
  validates it, stores it in SQLite, and serves a React SPA. The skill + chapter schema are the
  valuable, portable part. The web UI is not what we want.
- **`modem-dev/hunk`** — a terminal diff reviewer (TypeScript/Bun/OpenTUI). It publishes
  `hunkdiff/opentui` (`HunkReviewStream`, `HunkDiffView`, `createHunkDiffFile`, `parseDiffFromFile`,
  …) as a documented, embeddable component surface. Its internal model is a flat `Changeset` /
  `DiffFile[]` with file-oriented navigation — **no concept of chapters**.

So Stage has chapters but renders in a browser; hunk renders beautifully in a terminal but has no
chapters. Conveniently, **both parse diffs with `@pierre/diffs`**, so the diff models align.

## Decision

Build revue as the **seam** between the two, forking neither:

1. **Port Stage's skill and zod schema** into revue (`skills/revue-chapters`, `packages/types`). The
   chapter/prologue model and the clustering/narration rules are the product's brain.
2. **Depend on `hunkdiff/opentui` as a library** for diff rendering. Pin OpenTUI to `^0.1.89` to
   satisfy `hunkdiff@0.15.3`'s peer range.
3. **Own a new chapter-navigation shell** (`packages/tui`) — the prologue screen, the chapter
   sidebar, the one-beat-at-a-time paging, the keymap. This is the part neither parent provides and
   is revue's actual differentiator.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| **A — Skill only; chapters as hunk annotations** | Rejected | Maps chapter titles onto hunk's per-line annotation API. Ships fast but collapses chapters into scattered inline notes — no sidebar, no prologue, no paging. Loses the entire Stage UX. |
| **B — Embed `hunkdiff/opentui`, own the chapter shell** | **Chosen** | Delivers Stage's experience in the terminal; gets hunk's diff rendering for free via npm; no fork to maintain. Cost: we rebuild the app shell (nav/keys/layout) on top of hunk's render primitives. |
| **C — Hard-fork hunk, add a `Chapter` layer to its UI** | Rejected | Deepest reuse (hunk's nav/themes/watch mode) but a permanent rebase tax against a fast-moving repo (~20 commits/month), and we'd be fighting its file-oriented navigation — the part most opposed to chapters. |

## Consequences

- We track two upstreams: hunk via a version-pinned npm dependency (watch its OpenTUI peer range on
  upgrades); Stage as a one-time port we maintain by hand (re-sync the skill/schema when meaningful).
- The shell is ours to build and own — more upfront work, full control over the reviewing UX.
- The first real integration milestone is rendering a chapter's **diff body**: filter a
  `HunkDiffFile` down to the chapter's `hunkRefs` and hand it to `<HunkReviewStream>`. This validates
  that Option B actually composes before we invest further.
- `revue prep` (git snapshot + hunk formatting) is deferred; until then the skill builds the chapters
  file from a hand-computed `git diff`.
