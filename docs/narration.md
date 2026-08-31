# Narrated reviews

A narrated review organises one fixed diff into an ordered story. The installed Revue skill writes the narration. The reviewer reads the code and makes the decisions.

Return to the [documentation index](README.md) or [start a review](guide.md).

## The narrative model

A narration can contain these parts:

- A **prologue** explains the motivation, result, focus areas, and overall complexity.
- A **chapter** groups related review units into one coherent change.
- An **interlude** is a chapter without changed code. It can explain an important transition or constraint.
- An **epilogue** explains what changed after an earlier review.

The agent groups code by cause and purpose. A chapter can contain files from different packages when they implement one behaviour.

A chapter is not a summary that replaces the diff. It is an ordered path through the real diff.

## Prepared runs

`revue prep` creates a fixed run under `.revue/runs/<runId>/`. The run contains:

- `run.json` with the scope and file metadata;
- `diff.patch` with the exact patch;
- `hunks.txt` with the review units for the agent;
- fixed old and new file blobs;
- optional narration files.

The run ID identifies the code snapshot. Narration does not change that ID.

The agent writes `chapters.json` beside the fixed patch. It can also write context citations, then freeze them into `context.json`.

`revue show` reads the run directory. It does not recompute Git state.

## Coverage

A prepared review unit is one Git hunk or one metadata-only change. A pure rename, mode change, or empty file can have a metadata review unit without text lines.

Every review unit must appear in exactly one chapter. Revue rejects:

- missing units;
- duplicate units;
- unknown references;
- key-change ranges outside their chapter.

Validate the narration with:

```bash
revue show <run-directory> --check
```

The summary reports how many review units the narration covers.

A run without `chapters.json` is valid. Revue opens it as a flat review.

## Key changes

A key change is a question for the human reviewer. It marks a judgement call, risk, or contract that needs attention.

Each key change has:

- a severity;
- a direct question;
- one or more exact line references.

A key change is not a changelog item. The agent leaves the list empty when the change needs no human decision.

The prologue can also contain focus areas. These direct attention across the complete review.

## Context excerpts

A chapter can quote unchanged code that explains the change. This code can come from a file outside the diff.

The agent cites a path and line range. It does not copy the source text into `chapters.json`. Run this command after the agent writes the citations:

```bash
revue context freeze <run-directory>
```

The command reads the code from the run endpoint and writes `context.json`. Validation fails when a citation has no frozen content.

An excerpt:

- starts folded;
- opens inside the chapter;
- does not count as review work;
- can accept comments;
- keeps real source line numbers.

A worktree endpoint can change while the agent writes the narration. Freeze checks captured files for drift and refuses a mixed snapshot. It warns when the cited file was never part of prep and cannot receive that check.

## Interludes

An interlude has an empty `hunkRefs` list. It can contain prose, excerpts, and diagrams.

An interlude counts as a chapter in navigation and progress. It has no file work, so the reviewer completes it with the chapter review action.

## Diagrams

A chapter summary can contain an `ascii` or `mermaid` fenced block. Revue draws the block beside the chapter content.

An `ascii` block is displayed as written.

Revue draws a limited Mermaid flowchart subset as terminal boxes and arrows. It always lays out the result from top to bottom. Terminal width is limited, so Revue does not honour the Mermaid direction.

Revue shows the Mermaid source when it cannot draw the complete figure. Common causes include:

- unsupported diagram types;
- `subgraph`, `style`, or `classDef` statements;
- combined node lists;
- cycles;
- malformed source;
- a figure that is too wide.

Revue never draws only part of a figure.

## Prologue

The prologue gives the reviewer an overview before chapter one. It can include:

- the motivation;
- the result;
- two to five key changes;
- one to five focus areas;
- a complexity rating;
- an optional Mermaid flowchart.

Most small changes do not need a diagram.

## Continue an existing narration

A new prep can supersede a narrated run. Prep classifies each new review unit as unchanged, modified, or new.

A chapter carries forward only when all its review units remain unchanged. Other chapters become stale and need new narration. The agent ends the new narration with an epilogue.

Read [Continue a review](continuing.md) for `revue status`, `revue delta`, carried progress, and thread migration.

## Authoring contract

The installed Revue skill is the source of truth for narration authoring. It defines:

- chapter grouping;
- titles and summaries;
- key-change questions;
- excerpts and diagrams;
- continuation and epilogue rules;
- validation and handoff.

Use `revue skill install` after each CLI upgrade. Use `revue doctor` to find a missing or stale skill.

## Related pages

- [Review code with Revue](guide.md)
- [Feedback and agent handoff](feedback.md)
- [Continue a review](continuing.md)
