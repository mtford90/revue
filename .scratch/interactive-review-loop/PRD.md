# PRD: Interactive review loop

Status: ready-for-agent

## Problem Statement

A revue is now an artifact for one pass. The reviewer reads the narrated chapters, leaves threads,
and tells the agent about them. After that point the workflow becomes worse:

- The guidance for the agent on the handling of feedback is thin.
- Any code change makes a completely new run with no narration. That run loses every chapter and the
  read progress of the reviewer.
- The TUI sees a change only when the reviewer presses the reload key.

A review is iterative by nature. Revue supports only the first pass well.

## Solution

Make the review a conversation that continues. When the agent changes code, `revue prep` recognises
the new run as a continuation of the old run. Prep carries forward every chapter that the change did
not touch. Prep gives the agent a short worklist of the parts that need a new narration. An epilogue
chapter closes that worklist and tells the reviewer what changed since their review, and why.

The skill teaches the agent to triage the threads of the reviewer as a colleague does: fix, push
back, or ask. The agent replies inline and reports in the chat.

The TUI watches the run store and the thread store. A reply appears in place immediately. A
superseding run raises a banner, and one keypress then jumps to the epilogue. The whole loop works
cold: a new agent session finds everything again from disk with `revue status`.

## User Stories

1. As a reviewer, I want a new revue after the agent changes code, so that the narration always
   describes the code as it is now.
2. As a reviewer, I want a chapter that a change did not touch to survive the regeneration word for
   word, so that I do not read narration that I already absorbed.
3. As a reviewer, I want my read-progress marks kept on carried-forward chapters, so that a
   regeneration does not lose my place in the review.
4. As a reviewer, I want an epilogue chapter that lists what changed since my review and which
   threads caused each change, so that my second pass is short and targeted.
5. As a reviewer, I want a stale chapter narrated again rather than patched around, so that no
   chapter describes code that no longer exists.
6. As a reviewer, I want the epilogue to name the rewritten chapters to read again after a
   structural rework, so that I can orient myself quickly after a fundamental change.
7. As a reviewer, I want my open threads moved onto the superseding run with their anchors resolved
   again, so that my feedback follows the code and does not stay on a dead run.
8. As a reviewer, I want a thread whose anchored code was deleted shown as orphaned rather than
   pruned with no message, so that no feedback is ever lost.
9. As a reviewer, I want to be the person who marks a thread dealt-with, so that "dealt-with" means
   that I verified the fix, not that the agent claims it.
10. As a reviewer, I want the threads that await my verification (open, with the last message from
    the agent) sorted first in the Comments surface, so that I can see at once what is ready to
    check.
11. As a reviewer, I want an agent reply to appear in the TUI at the moment the agent writes it,
    with no layout shift and no loss of my position, so that the conversation feels live.
12. As a reviewer, I want a prominent banner when a superseding run is ready, rather than a TUI that
    switches under me, so that I change context at a moment of my choice.
13. As a reviewer, I want the reload key to put me on the epilogue of the superseding run, so that
    the summary of the changes is the first thing that I see after the reload.
14. As a reviewer, I want a comment that I add from a second terminal to appear in the running TUI,
    so that all thread edits behave in the same way.
15. As an agent, I want one orientation command that reports the active run, its scope, the open
    threads split by who they await, and the drift of the working tree, so that I can start a review
    cold after a compaction or in a new session.
16. As an agent, I want the CLI to classify every hunk of a superseding run as unchanged, modified,
    or new against the narrated predecessor, so that I never compare two hunk listings by eye.
17. As an agent, I want the carry-forward chapters copied into the superseding run in advance, with
    their hunk references mapped again, so that my work is editorial judgment, not anchor
    bookkeeping.
18. As an agent, I want a worklist of the stale chapters and the unnarrated hunks, so that I narrate
    again only what the change touched.
19. As an agent, I want the skill to teach a triage of reviewer threads in three lanes (agree → fix
    and reply; disagree → reply with a counter-argument and flag it in the chat; ambiguous → answer
    inline and ask in the chat), so that I respond as a colleague and do not do every comment
    blindly.
20. As an agent, I want to end each feedback pass with a chat report of what I fixed, where I pushed
    back, and what needs a decision from the reviewer, so that the reviewer knows the state without
    the TUI.
21. As an agent, I want to regenerate one time for each feedback pass and not for each fix, so that
    the reviewer gets one coherent superseding run instead of a stream of intermediate ones.
22. As an agent, I want to skip the regeneration completely when a pass changed no code, so that a
    pass with only replies costs nothing.
23. As an agent, I want the frozen context of a carried-forward excerpt resolved again against the
    superseding run automatically, so that a carried chapter never cites stale bytes.
24. As a maintainer of my own review flow, I want a human re-prep of the same scope to record the
    lineage automatically, so that a forgotten flag never orphans my threads.
25. As a maintainer of my own review flow, I want explicit overrides to force or to suppress the
    lineage on prep, so that I can start a genuinely fresh review of the same scope when I intend
    to.
26. As a reviewer, I want the validation to check the superseding run end to end (coverage, carried
    chapters, epilogue, migrated threads) before the banner appears, so that a reload never lands on
    a broken run.

## Implementation Decisions

- **Recorded lineage.** Prep finds the most recent narrated run with the same prep arguments. Prep
  records a `supersedes` reference in the metadata of the new run when it creates the run. Two
  overrides exist: an explicit carry-from flag, and a no-carry flag. Runs stay immutable, as the
  immutable-runs ADR requires. Prep writes the lineage one time at creation and never changes it.
