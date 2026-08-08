# ADR 0014 — Narrative depth, frozen context excerpts, and excerpt anchors

- Status: accepted
- Date: 2026-08-07
- Extends: [ADR 0003](0003-prep-owns-review-scope.md),
  [ADR 0004](0004-store-threads-by-immutable-run.md),
  [ADR 0007](0007-synthesised-patches-and-anchor-authority.md)

## Context

Narration could only ever point at changed lines, and had to point at every one of them exactly
once. Three needs fell outside that shape.

A chapter could not show the code a change has to fit into: the reviewer read a modified function
with no sight of the caller constraining it. A chapter could not say anything that was not about a
specific hunk, because a chapter was a group of hunks and nothing else. And the narration was
all-or-nothing, so a large diff produced a long story at uniform depth with no way for a reviewer to
ask for its shape first.

Relaxing any of this naively costs the guarantee ADR 0003 exists for. Coverage validation is what
stops an agent quietly leaving hunks out of a review that presents itself as complete, and ADR 0007
made anchor authority invariant precisely so feedback could not depend on how the reviewer happened
to be looking.

## Decision

This decision **extends** ADRs 0003, 0004 and 0007. All three remain correct in substance: each
gains a pointer line and, where its wording is now too broad, a narrow qualifier. This is the
repository's first extension — its only prior precedent is supersession (ADR 0002 over ADR 0001) —
and an extension is chosen deliberately, because nothing below reverses an earlier decision.

**A narrative declares its depth, and coverage strictness keys on that declaration.** The chapters
file carries an optional file-level depth: `full`, or `partial` with the label the reviewer sees —
the `10,000ft` preset, or freeform words for a bespoke request. An absent declaration means `full`,
so every chapters file written before this decision keeps its exact meaning. At full depth the
coverage validator behaves as it always has: every prepared review unit appears in exactly one
chapter. Only an explicitly partial depth may omit units. Duplicate units, unknown units, unknown
files, and key-change ranges outside their chapter's pinned hunks stay errors at every depth. What
a partial narrative omits stays reachable through the Files surface, and `revue show --check`
reports narrated and prepared unit counts for every run so an agent can confirm what it produced.

**A chapter with no hunks is an interlude, inferred rather than flagged.** An empty `hunkRefs` *is*
the interlude. There is no `kind` field, because a field and a hunk list can contradict each other
and one of them would have to win.

**Chapters cite unchanged code; Revue freezes it.** A chapter carries excerpt citations of file
path, inclusive new-side line range, and optional caption — and no text. `revue context freeze`, run
once after the agent writes the chapters file, resolves every citation against the run's own
recorded new endpoint through prep's existing snapshot reader and pins the resulting lines, with the
source file's digest, into `context.json`. A citation may name a file outside the diff. Validation
fails with the freeze command's exact invocation when a citation has no frozen content.

**Frozen context is narration-side.** Like `chapters.json`, `context.json` lives inside the run
directory and is excluded from the run ID, so freezing a narrative can never invalidate the prepared
code it narrates. Under a worktree-backed endpoint freeze re-verifies every cited file against what
prep captured and refuses to pin a moved file, mirroring prep's own race check.

**Quoted code takes a second anchor kind.** A thread anchor is now either a `hunk` anchor —
`(filePath, oldStart, side, startLine, endLine)`, unchanged — or an `excerpt` anchor of
`(filePath, startLine, endLine)`, keyed to the run ID and resolved against the frozen context rather
than the patch. An excerpt anchor deliberately carries no `oldStart` and no `side`: `oldStart: 0` is
already the metadata review unit's sentinel, and an excerpt borrowing it would be indistinguishable
from a thread on a file with no textual hunk.

The two kinds fail differently. A hunk anchor that no longer resolves is corruption and still blocks
display, export, and agent listing. An excerpt anchor the frozen context no longer covers is
**orphaned**: kept in the store, listed as orphaned, and never rendered inline or pruned.
Re-narrating a run at another depth legitimately drops a citation, and that is a normal act rather
than a corrupt store.

This extends ADR 0007's anchor authority rather than replacing it. Hunk anchors still resolve
against the original git hunks in every view. Narration-cited excerpts are a second authority
because they are pinned narration; *ad hoc* GitHub-style context expansion still refuses comments,
because revealed lines are not.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Embed the quoted excerpt text in the narration | Rejected | Shows reviewers LLM-produced code presented as repository truth. |
| Restrict citations to files already in the diff | Rejected | Rules out quoting the untouched caller a change has to satisfy, which is the motivating case. |
| Relax coverage unconditionally | Rejected | Would let an agent silently drop hunks from a review claiming to be complete. |
| Mark interludes with a `kind` field on the chapter | Rejected | A field and a hunk list can contradict each other; the empty hunk list already says it. |
| Reuse the hunk anchor for excerpts with `oldStart: 0` | Rejected | Collides with the metadata review unit's sentinel, so the two become indistinguishable. |
| Prune or hard-fail unresolvable excerpt anchors | Rejected | Makes re-narrating destructive, when it is a normal act. |
| Include frozen context in the run ID | Rejected | Freezing would invalidate the prepared run it describes. |
| Declared depth, CLI-frozen citations, and a second anchor kind | Chosen | Buys zoomed-out narration and quoted context without loosening the default case or forking anchor authority. |

## Consequences

- Coverage strictness is now a function of declared depth. The default and every historical chapters
  file keep the exact guarantee ADR 0003 recorded; only a narrative that says out loud it is partial
  can spend it.
- The run directory holds a second narration-side artifact excluded from the run ID. `context.json`
  joins `chapters.json` outside the hash, and both remain optional.
- There are two classes of comment anchor with different failure semantics. Callers of thread
  validation must handle an orphan list as well as a thrown store error, and the Comments surface
  and markdown export both have somewhere to put orphaned feedback.
- **Drift cannot be detected for every cited file.** Under a worktree-backed endpoint, a cited file
  that is not in the run manifest has no prep-captured snapshot to compare against. Freezing pins it
  anyway, records its digest, and warns that its content went unchecked. A committed endpoint has no
  such gap.
- Excerpt fold state is session state, not run state, and excerpts contribute nothing to review
  progress — no gauge, no file count, no checkbox.
- Extension is now a recorded convention here alongside supersession. An ADR that qualifies another
  without reversing it states `Extends:` in its header and adds a dated pointer under the amended
  ADR's `## Amendments`.
