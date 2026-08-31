---
name: revue
description: Review any git diff — a branch, a pull request, two refs, staged, or the working tree — as narrated chapters in the revue terminal UI, and answer the review comments left on one.
user-invocable: true
---

# revue

Turns any Git diff into a Revue chapter run and opens it in the terminal UI. `revue prep`
freezes the review scope — a branch, someone's pull request, any two refs, or local changes; the
agent reads its numbered hunks, clusters them into narrative **chapters** and a **prologue**,
writes `chapters.json` into the run, and hands that same run to `revue show`.

The review continues from there. The reviewer leaves **threads** on the code, the agent answers
them, and the next prep of the same scope **supersedes** the run they read: chapters the change left
alone carry forward verbatim, the rest are re-narrated, and an **epilogue** tells the reviewer what
moved since they last looked. Step 8 is that half of the workflow.

This skill is adapted from ReviewStage/stage-cli's `stage-chapters` skill (MIT). The clustering,
narration, and prologue rules remain the same. Revue differs by preserving one immutable patch and
its old/new snapshots instead of recomputing Git state during display.

## Invocation behaviour

Invoking this skill is a request to work on a narrated review — to generate one, or to answer the
feedback on one. Start the workflow immediately; do not stop after loading or summarising these
instructions.

- When the user points at review feedback rather than a scope — "I added comments", "check the
  threads", "deal with my review feedback", "I've left you notes on the revue" — go straight to
  Step 8 and orient with `revue status`. The review already exists; preparing a fresh run to answer
  it discards every chapter the reviewer has read.
- With no arguments, use bare `revue prep` and generate the narrative for its auto-selected scope.
- With arguments, treat them as the requested review scope and pass the corresponding scope to
  `revue prep`.
- Use the chapterless `revue diff` path only when the user explicitly asks for a quick or
  non-narrated review.

## Prerequisites

1. **The current directory is a git repo.** Run `git rev-parse --is-inside-work-tree`. If it does
   not print `true`, stop.
2. **`revue` is runnable.** Run `revue --version`. If the command is missing, tell the user to
   install the revue CLI (see the revue README for installation options) and stop — never download
   or install the binary yourself. From a checkout of the Revue repo, `bun run revue` works
   instead of an installed binary.
3. **This skill matches the CLI.** Check this before writing anything, not after validation
   fails. `revue skill install` stamps the copy it writes with the CLI version that produced it,
   as a `revue-version:` line in this file's frontmatter. Compare that version with the one
   `revue --version` prints. If they differ, stop and tell the user to re-run
   `revue skill install` (`revue doctor` reports the same drift) — a skill and a CLI from
   different versions disagree about the chapters schema, and pushing on wastes a whole
   narration before `revue show` rejects it. A copy with no `revue-version:` line was placed by
   hand rather than installed; treat the CLI as authoritative and continue.

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

To review a pull request — including someone else's — use `--pr`, which fetches the PR head and
compares it against the detected base (override with `--base`):

```bash
RUN=$(revue prep --pr 123)                                    # PR on the origin remote
RUN=$(revue prep --pr https://github.com/owner/repo/pull/123) # PR anywhere on GitHub
```

The URL form fetches directly from that repository, so it works from any local clone that shares
history with the PR's target. For other diff sources, fetch the relevant refs first and pass them
to prep as ordinary refs.

Prep also records lineage. When the scope it prepares has already been narrated once, the new run
**supersedes** that narrated run: chapters the change did not touch are carried forward with their
references re-mapped, the reviewer's threads move onto the new run, and what is left becomes a
worklist. Prep says so on stderr:

```
supersedes 8cf38d260d5c
1 chapter carried, 1 chapter stale
1 review unit to narrate — revue delta <run-directory>
```

Those three lines mean you are continuing a review, not starting one. Narrate the run through Step
8's regeneration steps (carried chapters copied in, stale ones rewritten, the epilogue last) rather
than from a blank page. `--carry-from <run-id>` names the predecessor when detection picks the wrong
one, and `--no-carry` starts a genuinely fresh review of the same scope, leaving the reviewer's
threads and read marks behind on the old run.

