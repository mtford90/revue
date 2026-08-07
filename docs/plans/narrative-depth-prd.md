## Problem Statement

Revue narrates a diff as chapters, but the narration can only ever point at changed lines, and it must point at every one of them exactly once. Three things a reviewer needs fall outside that.

A chapter cannot show the code a change has to fit into. The reviewer reads a modified function with no sight of the caller that constrains it, and has to leave Revue to find out whether the change is right.

A chapter cannot say something that is not about a specific hunk. Explaining why a migration is staged, or what the reader should hold in their head before the next three chapters, has nowhere to live — every chapter is a group of hunks and nothing else.

The narration is all-or-nothing. Every review unit must be covered, so a large diff produces a long story at uniform depth. A reviewer who wants the shape of a change before the detail, or who only cares about one area, has no way to ask for less, and the agent has no way to offer it.

Separately, the narration is inert text. A reviewer who wants to quote a chapter's summary into a pull request or a chat has to reach for the mouse and select it out of the terminal by hand.

## Solution

Chapters gain **context excerpts**: quoted ranges of unchanged code, folded to a single line by default, opening in place. They read as scenery rather than work — no diff tints, no checkbox, no contribution to progress — but they are line-numbered, syntax-highlighted, selectable, yankable, and commentable. The quoted bytes are read off disk by Revue itself, never transcribed by the agent, so a reviewer can trust that what they are reading is what is in the repository.

A chapter with no hunks at all is an **interlude**: a title, prose that may run longer than a normal summary, and optionally excerpts and diagrams. It is an ordinary page — it navigates, it marks read, it counts toward chapter progress — and it says plainly that there is nothing to review on it.

A narrative declares its **depth**. Full depth is the default and behaves exactly as today: every review unit narrated exactly once. Below full depth — the `10,000ft` preset, or a freeform label the agent writes for a bespoke request — chapters may deliberately omit hunks, and the omitted ones remain reachable through the Files surface. The interface states coverage calmly and permanently in two places, and says nothing at all at full depth, because full is the baseline rather than a mode.

Finally, narration becomes selectable and yankable, optionally carrying a chapter reference so a quoted summary arrives somewhere else already attributed.

## User Stories

