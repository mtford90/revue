# 07 — Skill: responding to review feedback

Status: done

## Parent

.scratch/interactive-review-loop/PRD.md

## What to build

Grow the revue skill's thread-loop step into a full "Responding to review feedback" section with its own trigger line ("I added comments", "check the threads", and similar) so a cold session routes straight to it. The section teaches: orient with `revue status` then `revue threads list --json` (never rely on conversation memory); triage each thread into three lanes — agree-and-clear (fix, reply inline), disagree (no change, inline counter-argument, flag in chat), ambiguous or question (answer inline, ask in chat); reply always, never mark dealt-with — the reviewer closes threads; end the pass with a chat report of fixes, pushback, and open calls; then regenerate once per pass (re-prep → delta worklist → re-narrate stale chapters in place → write the epilogue → freeze context → `--check`), skipping regeneration when no code changed. The section notes that scope determines whether commits are needed for changes to surface in a re-prep, and stays neutral on committing — context and user preference decide. Same skill file, same version stamp and install machinery.

## Acceptance criteria

- [x] The skill section covers cold-start orientation, three-lane triage, reviewer-closes etiquette, the batch regeneration pipeline, the zero-change skip, and the chat report
- [x] No instruction tells the agent to mark a thread dealt-with
- [x] The generation section and feedback section share the delta/epilogue vocabulary without contradiction
- [x] A manual end-to-end pass (comment → feedback pass → banner → reload) works following only the skill's instructions — the CLI half (prep → narrate → thread → reply → re-prep → delta → carried/stale/epilogue → `--check`) was walked in a scratch repository; the banner and reload leg needs a human at a terminal

## Blocked by

- 02-delta-and-chapter-carry-forward
- 03-thread-migration-across-supersession
- 04-revue-status-orientation-command