- **CLI-computed delta.** The deterministic work lives in the CLI, not in the prose of the skill.
  That work is the hunk identity across runs, the staleness of a chapter, and the new map of an
  anchor. The delta does these tasks:
  - it classifies each hunk of the superseding run as unchanged, modified, or new;
  - it marks a chapter stale when any hunk that the chapter covers changed;
  - it copies each chapter that is not stale in advance, with a new map of the hunk references;
  - it reports a worklist for the agent.
- **Thread migration at prep time.** When a run supersedes another run, prep anchors the open
  threads of the predecessor onto the superseding run. A hunk anchor that no longer resolves falls
  back to the existing behaviour: orphaned, but listed. This is not corruption, because a
  supersession correctly deletes code.
- **Editorial rule (mechanical, not vibes).** The agent narrates a stale chapter again in place. A
  hunk that answers a thread, and that fits no existing chapter, goes into a "Changes since your
  review" epilogue. The epilogue is always present on a superseding run, and it is the designated
  point of re-entry. For a localised fix, the epilogue carries the narration of the fix with a link
  to the threads. For a structural rework, the epilogue becomes a short orientation note that names
  the rewritten chapters.
- **Reviewer closes threads.** The agent replies, but the agent never marks a thread dealt-with.
  This rule holds for every thread, also for an answered question. The awaiting-verification state
  is implicit: the thread is open, and the agent wrote the last message. The thread schema does not
  change.
- **Three-lane triage in the skill.** The three lanes are:
  - agree and clear → fix the code and reply inline;
  - disagree → give a counter-argument inline, and flag it in the chat;
  - ambiguous, or a question → answer inline, and ask in the chat.

  Each pass ends with a chat report. The skill states that the scope decides whether a change needs
  a commit before the change appears in a re-prep. The skill stays neutral on the decision to
  commit: the context and the preference of the user decide.
- **Batch regeneration.** Each feedback pass does one sequence: re-prep, delta, epilogue narration,
  context freeze, then validation. A pass with no code change skips the regeneration.
- **TUI watching.** A small module watches the filesystem with a debounce. The module emits two
  events: threads-changed and run-superseded. A thread change applies in place and shows no message.
  A superseding run shows a persistent banner, and the existing reload key changes the run and lands
  on the epilogue. The TUI never switches by itself. An auto-reload preference is possible later,
  but this work does not build it.
- **`revue status`.** An orientation command that emits JSON. It reports:
  - the active run, which is the most recent narrated run in the lineage chain;
  - the scope arguments of that run;
  - the counts of the open threads, split into awaiting-agent and awaiting-human;
  - whether the working tree drifted since the prep.

  The cold-start instruction of the skill becomes: status, then the list of threads, then the
  triage.
- **One skill.** The existing thread-loop step becomes a full "Responding to review feedback"
  section of the revue skill. That section has its own trigger line for the cold-start routing. The
  version stamp and the install machinery stay the same.
- **Progress carry.** The existing progress mechanics that use the run key extend, thus a
  carried-forward chapter keeps its read marks across a supersession.

## Testing Decisions

The tests examine the external behaviour at the highest existing seam. No test asserts on an
internal detail.

- **Prep-library seam** (existing pattern: run the real prep pipeline against a scratch git
  repository). The tests cover:
  - the record of the lineage on a matching scope, and both overrides;
  - the delta classification across unchanged, modified, and new hunks;
  - the mark of a stale chapter;
  - the carry-forward of a chapter with a new map of the hunk references;
  - the thread migration, and the orphan fallback;
  - the new freeze of the context of a carried excerpt.
- **CLI process seam** (existing pattern: spawn the binary in a scratch repository). The tests cover
  the JSON shape of `revue status` across cold-start situations, the delta through the CLI, and the
  thread commands, which do not change.
- **TUI render seam** (existing pattern: render the app in tests). A threads-changed event gives a
  silent refresh in place that keeps the position. A run-superseded event gives a banner. The reload
  lands on the epilogue.
- **Watcher module seam** (new, deliberately small). The tests drive the debounced watch module
  directly against a temporary directory, for both events. This seam is new because the timing of a
  filesystem watch inside a full TUI render test is flaky. The TUI tests inject events and do not
  touch the filesystem.
- **Skill**: no automated seam. The existing check pipeline (`revue show --check`) and manual runs
  validate the prose, as they do for the skill today.

## Out of Scope

- An auto-reload preference for a run supersession. This PRD gives a banner only.
- Garbage collection of superseded runs (`revue gc`, or a prune of the chain). This is future work.
- A separate skill or command for the feedback loop. The loop lives in the existing revue skill.
- A third thread status, for example "addressed". The schema keeps its two statuses.
- Any change to Revuediff, which has no dependency on a prepared run or on a thread.
- Automated behavioural tests for the skill prose itself.

## Further Notes

- The cold start is a strict requirement everywhere. The agent must find every mechanism again from
  disk, after a compaction, after a clear, and during a review of many days. No mechanism can depend
  on the conversation memory of the agent.
- The delta report is also the guard for the editorial rule. A fundamental rework marks many
  chapters stale. Thus the "cheap epilogue" path disappears by mechanism, not by the judgment of the
  agent.
- A thread anchor already survives a narration change, because the review unit pins it. The
  re-anchoring at a supersession extends that machinery across runs. It does not invent a parallel
  machinery.