1. As a reviewer, I want a chapter to quote the unchanged code a change has to fit into, so that I can judge the change without leaving Revue.
2. As a reviewer, I want quoted context folded to one line by default, so that scenery never buries the diff I came to review.
3. As a reviewer, I want to open a folded excerpt in place, so that I do not lose my position in the chapter.
4. As a reviewer, I want an excerpt's fold state remembered for my session, so that reopening a run does not undo how I arranged it.
5. As a reviewer, I want excerpts to look plainly different from reviewable diff, so that I never mistake quoted code for a change.
6. As a reviewer, I want quoted code to line up with reviewable code from the same file, so that reading between them costs me nothing.
7. As a reviewer, I want an excerpt to carry the file path and line range it came from, so that I can find it in my editor.
8. As a reviewer, I want an optional caption above an excerpt, so that I know why the narrator showed it to me.
9. As a reviewer, I want excerpts to contribute nothing to my progress counts, so that "reviewed" keeps meaning "I have looked at the changes".
10. As a reviewer, I want to select lines within an excerpt, so that I can copy quoted code.
11. As a reviewer, I want to comment on excerpt lines, so that I can raise a question about the code a change depends on.
12. As a reviewer, I want a permalink for an excerpt line, so that I can point a colleague at the code I am asking about.
13. As a reviewer, I want an excerpt to stay full width with one gutter in split layout, so that quoted code is not pretending to have two sides to compare.
14. As a reviewer, I want a chapter that is purely explanatory, so that the narrator can tell me something that is not tied to a hunk.
15. As a reviewer, I want an interlude marked in the chapter index, so that I can see at a glance which pages have no diff.
16. As a reviewer, I want an interlude to say there is nothing to review on it, so that I do not go looking for a file list that is not there.
17. As a reviewer, I want an interlude to end with a clear close and the keys I need next, so that I know the page is finished.
18. As a reviewer, I want to mark an interlude read like any other chapter, so that my progress reflects everything I have been through.
19. As a reviewer, I want interludes to carry diagrams, so that a structural explanation can be drawn rather than described.
20. As a reviewer, I want fenced code blocks in narration to render as code, so that a short illustrative snippet reads as one.
21. As a reviewer, I want to ask for a high-level narrative of a large change, so that I can understand its shape before committing to the detail.
22. As a reviewer, I want to ask for a narrative focused on a specific area in my own words, so that I am not limited to preset depths.
23. As a reviewer, I want a partial narrative to tell me it is partial, so that I never mistake a summary for full coverage.
24. As a reviewer, I want to see how much of the diff the story covers, so that I know how much is waiting for me elsewhere.
25. As a reviewer, I want to be told where the uncovered changes are, so that I can go and read them.
26. As a reviewer, I want every hunk to remain reachable in the Files surface however shallow the narrative, so that nothing is ever hidden from me.
27. As a reviewer, I want a full-depth run to show no coverage chrome at all, so that the baseline case stays uncluttered.
28. As a reviewer on a narrow terminal, I want coverage information to give way gracefully, so that the status bar stays readable.
29. As a reviewer, I want to select a chapter's narration with the pointer, so that I can quote it elsewhere.
30. As a reviewer, I want to yank selected narration with the same key I use in the diff, so that I do not have to learn a second gesture.
31. As a reviewer, I want to copy narration together with its chapter reference, so that the quote arrives already attributed.
32. As a reviewer, I want the pointer menu on prose to offer only what prose can answer, so that I am not shown verbs that cannot work.
33. As a reviewer, I want confirmation that narration was copied, so that I know the yank landed.
34. As a reviewer, I want my comments to survive the narrative being regenerated, so that feedback is not destroyed by re-narrating.
35. As a reviewer, I want a comment whose excerpt has vanished to be shown to me rather than deleted or fatal, so that I can act on it instead of losing it.
36. As an agent, I want to cite unchanged ranges as context, so that I can show the reviewer what a change has to satisfy.
37. As an agent, I want Revue to freeze the code I cite, so that the reviewer reads the repository rather than my transcription of it.
38. As an agent, I want to write a chapter with no hunks, so that I can explain something that is not tied to a change.
39. As an agent, I want to declare the depth of the narrative I produced, so that the interface can tell the reviewer what they are getting.
40. As an agent, I want to narrate only part of a diff when asked for a high-level review, so that I can honour the request without abandoning coverage guarantees elsewhere.
41. As an agent, I want validation to confirm my excerpts resolve, so that I find out about a bad citation before the reviewer does.
42. As an agent, I want validation to keep rejecting missing and duplicated hunks at full depth, so that the coverage guarantee still protects the default case.
43. As an agent, I want an actionable error when I have cited context but not frozen it, so that I know exactly which step I missed.
44. As an agent, I want to know at the start of a run whether my skill matches the installed Revue, so that I do not write a chapters file the CLI will reject.
45. As a reviewer, I want a clear explanation when a chapters file was written by a mismatched skill, so that I know to reinstall rather than debug a schema error.
46. As a reviewer, I want the markdown export to include interludes, excerpts, and the narrative's depth, so that the exported review says the same thing the terminal did.
47. As a reviewer, I want the export to state coverage when the narrative is partial, so that a reader of the export is not misled about completeness.
48. As a maintainer, I want freezing to fail when the working tree has moved since prep, so that a run never quotes code that was never part of it.
49. As a maintainer, I want frozen context excluded from the run ID, so that adding narration never invalidates a prepared run.
50. As a maintainer, I want the domain glossary and decision records to describe the new model, so that the next person reads the truth.

## Implementation Decisions

**Narrative depth lives in the chapters file.** The agent-written narration gains a file-level declaration of depth with two shapes: the `full` default and a partial depth carrying a label — either the `10,000ft` preset or freeform text the agent writes for a bespoke request. An absent declaration means full, so every existing chapters file keeps its current meaning.

**Coverage strictness is keyed on declared depth.** At full depth the coverage validator behaves exactly as it does today: every prepared review unit appears in exactly one chapter, and missing or duplicated units are errors. Only an explicitly partial depth may omit units. Duplicate units, unknown units, unknown files, and key-change ranges outside their chapter's hunks stay errors at every depth. This is the load-bearing safety property of the whole feature: relaxing coverage unconditionally would let an agent silently drop hunks from a review that claims to be complete.

**Validation reports coverage rather than only accepting or rejecting.** The `--check` summary states narrated and total review-unit counts so an agent can confirm it produced what it intended.

**An interlude is inferred, not flagged.** A chapter whose hunk-reference list is empty is an interlude. There is no separate kind field, because a field and a hunk list can contradict each other and one of them would have to win.