Repeatable `--ignore <gitignore-pattern>` options exclude files from this prep only, evaluated
after any `.revueignore` at the repository root. Pass `--show-ignored` to list the effective
patterns and omissions. Git's standard exclusions (`.gitignore`, `.git/info/exclude`, and
`core.excludesFile`) control untracked-file discovery only; tracked changes remain reviewable.

When the user wants a quick look without narration, skip this skill's chapter steps entirely:
`revue diff [scope…]` accepts the same scope forms as prep and opens the result immediately as a
flat file-by-file diff with no chapters. It launches the full-screen TUI, so follow Step 7's
terminal handoff rules. Never run it through the agent's shell tool. It prints the run directory
to stderr, so review threads (Step 8) can still be targeted against it.

If prep exits non-zero, relay its error and stop. Do not edit `run.json`, `diff.patch`, `hunks.txt`,
`delta.json`, or `blobs/`; they are prep's record of the run, and yours to read only.

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

Every review unit in `hunks.txt` must appear in **exactly one** chapter: no omissions, no
duplicates, and no citing a reference `hunks.txt` does not print.

### Voice

These rules govern every string the reviewer reads: chapter titles and summaries, key changes, and
every prologue field.

Write for a competent engineer who has never seen this code. Present tense, active voice, the code
as the subject — "the API client retries 503s", not "retry logic has been added". One idea per
sentence, nearly all of them under 25 words.

- **Say what the diff cannot.** The reviewer is reading you with the lines already in front of them,
  so restating those lines spends the only prose they get. Write the reason, the consequence, what
  breaks without it, the alternative that was passed over.
- **Plain words.** `use` not `utilise` or `leverage`, `run` not `facilitate`, `create` not
  `instantiate`, `to` not `in order to`. Say `is`, not `serves as`. Cut `ensure`, `enable`,
  `provide`, `robust`, `seamless`, `comprehensive`, `powerful`, `significantly`.
- **Report, don't grade.** No `cleanly`, `elegantly`, `neatly`, `nicely` — whether the code is good
  is the reviewer's call, and grading it pre-empts the judgment they came to make.
- **Name things as the code names them.** Use the identifier rather than a paraphrase of it. A domain
  term the reader may not know gets a handful of words of definition once, then plain use.
- **Say when you don't know.** "The diff doesn't say why the cap is five seconds" beats a hedge or a
  guess, and points the reviewer at a real gap.
- **Nothing carries between chapters.** A reviewer on chapter 7 does not remember chapter 2. Restate
  the dependency in a few words instead of referring back to it.

Before writing any string, delete:

1. Openers that announce the change: "This change…", "This chapter…", "Here we…".
2. Closing participles carrying no fact: "…, ensuring consistency", "…, improving maintainability".
3. Negative parallelism: "not just X, but Y", "rather than X, instead Y".
4. Any three-item list of adjectives or verbs where one of them would do.
5. Metaphors and idioms — "under the hood", "surface area", "plumbing". Write the literal thing.
6. Every em dash past the first in a paragraph.
7. Hedging adverbs carrying no information: "perhaps", "essentially", "effectively", "simply". Keep a
   hedge that marks real uncertainty; deleting that one manufactures confidence.

Then read it aloud. If you would not say it to a colleague at their desk, write it again.

> Instead of: "This change introduces a robust retry mechanism, ensuring transient failures are
> handled gracefully and significantly improving dashboard reliability."
>
> Write: "The API client now retries a 503 instead of throwing. A deploy takes the backend down a few
> seconds at a time, which was long enough to blank a dashboard until someone refreshed it."

### Narration rules

