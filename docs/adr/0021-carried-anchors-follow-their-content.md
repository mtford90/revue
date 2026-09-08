# ADR 0021 — Carried anchors follow their content

- Status: accepted
- Date: 2026-09-04
- Extends: [ADR 0018](0018-feedback-conversation-across-supersession.md), [ADR 0020](0020-file-scoped-patch-selections.md)

## Current amendment — 2026-09-08

The approved feedback-loop iteration replaces the mapping decision below. The earlier rationale is
historical: keeping replacement code because its frame survived is no longer acceptable.

- Hunk, patch and context anchors require exact text with one occurrence in both pinned files on
  the same side. No frame fallback, nearest duplicate or unchanged-unit shortcut. All patch ranges
  must map into the new patch, or the thread detaches atomically. Prep detachment is sticky.
- Optional version-2 `originalEvidence: { runId, anchor, lines: string[][] }` records source run,
  original anchor and actual code per range. Capture at creation or first migration of never-carried
  historical feedback; never infer it for already-carried legacy threads. Those threads are unverified
  and non-inline on load even when their coordinates fit. Validate range/line counts; uncarried
  evidence must match the thread's run and anchor, and carried evidence must retain its kind and path.
  Older stores remain readable; older binaries may reject new writes.
- Comments shows selected detached feedback's original code; JSON listing includes evidence and
  availability. Preserve raw code in storage and sanitise terminal display. No second patch renderer.
- Excerpts need unchanged, unambiguous frozen destination coverage before rendering inline. Missing
  narration is derived unverified state, not sticky detachment. Freeze reconciles carried excerpts
  under the thread-store lock: persist changed/ambiguous evidence from the previous or replacement
  context before replacing it, then publish uniquely unchanged destination coordinates. This also
  follows quotations moving outside the pinned patch; missing coverage stays unresolved. Prep reads
  the latest contexts under the same lock. Destination pinned blobs can establish a unique location
  before freezing; overlapping quotations count one physical occurrence. Reads never write.

## Historical context

[ADR 0018](0018-feedback-conversation-across-supersession.md) re-maps a carried anchor with the run delta's unit match: an unchanged unit shifts the anchor exactly, a modified unit keeps the offset the reviewer commented at, and only a unit the new run has lost orphans the thread.

Keeping the offset assumes a modified unit is the same code, edited. A review unit is a diff hunk, and a hunk can be hundreds of lines. When an agent answers feedback by deleting the code it was about, the surrounding hunk survives with the same `oldStart`, the offset arithmetic succeeds, and the thread lands on whatever moved up into those line numbers.

That is what happened in practice. A reviewer commented on a fourteen-line method inside a two-hundred-line added block. The agent merged the method into another one. The next run re-anchored the thread onto fourteen lines of an unrelated method's doc comment, and the TUI showed the comment sitting over code it had never been about.

An anchor pointing at the wrong code is worse than an anchor pointing at nothing. The reviewer cannot tell the difference by looking, and the agent answering the thread reads the wrong lines as the subject.

## Decision

### Content decides, position only corroborates

Prep re-maps a carried `hunk` or `patch` anchor in this order, inside the unit the delta matched:

1. A unit classified **unchanged** shifts exactly. Its content is identical by signature, so no comparison is needed.
2. In a **modified** unit, the shifted range is taken only when it holds the same lines the anchor was written on.
3. Failing that, the shifted range is taken when the lines immediately framing it came through untouched. That is the signal of an edit in place: the fix rewrote the very lines the comment was left on, which is the case ADR 0018 was right to follow. It is tried before a file-wide search because duplicate lines are common and a coincidence elsewhere must not outrank the position the fix was made at.
4. Failing that, the same lines are looked for everywhere else in the file, on the same side, and the anchor moves to the occurrence nearest where it pointed. This is what follows code that moved between hunks.
5. Otherwise the code is gone. The anchor keeps the range it was written against and the thread is marked **orphaned**.

### Orphaning is preferred to a plausible guess

A carried thread whose code the run does not have is listed, shown, and never pruned, as in ADR 0018. It gains no inline presence in the diff, so it cannot decorate lines it has nothing to say about. The mark is sticky: a later run whose coordinates happen to fit again does not revive it.

### Hunk anchors orphan the same way as patch anchors

`migrationOrphaned` previously applied only to a `patch` anchor whose ranges could not all be re-mapped. It now applies to any migrated non-excerpt anchor. An excerpt anchor is still never marked in the store: it orphans against the frozen context at load, where it always has.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Keep the offset in a modified unit | Rejected | The reported fault. A hunk is not small enough for position to stand in for identity. |
| Align the unit's old and new lines and map through the alignment | Rejected | On the reported case an LCS pairs the anchored block's generic tail — a brace, a blank line — with unrelated code and re-anchors onto it. A partial survival reads as a match. |
| Content match, else orphan, with no frame rule | Rejected | Orphans the thread whenever the fix rewrote the very lines it was about, which is the common and desirable case ADR 0018 follows. |
| Content first, frame corroborates an in-place edit, else orphan | Chosen | Follows code that moved, follows a fix that rewrote it, and detaches when it is gone. |
| Fuzzy similarity threshold between old and new lines | Rejected | A tuned number nobody can predict from the outside, and it still guesses when it is wrong. |

## Consequences

- A thread whose code the agent deleted reads as detached in the TUI (`· code removed`) instead of pointing at a stranger's lines.
- A thread whose code moved elsewhere in the file now follows it, which the unit-local rule could not do.
- Re-mapping reads both runs' patches rather than the delta alone, since the anchored text comes from the predecessor.
- `revue status` counts these threads among the anchors the run orphaned, as it already did for the patch-anchor case.