**Context excerpts are cited in the chapters file and frozen by the CLI.** A chapter carries excerpt citations of file path, line range, and optional caption. A new freeze step — invoked once after the agent writes the chapters file — resolves every citation against the run's own recorded endpoint and pins the resulting text into a narration-side artifact beside the chapters file. The agent never transcribes code. This was chosen over embedding the quoted text in the narration, which would show reviewers LLM-produced code presented as repository truth, and over restricting citations to files already in the diff, which would rule out quoting the untouched caller that motivates the feature.

**Frozen context is narration-side.** Like the chapters file, it is excluded from the run ID, so freezing never invalidates a prepared run and never rewrites the immutable prep artifacts. Prep's existing snapshot reader resolves the content, so the same endpoint semantics apply as for the diff itself.

**Freezing guards against drift.** For worktree-backed scopes the endpoint is a synthetic revision rather than a commit, so freeze must verify that a cited file still matches what prep captured and fail otherwise, mirroring the race check prep already performs. A run must never quote content that was not part of it.

**Excerpts are a new row kind in the shared visual plan.** Fold state is an input to planning rather than something measured after mount, because viewport windowing mounts only near-window rows and needs heights up front: a folded excerpt is one row, an open one is a header, an optional caption, and its lines. Excerpt line numbers occupy the additions gutter so quoted code lands in the same column as reviewable code from the same file; the deletions gutter and the sign slot stay empty, and the leading column carries a rule glyph. In split layout an excerpt renders full width with a single gutter.

**Excerpt fold state is session state.** It sits beside collapsed files in per-run session state, defaults to folded, and is not part of the immutable run. Excerpts appear nowhere in review progress — not in the gauge, not in file counts, no checkbox.

**Interludes participate in progress normally.** Chapter review works as for any chapter; an interlude with no files completes on the mark-read key alone.

**Coverage appears in exactly two places** — a status-bar segment after the file count, and the chapter-index header plus one line beneath it — and in neither at full depth. As the terminal narrows the segment sheds its unit word and then disappears, but only after the gauge and thread count have already gone.

**Prose reuses the existing selection and copy verbs.** Yank is the existing copy-selection action; the pointer menu on narration is a reduced variant of the range menu offering copy-selected-text and copy-with-chapter-reference, with copy-path disabled and no permalink or comment verb. No new keybindings are introduced anywhere in this work.

**Excerpt comments are a second anchor kind.** Thread anchors gain an excerpt-anchored form keyed to the run ID and validated against the frozen context rather than against patch hunks. This extends the anchor-authority decision rather than replacing it: narration-cited excerpts accept comments precisely because they are pinned narration, while ad-hoc GitHub-style context expansion remains uncommentable exactly as before.

**Unresolvable excerpt anchors are surfaced, never fatal and never pruned.** Regenerating a narrative at a different depth can legitimately remove an excerpt. Such threads remain in the store, appear in the Comments surface marked as orphaned, and do not render inline. Thread validation must stop treating an unresolvable excerpt anchor as a corrupt-store failure, because re-narrating a run is a normal act and must not be destructive.

**Skill and CLI version drift is detected early and explained late.** The skill compares its own stamped version against the installed CLI during its prerequisite checks and stops with a reinstall instruction on a mismatch, rather than discovering the problem only when validation rejects its output. Independently, a chapters file that fails schema validation on unknown keys produces an explanation pointing at skill reinstallation and the doctor command instead of a raw validation error. No version marker is added to the chapters file itself.

**Modules touched.** The shared types package for the chapters and thread schemas; the prep package for coverage validation and the new freeze capability; the diff package for the excerpt row kind in the visual plan; the diff-opentui package for excerpt chrome built from the existing expander band, gutter, and line-content primitives; the TUI package for chapter rendering, the chapter index, the status bar, session state, prose selection, and thread validation; the markdown-export package; and the skill text.

**No new theme slots and no new keybindings are required.** An excerpt reads as scenery because its body is the unstyled page; every colour it needs already exists as a derived slot.

## Testing Decisions

A good test here asserts what a reviewer or a calling agent can observe — a rendered frame, a validation outcome, a persisted state change, a CLI exit code — and not how the code arrived there. Existing seams are preferred throughout; this work adds exactly one new one.