- **Title:** imperative verb phrase naming its real subject, max 8 words ("Wire org ID through the
  API layer"). Not a gerund, not a file name, no filler like "Add support for".
- **Summary:** 2–3 sentences. The first says what the code now does; the rest say why it had to.
  Open every chapter differently — one shared formula across a run reads as filler. Short paragraphs,
  one idea each, separated by blank lines. Markdown allowed: `**bold**`, `*italics*`, `` `code` ``,
  and short fenced snippets (≤ 6 lines). No lists, tables or block quotes — they render as raw text.
- **Diagrams:** a fence tagged `ascii` or `mermaid` is a figure rather than a snippet. It leaves the
  prose and renders beside the diff as a block the reviewer folds away. A `mermaid`
  `flowchart`/`graph` is drawn as ASCII boxes and arrows, laid out top to bottom whatever direction
  it declares. Nodes, links and link labels are all that is drawn: a `subgraph`, a `style`/`classDef`
  line, an `A & B` node list, a cycle, or any other diagram type turns the whole figure back into
  source, so keep to plain flowcharts and leave styling out. Use them sparingly, and mostly on a
  chapter with no hunks.

### Key change rules

Key changes are **judgment calls only a human can make** — things needing product context, team
conventions, or knowledge of intent. Skip anything a linter, type checker, or review bot would catch.
Frame each as a **question**. Return an **empty array** when nothing needs human input — do not invent
items. Give each key change a `severity`: `critical` or `high` for serious problems, `medium` for a
meaningful risk, and `info` for a point of interest. Each key change has `lineRefs`: one tight range
per spot the question depends on (`side: "additions"` → new-side line numbers; `side: "deletions"` →
old-side).

Good: "Should `retryCount` reset when the user switches orgs?"
Bad: "Check that the auth logic is correct." (verifiable by reading the code)

### Context excerpts

A chapter may cite **unchanged** code the diff does not contain but the reviewer needs in front of
them — the caller a changed signature still has to satisfy, the invariant the change relies on.
Cite it in the chapter's `excerpts` with new-side line numbers at the run's new endpoint:

```json
"excerpts": [
  { "filePath": "src/orders.ts", "startLine": 88, "endLine": 96,
    "caption": "The caller this signature still has to satisfy." }
]
```

**Never transcribe code yourself.** An excerpt carries no text: you cite the range, and
`revue context freeze` (Step 6) reads those exact bytes off disk and pins them. Code typed into a
`summary` by hand is a transcription — it can be subtly wrong, it silently rots, and it throws away
the whole point of the mechanism. If you find yourself pasting source lines into `chapters.json`,
cite them instead.

Cited files need not be part of the diff. Keep each range tight — a signature, a guard clause, a
type — rather than a whole file, and give the `caption` one short line saying why the reviewer is
looking at it. **Most chapters need no excerpt.** Cite one when a reviewer would otherwise have to
leave the review to open a file, never to decorate a chapter.

### Interludes

A chapter with `hunkRefs: []` is an **interlude**: a prose-only page between chapters, shown to the
reviewer marked as having nothing to review. It still needs an `id`, `order`, `title` and `summary`,
and its `keyChanges` must be empty — a key change anchors into its own chapter's hunks, and an
interlude has none.

```json
{
  "id": "interlude-migration-order",
  "order": 4,
  "title": "Why the backfill runs before the cutover",
  "summary": "The next three chapters only make sense in order…",
  "hunkRefs": [],
  "keyChanges": []
}
```

An interlude earns its place when the reviewer needs something no single chapter owns: the reason a
run of chapters has to be read in order, or a `mermaid`/`ascii` figure explaining a structure that
spans them. **Most reviews have none.** Never open a review with one — the prologue already does
that job — and never use one to restate what a chapter's `summary` should say. An interlude in
every review makes the product worse, not richer.

### Epilogues

A run that carries narration forward from the run it supersedes ends with an **epilogue**: one
chapter declaring `"role": "epilogue"`, saying what changed since the reviewer read the last run,
and citing in `threadRefs` the feedback that prompted it. Unlike an interlude it is declared rather
than inferred, and it may carry hunks of its own; an epilogue with none obeys the interlude rule and
leaves `keyChanges` empty. A first narration never has one, and the rules for writing one are in
Step 8, because it belongs to a regeneration pass.

## Step 4 — Generate the prologue

A high-level overview of the whole change, shown before the reviewer dives into chapters.

- **motivation** (string | null): one sentence a non-engineer understands — what was broken/missing.
  `null` if the diff doesn't make it obvious.
- **outcome** (string | null): one sentence — what's better now. Same null rule.
- **diagram** (string | null): Mermaid source (no code fences) only when the change spans multiple
  components in a data/control flow. `null` for single-file/rename/config/test-only changes — **most
  changes have no diagram.** Keep under 10 nodes; quote labels with special chars (`A["@scope/pkg"]`).
  Write a plain `flowchart`/`graph` with nodes and links: that is what the reviewer draws as ASCII,
  and anything else is shown as source.
- **keyChanges** (2–5): each `{ summary (6–10 words, outcome-focused), description (10–15 words) }`.
- **focusAreas** (1–5): each `{ type, severity, title (3–5 words), description (why + a "confirm/verify/check"
  action), locations (file paths) }`. `type` ∈ security, breaking-change, high-complexity, data-integrity,
  new-pattern, architecture, performance, testing-gap. `severity` ∈ critical, high, medium (problems) or
  info (points of interest). Always at least one.
- **complexity**: `{ level ∈ low|medium|high|very-high, reasoning }`.

Every field here obeys the Voice rules in Step 3. `motivation` and `outcome` especially: state the
situation someone was living with and the behaviour that replaced it, not the benefit.

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
          "severity": "medium",
          "lineRefs": [
            { "filePath": "path/to/file.ts", "side": "additions", "startLine": 50, "endLine": 55 }
          ]
        }
      ],
      "excerpts": [
        {
          "filePath": "path/to/caller.ts",
          "startLine": 88,
          "endLine": 96,
          "caption": "Why the reviewer is being shown this."
        }
      ]
    }
  ]
}
EOF
```

Field constraints: `order` is a positive 1-indexed integer; `hunkRefs[].oldStart` is a non-negative
integer copied from `hunks.txt`, and the array is empty only for an interlude; every
`keyChanges[].severity` is `critical`, `high`, `medium`, or `info`; every `keyChanges[].lineRefs`
has ≥ 1 entry with positive `startLine ≤ endLine`. `excerpts` is optional and defaults to empty —
each entry needs a `filePath` and positive new-side `startLine ≤ endLine`, with an optional
non-empty `caption` and no code of its own. `role` is
optional, is only ever `"epilogue"`, and belongs to the last chapter of a run that supersedes a
narrated one; `threadRefs` is optional and holds ids of threads this run has. `prologue`
is optional, so the minimal skeleton omits it. When included, obey
Step 4’s key-change and focus-area cardinalities. See `examples/sample-run/chapters.json` for a full
valid example and `packages/types/src/` for the authoritative zod schema.

## Step 6 — Freeze the code the narration quotes

Skip this step only when no chapter has an `excerpts` entry. Otherwise run it after writing
`chapters.json` and before validating, and re-run it after any edit to a chapter's `excerpts`:

```bash
revue context freeze "$RUN"
```

Freeze resolves every citation against the run's own recorded endpoint and pins the quoted lines
into `context.json` beside `chapters.json`. This is what turns a citation into text the reviewer
can read — validation in Step 7 rejects any citation that has no frozen content, so skipping this
step fails the review, and hand-writing `context.json` is never the answer.

If a citation cannot be resolved — the line range runs past the end of the file, the endpoint has
no file at that path, the file is binary — freeze names the range and exits non-zero. Fix the
citation in `chapters.json` and freeze again.

## Step 7 — Validate, then hand over

```bash
revue show "$RUN" --check
```

`--check` verifies the run hashes, validates `chapters.json`, requires every prepared review unit
exactly once, checks key-change
ranges against their chapter hunks, confirms every excerpt was frozen in Step 6, requires exactly
one epilogue ending the narration of a run that carried chapters forward, holds that epilogue's
thread citations to threads the run has, and prints a plain-text summary without launching the UI.
A run with no `chapters.json` opens as a flat file-by-file diff rather than erroring — so a missing
chapters file is not caught here; confirm Step 5 wrote it before treating a flat display as
intentional.

The reviewer is a full-screen TUI. Never run it inside the agent's own process, through the
shell tool, or through an inline-shell prefix such as Claude Code's `!`. Once `--check` passes,
choose one of these handoff paths:

- If the host provides a documented way to create a real interactive terminal, use it to run
  `revue show <run-directory>` in the current worktree. Orca is one such host. Do not guess a host
  command or treat the agent's shell tool as an interactive terminal.
- Otherwise, give the user the exact command to run in their terminal:

  ```
  revue show <run-directory>
  ```

Show accepts `--theme <name>`, `--theme auto`, `--theme list`, and `--transparent-bg`. Without a
flag, it uses the reviewer's remembered theme.

## Step 8 — Responding to review feedback

The user says "I added comments", "check the threads", "deal with my review feedback", "I've left
you notes on the revue", asks what is still outstanding on a review, or sends the wake-up prompt
Revue delivers on Send: Review feedback is waiting in revue: run `revue status --json` and follow
the revue skill's "Responding to review feedback" step. That is this step. The review already
exists, so never start it by preparing a fresh run: that discards the narration the reviewer has
been reading and the marks recording how far they got.

One pass answers everything at once — orient, read every thread, make the changes you agree with,
reply to all of them, report in chat, and regenerate the review a single time at the end.

### Orient from disk

Never work from what you remember of an earlier conversation. A review runs across compactions, new
sessions and days, and everything you need is on disk:

```bash
revue status --json
```

Status reports the repository's own review state. `activeRun` is the newest narrated run, with its
directory, scope, and the `prepArgs` that reproduce that scope when possible. A PR run has null
`prepArgs` because its recorded head label is not a reusable Git ref. `pendingRun` is a newer run
that supersedes the active run and has no narration yet, with counts of what its delta carried,
marked stale, and left to narrate. `threads` counts the open threads, split into those **awaiting the agent** (a human spoke
last) and those **awaiting the reviewer** (an agent did), plus dealt-with and orphaned. `drift` says
whether re-prepping that scope would now capture different code than the run pinned. Without
`--json` the same state prints for a human; a repository with no runs says so and exits 0.

`handoff` is the reviewer's last batch of feedback, if any: its `threadIds` are the batch they
sent, and `resolvedThreadIds` are the ones still findable on the run this report describes — a
thread the reviewer deleted after sending is in the first list and not the second. When told to
wait for the next round, block for it instead of polling:

```bash
revue status --wait --since <handoffId>
```

That returns as soon as a handoff whose id differs from `<handoffId>` lands, printing the same
report. `revue status --wait` on its own returns the handoff already on disk, so a session that
starts cold never waits through a batch it has not read; once a batch is handled, pass its
`handoffId` as `--since` to wait for the next one. It gives up after 15 minutes by default
(`--timeout-ms` to change that) and exits with code 3 on timeout.

A damaged handoff or agent-origin record reads as absent rather than stopping orientation; `status`
lists it in `warnings` instead.

`revue prep` and `revue threads reply` each record this session's Orca pane in `.revue/agent.json`
once they succeed, so the reviewer's next Send reaches this terminal rather than another one. The
record follows whichever of the two commands ran last. Outside Orca neither command writes
anything, and the reviewer pastes the wake-up prompt into your terminal by hand.

Work against the directory status prints for `pendingRun` when there is one, and the `activeRun`
directory otherwise. Prep moves the conversation onto the newest run, so that is where the threads
are.

```bash
RUN=<the run directory status printed>
revue threads list "$RUN" --json
```

Each thread carries a stable id, its exact path/review-unit/side/range anchor, an `open` or
`dealt-with` status, and ordered messages — each with its own id, multi-line body, creation time,
and `human` or `agent` author. Add `--all` when dealt-with history matters. Read threads only
through this interface: do not scrape the TUI's output, and never read or edit `.revue/threads.json`
yourself.

A `pendingRun` is unfinished narration rather than a new starting point. Its delta is recorded and
the threads have already moved onto it, so finish narrating that run — from *Read the worklist*
below — instead of preparing another one.

### Read every thread before changing anything

Read all of them first: the anchor, the whole message history, and the code each one points at. A
later comment often withdraws or reframes an earlier one, and a fix made before you have read the
rest gets made twice.

Answer the threads awaiting the agent. One awaiting the reviewer already has your answer — leave it
alone unless a new message has arrived on it. A thread the list reports as **orphaned** is anchored
to code this run no longer has; answer it like any other and say in the chat report that the code it
was written against is gone.

### Triage each thread into one of three lanes

Judge every comment on its merits, the way a colleague would. A review comment is an argument, not a
work order.

**Clear, and you agree.** Make the change, then reply on the thread describing it. The reviewer
reads the reply beside the code, so name what moved and why that answers them, not that you
complied.

**Clear, and you disagree.** Change nothing. Reply with the counter-argument: what the comment
assumes, what following it would cost, what you would do instead. Then raise it in the chat report
as needing the user's decision. Making a change you believe is wrong buries the disagreement, and
making none without saying so loses it.

**Ambiguous, a question, or an opinion.** Reply with the answer, or with your reading of the comment
and what you would do about it. Then ask in chat whether they want that change. Do not guess at a
change, and do not leave the thread silent while you wait for the answer.

### Reply on every thread, and close none

Every lane ends in a reply. A thread you left unanswered reads as one you never saw.

```bash
revue threads reply "$RUN" <thread-id> \
  --author "revue agent" \
  --body "The retry cap is 5s now, and the interactive path stays inside its budget."
