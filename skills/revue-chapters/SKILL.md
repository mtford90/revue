---
name: revue-chapters
description: Generate revue chapters for the current local git branch and open them in a terminal UI for review.
user-invocable: true
---

# revue-chapters

Generates a Revue chapter run for local Git changes and opens it in the terminal UI. `revue prep`
freezes the review scope; the agent reads its numbered hunks, clusters them into narrative
**chapters** and a **prologue**, writes `chapters.json` into the run, and hands that same run to
`revue show`.

This skill is adapted from ReviewStage/stage-cli's `stage-chapters` skill (MIT). The clustering,
narration, and prologue rules remain the same. Revue differs by preserving one immutable patch and
its old/new snapshots instead of recomputing Git state during display.

## Prerequisites

1. **The current directory is a git repo.** Run `git rev-parse --is-inside-work-tree`. If it does
   not print `true`, stop.
2. **`revue` is runnable.** From the Revue repo: `bun run revue --help`.

## Step 1 — Prepare the run

```bash
RUN=$(revue prep)
```

Prep prints only the run directory to stdout and reports its resolved refs, full SHAs, endpoint
kinds, totals, and exclusions on stderr. It auto-selects local work when present and committed branch
changes otherwise. Explicit forms are available when the user requests a scope:

```bash
RUN=$(revue prep main)
RUN=$(revue prep main feature)
RUN=$(revue prep main..feature)       # direct endpoints
RUN=$(revue prep main...feature)      # merge base to feature
RUN=$(revue prep --ref staged)
RUN=$(revue prep --ref unstaged)
RUN=$(revue prep --ref work)
```

If prep exits non-zero, relay its error and stop. Do not edit `run.json`, `diff.patch`, `hunks.txt`,
or `blobs/`; they are one immutable input.

## Step 2 — Read the prepared hunks

Read `$RUN/hunks.txt` completely (chunk large files with offset/limit). It contains commit messages
followed by file/hunk sections. Every section gives the exact `(filePath, oldStart)` reference and
two source-number columns. The left column is the old line for `side: "deletions"`; the right column
is the new line for `side: "additions"`. A blank column means that line does not exist on that side.

Files with no textual hunk receive a metadata review unit with `oldStart: 0`; include it exactly like
a textual hunk. Use only references printed in `hunks.txt`.

## Step 3 — Cluster + narrate

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

Every review unit in `hunks.txt` must appear in **exactly one** chapter — no omissions, no duplicates.

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

## Step 4 — Generate the prologue

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

## Step 5 — Write the chapters file

Write the JSON to `$RUN/chapters.json` via a heredoc:

```bash
cat > "$RUN/chapters.json" << 'EOF'
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
  ]
}
EOF
```

Field constraints: `order` is a positive 1-indexed integer; `hunkRefs[].oldStart` is a non-negative
integer copied from `hunks.txt`; every `keyChanges[].lineRefs` has ≥ 1 entry with positive
`startLine ≤ endLine`; `prologue` is optional, so the minimal skeleton omits it. When included, obey
Step 4’s key-change and focus-area cardinalities. See `examples/sample-run/chapters.json` for a full
valid example and `packages/types/src/` for the authoritative zod schema.

## Step 6 — Display

```bash
revue show "$RUN"
```

`revue show` verifies the run hashes, validates `chapters.json`, requires every prepared review unit
exactly once, checks key-change ranges against their chapter hunks, and opens the pinned patch without
touching Git. Run `revue show "$RUN" --check` to validate and print a plain-text summary without
launching the UI.

## Step 7 — Act on review threads

After `revue show "$RUN"` exits, retrieve open threads through Revue's public JSON interface. Do not
scrape terminal output and do not read or edit `.revue/threads.json` directly.

```bash
revue threads list "$RUN" --json
```

Each thread includes a stable ID, exact path/review-unit/side/range anchor, thread-level status, and
ordered messages. Every message includes its own stable ID, multi-line body, creation time, and
`human` or `agent` author. Address every open thread against the same prepared scope.

Agents must identify themselves explicitly when adding a root message or reply. Use a stable,
human-readable role name; do not impersonate the repository's Git user:

```bash
revue threads reply "$RUN" <thread-id> \
  --author "revue-chapters agent" \
  --body "Adjusted the retry cap and kept the interactive path within its budget."
```

Only after the requested change has been made should that exact thread be marked dealt with:

```bash
revue threads mark-dealt "$RUN" <thread-id>
```

Use `--all` when dealt-with history is relevant. Reopen feedback when it still applies or was marked
prematurely:

```bash
revue threads list "$RUN" --json --all
revue threads reopen "$RUN" <thread-id>
```

An agent may start a new visible thread when it has concrete anchored feedback. Copy the exact
review-unit identity and line range from the prepared run rather than inventing an anchor:

```bash
revue threads create "$RUN" \
  --file src/value.ts --old-start 4 --side additions --start-line 8 --end-line 10 \
  --author "review agent" --body-file -
```

Hard deletion is only for a thread or reply the reviewer identifies as erroneous. Never delete
feedback merely because it is difficult, already addressed, or disagreed with:

```bash
revue threads delete-message "$RUN" <thread-id> <message-id>
revue threads delete "$RUN" <thread-id>
```

All operations re-verify the supplied run and pinned anchors without recomputing Git scope. Relay an
actionable validation error instead of guessing a replacement anchor. `revue comments` is only a
compatibility command alias; use the official `threads` API.