**Coverage validation** is the highest-value seam and already exists as a pure function over a prepared run and a chapters file. Cases: full depth rejecting a missing unit exactly as today; partial depth accepting the same omission; duplicates, unknown units, and out-of-chapter key-change ranges rejected at every depth; an empty hunk list accepted; excerpt citations validated. Prior art is the existing coverage test suite.

**Schema tests** cover only genuinely new rules — the depth declaration's two shapes and the excerpt range invariants — and not the validation library's own behaviour. Prior art is the existing chapters and threads schema suites.

**Freezing** is the one new seam: a function in the prep package taking a run and a chapters file and returning the frozen context, with content resolution behind prep's existing snapshot reader. It is tested with real temporary git repositories against committed and worktree scopes, including the drift failure. Prior art is the existing prep integration suite. The CLI layer above it is tested thinly for arguments, exit codes, and error text, keeping the process-level layer small as the testing guide requires.

**Row geometry** is unit-tested at the visual plan: excerpt row heights folded and open, gutter column assignment, and the single-gutter full-width behaviour in split layout. Prior art is the existing plan suite.

**Rendered appearance** is protected by the golden snapshot suite, which is the only thing that can catch column, colour, and attribute regressions. An excerpt block is a new rendering family and earns scenarios — folded and open, both layouts, at two widths — as does an interlude page. Goldens are re-blessed only when the new rendering is intended, and the resulting diff is read as a review of the change.

**Reviewer behaviour** is covered by component integration tests driving the real components through keys, pointer events, and resizes: folding and opening an excerpt, excerpt placement in narration order, an interlude page's absent file list and review section, marking an interlude read, prose selection through to the copy notice, and the reduced pointer menu. Prior art is the existing app test suite.

**Status bar and index chrome** are unit-tested as formatting: the coverage segment present at partial depth and absent at full, and its shedding order as width decreases. Prior art is the existing status-bar suite.

**Session and review state** are unit-tested for fold persistence, interlude auto-completion with no files, and excerpts contributing nothing to progress. Prior art is the existing view-state suite.

**Threads** are tested for the new anchor kind round-tripping through the CLI, validation against frozen context, and — importantly — that an unresolvable excerpt anchor surfaces as orphaned rather than throwing. Prior art is the existing thread schema and thread store suites.

**Export** is tested for interludes, excerpts, depth and coverage reporting, and excerpt-anchored threads. Prior art is the existing format suite.

Screenshots remain a manual visual check rather than an assertion, as they are today.

## Out of Scope

Comment threads on narration. The design round dropped them in favour of yank: a chapter-level thread has no home in the decided layout, and regeneration at a different depth would orphan it immediately. It wants designing properly on its own terms and is tracked separately.

Live re-zooming inside the TUI. Depth is fixed when the narrative is generated. The schema is shaped so a run could later hold more than one narrative level and the interface could toggle between them, but no such interface is built here.

Multiple narrative levels in a single run, the Files surface layout, prologue internals, menus, the diff row anatomy of gutters, tints, and intra-line emphasis, the semantic view, mermaid rendering, and any markdown renderer expansion beyond fenced code blocks.

A version marker in the chapters file. Drift is handled by early skill-version checking and a clearer load error.

## Further Notes

The design is settled and character-exact. The handoff and its HTML reference live in the repository under the design-briefs directory; section D of that file is what to build, and its column positions were measured rather than estimated. The HTML is a reference recreation of the terminal and must not be ported — every colour in it is a derived theme slot that the implementation reads by name.

Two documentation changes are part of this work rather than follow-ups. The domain glossary needs four new terms and four amendments, because the current definitions become false: a chapter is defined as a group of diff hunks, which interludes falsify; a thread is defined by a single anchor shape, which gains a second; the run gains an artifact; and the recorded decision that show rejects missing review units is exactly what depth-keyed coverage relaxes. A new decision record covers narrative depth, frozen excerpts, and excerpt anchors, including the rejected alternatives of embedding quoted text in the narration and restricting citations to files already in the diff. It extends rather than supersedes the existing anchor-authority and prep-ownership records, both of which remain correct in substance; those two gain pointer lines. Extension is a new convention for this repository, whose only precedent is supersession.

The change to the shared visual plan's row-kind union puts the semantic view and every existing golden snapshot in its blast radius, which should be assumed when sequencing.

Two existing cards on the board are superseded by this PRD: the one asking for the skill to add relevant context hunks, and the one asking for light review and zoomed-out narratives.