```

Identify yourself with a stable, human-readable role name; never impersonate the repository's Git
user. `--body-file <path|->` takes a multi-line body. The reviewer's open TUI shows each reply as it
lands, so write one considered reply per thread rather than a running commentary.

**Never mark a thread dealt-with.** A resolved thread means the reviewer checked the fix, so
resolving one is theirs to do, from their own reader. `revue threads mark-dealt` and `revue threads
reopen` exist for them, not for you, and this holds for a question you answered outright as much as
for a fix. An open thread whose last message is yours is exactly how they see "ready to check".

### Report the pass in chat

Finish with one message to the user: what you fixed, where you pushed back, and what needs their
call, with the open questions numbered so they can answer by number.

```
Fixed 4, pushed back on 2, 3 need your call.

Fixed: retry cap, the org-id thread on api.ts, two naming comments.
Pushed back: the suggested cache (it breaks the multi-org invariant) and moving the
guard into the caller.

Your call:
1. Should retryCount reset when the user switches orgs?
2. …
```

Chat and threads must tell the same story — a reviewer who reads only one of the two cannot end up
with a different picture of what happened.

### Regenerate the review, once, at the end of the pass

If the pass changed no code — every thread answered, nothing edited — stop here. There is nothing to
re-narrate, and prepping a run to prove it only hands the reviewer a superseding run to reload for
no reason.

Otherwise regenerate once for the whole pass, never once per fix: the reviewer gets one coherent run
describing where the code ended up, instead of a stream of half-answered ones.

Whether the fixes have to be committed first is a question of scope, not of policy. A working-tree
scope (bare prep on local changes, `--ref work`, `--ref unstaged`) picks an edit up as soon as it is
saved; `--ref staged` needs it staged; a committed scope (`main`, `main..feature`, `--pr`) sees it
only once it is committed on the reviewed branch. Whether and when to commit is the user's call and
the repository's convention — this skill takes no position on it. Read the active run's scope from
`revue status` and make sure the code you changed is inside that scope before re-prepping.

**1. Re-prep the same scope.** Pass non-null `prepArgs` from status verbatim:

```bash
RUN=$(revue prep --ref work --base master)   # whatever prepArgs status printed
```

A PR run has null `prepArgs`. Re-run it with the original PR number or URL and the recorded base:

```bash
RUN=$(revue prep --pr 123 --base main)
RUN=$(revue prep --pr https://github.com/owner/repo/pull/123 --base main)
```

For an origin PR, `scope.head` uses `pull/<number>/head`. For an external PR, it uses
`<owner>/<repo>#<number>`. Use that label to recover the original number or URL. Do not treat the
label itself as a Git ref.

Lineage is automatic: prep finds the narrated run of that scope, records the supersession, carries
the untouched chapters forward, moves the threads across, and prints the three supersession lines
from Step 1. If it prints none, the scope did not match and you have begun a fresh review — fix the
arguments rather than narrating a run with no lineage.

**2. Read the worklist.**

```bash
revue delta "$RUN"
```

Three keys of JSON. `carried`: whole chapter objects, hunk references and key-change ranges already
re-mapped onto this run. `stale`: the chapters whose code changed, each with the reason it went
stale. `unnarrated`: every review unit no carried chapter covers, marked `unchanged`, `modified`, or
`new` against the run this one supersedes. Read `$RUN/hunks.txt` for the units you have to narrate,
exactly as in Step 2 — the references you cite come from this run's file, never the old one.

**3. Copy the carried chapters in verbatim.** Field for field, `order` included. Read marks carry
over only for chapters that come through byte-identical, so touching up a summary costs the reviewer
a chapter they had already finished, for nothing.

**4. Re-narrate every stale chapter in place.** Keep its id and its place in the order, and rewrite
the summary against this run's hunks so it describes the code as it now stands. Never amend around
the old text ("this now also handles…") — a stale chapter is rewritten, not patched. When the delta
marks most of the narration stale, the change was structural: rewrite it as if narrating afresh,
and say so in the epilogue.

**5. Narrate what is left.** Every unit in `unnarrated` belongs in exactly one chapter: the
re-narrated chapter that owns its file where there is one, and the epilogue otherwise. The coverage
rule in Step 3 is unchanged — every review unit of the new run appears exactly once,
carried chapters counting towards it.

**6. Write the epilogue last.** A run that carried narration forward ends with exactly one chapter
marked `"role": "epilogue"`, and it is where the reviewer's reload lands:

```json
{
  "id": "epilogue",
  "order": 7,
  "role": "epilogue",
  "title": "Changes since your review",
  "summary": "div throws on a zero divisor rather than returning Infinity…",
  "hunkRefs": [{ "filePath": "src/maths.ts", "oldStart": 12 }],
  "keyChanges": [],
  "threadRefs": ["1f0bd6c4-2f8e-4a35-8a4b-6f2a6a9c1f77"]
}
```

Write it for someone who read the previous run and wants to know what moved. After a localised fix
it narrates the fix hunks and cites in `threadRefs` the threads that prompted them, by id, which the
reviewer follows as links into those conversations. After a structural rework it needs no hunks of
its own: it shrinks to an orientation note naming the chapters that were rewritten and the order to
re-read them in. Say what changed and why it changed, not that the feedback has been addressed. Cite
only threads this run has — `--check` rejects an id the run does not hold, and threads move with the
run, so list them against `$RUN` rather than trusting an id from earlier in the pass.

**7. Freeze, then validate.** Freeze whenever any chapter in the file cites excerpts; prep already
re-froze the carried ones, and freezing again re-resolves the lot against this run:

```bash
revue context freeze "$RUN"
revue show "$RUN" --check
```

`--check` applies everything in Step 7, and the epilogue rules on top.

**8. Hand it over.** If the reviewer still has the previous run open, Revue raises a banner the
moment the new run validates, and their reload key opens it on the epilogue with their carried
progress intact — tell them it is ready rather than telling them to restart anything. Otherwise give
them the `revue show <run-directory>` command for the new run, as in Step 7.

### Threads you start yourself

An agent may start a new visible thread when it has concrete anchored feedback. Copy the exact
review-unit identity and line range from the prepared run rather than inventing an anchor:

```bash
revue threads create "$RUN" \
  --file src/value.ts --old-start 4 --side additions --start-line 8 --end-line 10 \
  --author "review agent" --body-file -
```

That is the default `--kind hunk` anchor, on a pinned review unit. Feedback on code a chapter
quoted rather than changed uses an excerpt anchor instead, which names no review unit and no side —
just the file and the line range, matching a range some frozen excerpt covers:

```bash
revue threads create "$RUN" --kind excerpt \
  --file src/orders.ts --start-line 88 --end-line 96 \
  --author "review agent" --body-file -
```

### Deleting feedback

Hard deletion is only for a thread or reply the reviewer identifies as erroneous. Never delete
feedback merely because it is difficult, already addressed, or disagreed with:

```bash
revue threads delete-message "$RUN" <thread-id> <message-id>
revue threads delete "$RUN" <thread-id>
```

All operations re-verify the supplied run and pinned anchors without recomputing Git scope. Relay an
actionable validation error instead of guessing a replacement anchor. `revue comments` is only a
compatibility command alias; use the official `threads` API.

## Configuring keybindings

If the user asks to remap a shortcut, do it by editing `~/.revue/keybindings.json` — never by
patching Revue's source. The file is JSONC (`//` and `/* */` comments are stripped before
parsing) and holds a flat object of `"action-id": "key"` or `"action-id": ["key", "key"]` entries.
An entry **replaces** that action's full default key list; it does not add to it.

