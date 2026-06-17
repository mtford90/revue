---
name: revue-chapters
description: Generate revue chapters for the current local git branch and open them in a terminal UI for review.
user-invocable: true
---

# revue-chapters

Generates a revue chapter run for the current local git branch and opens it in a terminal UI
(built on [hunk](https://github.com/modem-dev/hunk)). The agent clusters the diff into narrative
**chapters** and a **prologue**, writes them to a JSON file, and hands that file to `revue show`.

This skill is adapted from ReviewStage/stage-cli's `stage-chapters` skill (MIT). The clustering,
narration, and prologue rules are the same — only the final display step differs: revue renders in
the terminal instead of a browser.

> **Status — early scaffold.** `revue prep` (the git-diff/hunk-formatting step) is not built yet.
> Until it lands, generate the diff yourself (`git diff` against the merge-base), build the chapters
> file by hand following the schema below, and run `revue show <file>`. The schema and the
> clustering/narration/prologue rules below are stable and match what `prep` will eventually feed you.

## Prerequisites

1. **The current directory is a git repo.** Run `git rev-parse --is-inside-work-tree`. If it does
   not print `true`, stop.
2. **`revue` is runnable.** From the revue repo: `bun run packages/tui/src/main.tsx show --help`.

## Step 1 — Get the diff

Until `revue prep` exists, compute the diff yourself:

```bash
BASE=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main)
git --no-pager diff "$BASE"...HEAD        # committed branch work
# ...or, when there are uncommitted changes you want reviewed:
git --no-pager diff "$BASE"               # working tree vs merge-base
git --no-pager log --oneline "$BASE"..HEAD  # commit messages, for prologue context
```

Each hunk you reference needs a stable `(filePath, oldStart)` identity. `oldStart` is the
pre-image start line from the hunk's `@@ -<oldStart>,<n> +<newStart>,<m> @@` header (`0` for a
newly-added file). The two line-number columns in a unified diff are the **old** line (used for
`side: "deletions"`) and the **new** line (used for `side: "additions"`).

## Step 2 — Cluster + narrate

Produce a `chapters` array. Each chapter groups related hunks into one coherent story beat,
narrates it for a reviewer unfamiliar with this code, and flags judgment calls that need a human.

### Clustering rules

Group hunks by **causal relationship** — changes that set up or enable later changes belong together.

- Spanning multiple files is expected (schema + API + UI for one feature = one chapter).
- Moves/refactors are a single chapter — group the deletion and addition hunks together, not as
  separate "Remove" and "Add" chapters.
- Split only when changes are truly independent — a reviewer could understand one without the other.
- Tests belong with the implementation chapter they cover.
- Config/dependency changes can be their own chapter if unrelated to a feature chapter.

**Chapter ordering:** foundation first (types, schemas, utilities others depend on), then core logic,
then integration (wiring, config, tests). A chapter introducing a symbol another chapter uses comes first.

**Hunk ordering within a chapter:** group all hunks from the same file together; within a file, list
them in ascending `oldStart` order.

### Coverage rule

Every hunk in the diff must appear in **exactly one** chapter — no omissions, no duplicates.

### Narration rules

- **Title:** action-oriented verb phrase, max 8 words ("Wire org ID through the API layer"). No
  filler like "Add support for".
- **Summary:** 2–3 sentences — what this chapter enables and why. Lead with impact. When a chapter
  builds on a previous one, open with the causal link ("Now that X is in place…"). Short paragraphs,
  one idea each, separated by blank lines. Markdown allowed: `**bold**`, `*italics*`, `` `code` ``,
  and short fenced snippets (≤ 6 lines).

### Key change rules

Key changes are **judgment calls only a human can make** — things needing product context, team
conventions, or knowledge of intent. Skip anything a linter, type checker, or review bot would catch.
Frame each as a **question**. Return an **empty array** when nothing needs human input — do not invent
items. Each key change has `lineRefs`: one tight range per spot the question depends on
(`side: "additions"` → new-side line numbers; `side: "deletions"` → old-side).

Good: "Should `retryCount` reset when the user switches orgs?"
Bad: "Check that the auth logic is correct." (verifiable by reading the code)

## Step 3 — Generate the prologue

A high-level overview of the whole change, shown before the reviewer dives into chapters.

- **motivation** (string | null): one sentence a non-engineer understands — what was broken/missing.
  `null` if the diff doesn't make it obvious.
- **outcome** (string | null): one sentence — what's better now. Same null rule.
- **diagram** (string | null): Mermaid source (no code fences) only when the change spans multiple
  components in a data/control flow. `null` for single-file/rename/config/test-only changes — **most
  changes have no diagram.** Keep under 10 nodes; quote labels with special chars (`A["@scope/pkg"]`).
- **keyChanges** (2–5): each `{ summary (6–10 words, outcome-focused), description (10–15 words) }`.
- **focusAreas** (1–5): each `{ type, severity, title (3–5 words), description (why + a "confirm/verify/check"
  action), locations (file paths) }`. `type` ∈ security, breaking-change, high-complexity, data-integrity,
  new-pattern, architecture, performance, testing-gap. `severity` ∈ critical, high, medium (problems) or
  info (points of interest). Always at least one.
- **complexity**: `{ level ∈ low|medium|high|very-high, reasoning }`.

Talk like a coworker, not a changelog. No "this change introduces/implements/adds".

## Step 4 — Write the chapters file

Write the JSON via a heredoc to a temp path:

```bash
OUT=$(mktemp "${TMPDIR:-/tmp}/revue-chapters.XXXXXX")
cat > "$OUT" << 'EOF'
{
  "chapters": [
    {
      "id": "chapter-1",
      "order": 1,
      "title": "Short imperative title",
      "summary": "Why this chapter matters to the reviewer.",
      "hunkRefs": [{ "filePath": "path/to/file.ts", "oldStart": 42 }],
      "keyChanges": [
        {
          "content": "A judgment-call question for the reviewer.",
          "lineRefs": [
            { "filePath": "path/to/file.ts", "side": "additions", "startLine": 50, "endLine": 55 }
          ]
        }
      ]
    }
  ],
  "prologue": { "motivation": null, "outcome": null, "diagram": null, "keyChanges": [], "focusAreas": [], "complexity": { "level": "low", "reasoning": "" } }
}
EOF
```

Field constraints: `order` is a positive 1-indexed integer; `hunkRefs[].oldStart` is a non-negative
integer; every `keyChanges[].lineRefs` has ≥ 1 entry with positive `startLine ≤ endLine`; `prologue`
is optional (omit the whole object if not desired). See `examples/sample-chapters.json` for a full,
valid example, and `packages/types/src/` for the authoritative zod schema.

## Step 5 — Display

```bash
revue show "$OUT"
```

`revue show` validates the file against the schema and opens the interactive terminal UI. Navigate
with `j`/`k` (or `↑`/`↓`), `g`/`G` for first/last, `q` to quit. Run with `--check` (or pipe stdout)
to validate and print a plain-text summary without launching the UI.
