# ADR 0014 — Narrative depth, frozen context excerpts, and excerpt anchors

- Status: accepted
- Date: 2026-08-07
- Extends: [ADR 0003](0003-prep-owns-review-scope.md),
  [ADR 0004](0004-store-threads-by-immutable-run.md),
  [ADR 0007](0007-synthesised-patches-and-anchor-authority.md)

## Context

A narration could point only at changed lines. It also had to point at each changed line exactly one
time. Three needs are outside that shape:

- A chapter could not show the code that a change must fit into. The reviewer read a modified
  function, but did not see the caller that constrains it.
- A chapter could not say anything that was not about one hunk, because a chapter was only a group
  of hunks.
- The narration was complete or absent. Thus a large diff gave a long story at one depth, and the
  reviewer could not ask for its shape first.

A careless relaxation of these rules loses the guarantee that ADR 0003 gives. The coverage
validation stops an agent that leaves hunks out of a review that claims to be complete. ADR 0007
made the anchor authority invariant, thus feedback cannot depend on the view that the reviewer used.

## Decision

This decision **extends** ADRs 0003, 0004 and 0007. All three stay correct in substance. Each one
gets a pointer line. Each one also gets a narrow qualifier where its words are now too broad. This
is the first extension in the repository, and the only earlier precedent is supersession (ADR 0002
above ADR 0001). The choice of an extension is deliberate, because nothing below reverses an earlier
decision.

**A narrative declares its depth, and the strictness of the coverage follows that declaration.** The
chapters file carries an optional depth for the whole file. The depth is `full`, or `partial` with
the label that the reviewer sees. That label is the `10,000ft` preset, or free words for a bespoke
request. If the file declares no depth, the depth is `full`. Thus every chapters file from before
this decision keeps its exact meaning.

At full depth the coverage validator does what it always did: every prepared review unit appears in
exactly one chapter. Only an explicitly partial depth can omit a unit. These stay errors at every
depth: a duplicate unit, an unknown unit, an unknown file, and a key-change range outside the pinned
hunks of its chapter. The reviewer can still reach what a partial narrative omits, through the Files
surface. `revue show --check` reports the count of the narrated units and the count of the prepared
units for every run. Thus an agent can confirm what it produced.

**A chapter with no hunks is an interlude. Revue infers this rather than flags it.** An empty
`hunkRefs` *is* the interlude. There is no `kind` field, because a field and a hunk list can
disagree, and then one of the two must win.

**A chapter cites unchanged code, and Revue freezes that code.** A chapter carries excerpt
citations. Each citation has a file path, an inclusive line range on the new side, and an optional
caption. A citation has no text. The agent writes the chapters file, then runs `revue context
freeze` one time. The command resolves every citation against the recorded new endpoint of the run,
through the existing snapshot reader of prep. The command pins the resulting lines, and the digest
of the source file, into `context.json`.

A citation can name a file outside the diff. If a citation has no frozen content, the validation
fails and gives the exact invocation of the freeze command.

**The frozen context belongs to the narration side.** `context.json` lives inside the run directory,
as `chapters.json` does, and the run ID excludes both files. Thus a freeze of a narrative can never
invalidate the prepared code that the narrative describes. Under an endpoint backed by a worktree,
the freeze verifies every cited file again against the content that prep captured. The freeze
refuses to pin a file that moved, as prep does in its own race check.

**Quoted code gets a second kind of anchor.** A thread anchor is now one of two kinds:

- a `hunk` anchor of `(filePath, oldStart, side, startLine, endLine)`, unchanged;
- an `excerpt` anchor of `(filePath, startLine, endLine)`, keyed to the run ID. Revue resolves an
  excerpt anchor against the frozen context, not against the patch.

An excerpt anchor carries no `oldStart` and no `side`, and this is deliberate. `oldStart: 0` is
already the sentinel of the metadata review unit. If an excerpt took that sentinel, a reader could
not tell it from a thread on a file with no textual hunk.

The two kinds fail in different ways. A hunk anchor that no longer resolves is corruption. It still
blocks the display, the export, and the agent listing. An excerpt anchor that the frozen context no
longer covers is **orphaned**.

Revue keeps an orphaned anchor in the store and lists it as orphaned. Revue never renders it inline,
and Revue never prunes it. A new narration of a run at another depth can correctly drop a citation.
That act is normal, and the store is not corrupt.

This extends the anchor authority of ADR 0007; it does not replace it. A hunk anchor still resolves
against the original git hunks in every view. An excerpt that the narration cites is a second
authority, because it is pinned narration. The *ad hoc* GitHub-style context expansion still refuses
comments, because its revealed lines are not pinned narration.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Embed the quoted excerpt text in the narration | Rejected | It shows the reviewer code from an LLM as the truth of the repository. |
| Restrict citations to files already in the diff | Rejected | It prevents a quote of the untouched caller that a change must satisfy, and that case is the motive for this decision. |
| Relax coverage unconditionally | Rejected | It lets an agent drop hunks from a review that claims to be complete, and give no message. |
| Mark interludes with a `kind` field on the chapter | Rejected | A field and a hunk list can disagree. The empty hunk list already gives the fact. |
| Reuse the hunk anchor for excerpts with `oldStart: 0` | Rejected | It collides with the sentinel of the metadata review unit, and then a reader cannot tell the two apart. |
| Prune or hard-fail unresolvable excerpt anchors | Rejected | It makes a new narration destructive, but a new narration is a normal act. |
| Include frozen context in the run ID | Rejected | The freeze then invalidates the prepared run that it describes. |
| Declared depth, CLI-frozen citations, and a second anchor kind | Chosen | It gives narration at a distance and quoted context. It does not relax the default case, and it does not split the anchor authority. |

## Consequences

- The strictness of the coverage is now a function of the declared depth. The default and every
  historical chapters file keep the exact guarantee that ADR 0003 recorded. Only a narrative that
  declares itself partial can spend that guarantee.
- The run directory holds a second artifact on the narration side that the run ID excludes.
  `context.json` joins `chapters.json` outside the hash, and both files stay optional.
- There are two classes of comment anchor, and they fail in different ways. A caller of the thread
  validation must handle an orphan list and a thrown store error. The Comments surface and the
  markdown export both have a place for orphaned feedback.
- **Revue cannot detect drift for every cited file.** Under an endpoint backed by a worktree, a
  cited file that is not in the run manifest has no snapshot from prep for a comparison. The freeze
  pins the file, records its digest, and warns that it did not check the content. A committed
  endpoint has no such gap.
- The fold state of an excerpt is session state, not run state. An excerpt adds nothing to the
  review progress: no gauge, no file count, and no checkbox.
- Extension is now a recorded convention here, with supersession. An ADR that qualifies another ADR,
  and does not reverse it, writes `Extends:` in its header. It also adds a pointer with a date under
  the `## Amendments` heading of the amended ADR.

## Amendments

- 2026-08-20 — Narrative depth is removed from the product. A chapters file declares no `depth`,
  and every narration owes every prepared review unit exactly once again. The frozen context
  excerpts and excerpt anchors this ADR also introduced are unaffected and remain current.