Discover the current action IDs and bindings before writing anything — the defaults can change,
so never guess or restate them from memory:

```bash
revue keybindings          # every action, its description, default keys, and effective keys
revue keybindings init     # writes a commented starter template to ~/.revue/keybindings.json
```

`init` refuses to overwrite an existing file unless `--force` is passed. Starting from its output
(uncomment and edit the relevant lines) is more reliable than writing the file from scratch.

Key grammar for a value:

- lowercase named keys: `up`, `down`, `left`, `right`, `pageup`, `pagedown`, `home`, `end`,
  `insert`, `delete`, `backspace`, `return`, `tab`, `space`, `f1`–`f12`
- `ctrl+` prefix over a lowercase letter or named key: `ctrl+d`, `ctrl+f10`
- a single-character literal for the character produced: `j`, `?`, `{`
- an uppercase letter for a shifted character: `G` (not `shift+g` — Revue expands the alias itself)
- `shift+` prefix only over a named/special key: `shift+tab`

Reserved, never valid in a value: `escape` and the digits `1`–`9` (direct key-change shortcuts).
The raw `[` and `]` characters are ordinary bindable keys. Page navigation can be remapped like
any other action.

Validation is lenient and per-entry: a malformed file (bad JSON) falls back to the full defaults
with one warning; within a well-formed file, an unknown action id, an invalid key, a reserved key,
or a key that collides with another binding in the same context drops just that entry — every
other entry in the file still applies. Dropped entries and their reasons show up in `revue
keybindings`'s output and in the TUI's footer/help overlay, so re-run `revue keybindings` after
editing to confirm the file did what was intended.

## Configuring themes

If the user asks for a custom theme, do it by creating or editing a file under
`~/.revue/themes/` — never by patching Revue's source. Each file is named `<id>.json` (the id is
the filename minus `.json`) and is JSONC, same comment-stripping rules as keybindings.

Discover the current bundled and custom themes, and any issues in existing files, before writing
anything:

```bash
revue themes               # bundled + custom themes, grouped by appearance, plus any issues
revue themes init <name>   # writes a commented starter template to ~/.revue/themes/<name>.json
```

`init` refuses to overwrite an existing file unless `--force` is passed. Starting from its output
is more reliable than writing the file from scratch.

Grammar for a theme file:

- `extends` — the id of a bundled theme to derive from (`revue themes` lists them)
- `label`, `background`, `foreground` — `background` is required unless `extends` is set; any of
  these may still be set alongside `extends` to override just that input before deriving
- `diffColors.added`/`removed`/`modified` — optional, fall back per key to the `extends` base's
  diff colours, then the derived defaults
- `syntaxTheme` — the id of a bundled Shiki theme; falls back to the derived default
- `overrides` — pins specific colour slots verbatim on the derived theme (slot names from the
  `revue themes init` template); no contrast policing on pinned values

Colours are `#rgb` or `#rrggbb`. A file whose id matches a bundled theme shadows it in place
(shown once, marked "customised" in `revue themes`); any other id is appended as a new theme.

Validation is lenient and per-file: a malformed file, a missing `background`/`extends`, or an
unknown `extends` drops the whole theme; a bad colour, syntax theme, or override slot drops just
that key and falls back to the `extends` base where one exists. Dropped entries and their reasons
show up in `revue themes`'s output and the TUI's footer/help overlay — re-run `revue themes` after
editing to confirm the file did what was intended. Themes are read once at startup, so changes
take effect on the next launch.
