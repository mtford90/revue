# Design brief — Narrative depth (context excerpts, interludes, zoom)

> **Project:** revue — a terminal-native git diff reviewer (TUI)
> **Surface:** full-screen terminal UI (OpenTUI/React, character grid, keyboard-first, mouse-capable)
> **Tech stack:** TypeScript + Bun, OpenTUI ^0.1.89, themes derived from editor palettes with WCAG contrast floors
> **Scope:** the chapter-reading experience — Story surface pages, the sidebar, thread/comment affordances
> **Philosophy:** narration is the product's point but never a prerequisite; the flat diff is always reachable; runs are immutable; the reviewer's terminal is the whole canvas

## TL;DR for the designer

- revue turns a git diff into a **narrated sequence of chapters**: an agent clusters hunks into story beats, each with a title, prose summary, and judgment-call questions. The reviewer pages through them in a full-screen TUI.
- Today every chapter is *made of diff hunks* and every hunk *must* belong to exactly one chapter. The narrative is a strict partition of the diff.
- We want to loosen that in three ways: chapters that **quote unchanged code** as context, **prose-only "interlude" chapters** with no diff at all, and **zoomed-out narratives** (default preset: "10,000ft") that deliberately narrate only the important parts — plus freeform depth requests ("just the API changes, skim the rest").
- We also want **comments on the narration itself** — today threads only attach to diff line ranges.
- Your job: design how these read on a character grid — how quoted context looks distinct from reviewable diff, how a prose-only page feels like part of the same review, how a zoomed-out run communicates "this is deliberately partial", and where a comment on prose lives.

## The user journey today

```
$ revue prep                     agent reads hunks.txt,
  ─ freezes the diff into  ───►  writes chapters.json ───►  $ revue show <run>
    an immutable run                (the narration)             full-screen TUI
```

Inside the TUI:

```
┌──────────────────────────────────────────────────────────────────────┐
│ File  Navigate  View  Help                                 (menubar) │
├────────────────────┬─────────────────────────────────────────────────┤
│ Chapters (4)       │  Wire org ID through the API layer              │
│ [x] 1. Prologue    │  Now that the schema carries org_id, the        │
│ [x] 2. Schema...   │  handlers thread it through to the client.      │
│ ▸[ ] 3. Wire org…  │                                                 │
│ [ ] 4. Tests       │  What to review                                 │
│                    │  [ ] MEDIUM 1. Should retryCount reset when…    │
│ Files (3)          │                                                 │
│ [x] ▼ api/org.ts   │  [x] ▼ api/org.ts                    +42 -7    │
│ [ ] ▼ api/client.ts│  ┌─ diff hunks (syntax highlighted, ─────────┐ │
│ [ ] ▶ api/types.ts │  │  gutter line numbers, +/- row tints,      │ │
│                    │  │  comment indicators in the gutter)        │ │
│                    │  └───────────────────────────────────────────┘ │
├────────────────────┴─────────────────────────────────────────────────┤
│ revue · Ch 3/4 · ▰▰▰▰▱▱▱▱ · 4/9 files · 2 threads │ Patch │ ? · q   │
└──────────────────────────────────────────────────────────────────────┘
```

Three top-level **surfaces**: **Story** (the narrated page sequence: prologue, then chapters), **Files** (the whole run as one flat diff — internally a synthetic chapter covering every hunk), and **Comments** (every thread, jumping to its owning chapter). Narrow terminals swap the sidebar for a nav strip: `◀ Prev · Chapter 3/4 · Next ▶`.

We are touching: chapter pages (Story surface), the sidebar/page index, the status bar, the Comments surface, and the thread composer. We are **not** touching the Files surface layout, the prologue's internal design, menus, or the diff renderer's row anatomy.

## The surfaces being redesigned

All in `packages/tui/src/` (the designer needn't read code, but for reference):

- Chapter page: `app.tsx:1565-1756` (`ChapterView`); chapter brief (title + summary) `app.tsx:458-507`; key changes list `app.tsx:1103-1158` with header copy **"What to review"**.
- Sidebar page index: `app.tsx:509-664`; entries render as `[x] 1. Prologue`, header **"Chapters (N)"**; file list header **"Files (N)"** with `+adds -dels` right-aligned per row.
- Status bar: `statusBar.tsx` — `revue · Ch 2/5 · ▰▰▰▱▱▱▱▱ · 2/10 files · 5 threads │ Patch │ ? help · q quit`.
- Comments surface: `app.tsx:1356-1394` — header **"X open · Y resolved — Enter opens a comment in its chapter"**; rows show `path:start[-end]`, author, snippet, reply count. Empty state: **"No comments in this review yet."** / **"Select diff lines and press Enter to start a thread; it will appear here."**
- Thread composer: `app.tsx:1500-1560` — title **"New review thread"** / **"Reply to thread"**; footer `[Save Ctrl+Enter] [Copy path Ctrl+Y] [Copy link Ctrl+G] [Cancel Escape]`.
- Narration prose renders a markdown subset only: `**bold**`, `*italic*`, `` `code` `` (`markdown.tsx`). No lists, tables, block quotes, or fenced blocks today, although the agent skill already permits short fenced snippets in summaries — they currently render as raw text. Mermaid prologue diagrams render as raw source in a bordered box labelled `diagram (mermaid)`.

## What the redesign needs to do

In priority order:

1. **Context excerpts** — a chapter can quote a range of *unchanged* code (from the run's frozen file snapshots) alongside its diff hunks. It must read as *scenery, not work*: no +/- tints, not counted in progress, visibly distinct from reviewable hunks — yet still line-numbered, syntax-highlighted, and **commentable** (reviewers can start threads on excerpt lines, same selection-then-Enter gesture as the diff).
2. **Interludes** — a chapter with no hunks at all: title + prose, optionally with context excerpts. It should feel like a legitimate page in the sequence (navigable, markable as read) while making obvious there is no diff to review here. Its narration may be longer than a normal chapter summary.
3. **Zoomed-out narratives** — the agent generates the story at a chosen depth. Presets are **"10,000ft"** and **"full"** (today's behaviour); freeform depth requests are also allowed ("focus on the migration, one line on everything else"). At anything below full, chapters deliberately omit hunks. The omitted hunks remain reachable only via the Files surface. The UI must communicate, calmly and persistently, that *this narrative is a partial view* — e.g. coverage in the status bar or sidebar ("story covers 12 of 40 hunks · rest in Files") — without nagging.
4. **Comments on narration** — a reviewer can attach a thread to a chapter's prose (including interludes and, ideally, the prologue). Anchoring is **chapter-level** (one thread list per chapter's narration), not per-word. These threads appear in the Comments surface alongside code threads, visually distinguishable.

### Anti-goals

- ❌ Don't redesign the Files surface, the prologue layout, menus, or the diff row anatomy (gutter, tints, intra-line emphasis are settled).
- ❌ Don't make context excerpts look editable or reviewable — no checkboxes, no progress contribution, no +/- markers.
- ❌ Don't invent a full markdown renderer — assume the current subset plus, at most, fenced code blocks if your design needs them (flag it if so).
- ❌ Don't design a live "regenerate at new depth" flow — depth is chosen when the narrative is generated; in-TUI re-zooming is deferred (see open decisions).
- ❌ Don't add onboarding, tutorials, or empty-state marketing. revue's audience is developers in a terminal.
- ❌ No colour outside the theme's derived slots (surfaces, foregrounds, diff tints, severity colours, accent). Assume both light and dark derived themes.

## Constraints

- **Character grid.** Everything is monospaced rows; "visual weight" comes from box-drawing characters, indentation, dim/bold/italic attributes, and background tints — not spacing or type scale.
- **Theme tokens only.** Colours come from a derivation with WCAG contrast floors: neutral surfaces, `accent`, `muted`, `heading`, diff `added/removed/modified` tints, severity colours (critical/high/medium/info). A new *kind* of surface (e.g. an excerpt background) should map to an existing slot or be flagged as a new derivation slot.
- **Terminal widths vary.** Designs must degrade to ~80 columns; the sidebar already collapses to a nav strip when narrow. Wide content scrolls or wraps — never assume >120 columns.
- **Keyboard-first, mouse-supported.** Every affordance needs a key path; the existing gesture for commenting is gutter-drag (or right-click) then Enter. Digits `1–9`, `escape`, `[`/`]` are reserved keys.
- **Viewport windowing.** Long pages mount only near-window rows; components need measurable heights — avoid designs requiring unbounded dynamic reflow.
- **Immutable runs.** The narrative and quoted excerpts are fixed at generation time. There is no live agent in the TUI.
- **British English** in all copy. Sentence case for UI strings, matching existing chrome ("What to review", "All files").
- **Existing copy is hardcoded and terse** — match its register: lowercase-ish, coworker-not-changelog, no exclamation marks.

## Content outline

| Element | Must include | Notes |
|---|---|---|
| Context excerpt block | file path, line range label, syntax-highlighted lines with real line numbers, comment indicators, an unobtrusive "context — unchanged" cue | may appear between prose and hunks, or interleaved per the narration's order; possibly an optional one-line caption from the agent ("the caller this change must satisfy") |
| Interlude page | title, longer prose, optional excerpts, mark-as-read affordance | sidebar entry needs a cue that this page has no diff (today every entry implies files/hunks) |
| Zoom indicator | narrative depth name ("10,000ft" or a freeform label), story coverage ("12 of 40 hunks"), pointer to Files | status bar and/or sidebar; must not shout |
| Narration thread affordance | how a reviewer discovers they can comment on prose, the entry gesture, where existing prose-threads display on the page | chapter-level anchor: the thread belongs to the chapter's narration as a whole |
| Comments surface rows | distinguish code threads (path:lines) from narration threads (chapter title) | both jump to their home on Enter |

## Variants the design must handle

- **Full-depth run (today's default):** everything covered; zoom indicator should disappear or reduce to nothing — full is not a mode, it's the baseline.
- **Zoomed-out run:** some chapters, many omitted hunks; Files surface unchanged.
- **Freeform-depth run:** as zoomed-out, but the depth label is a short agent-written phrase rather than "10,000ft".
- **Interlude-only neighbourhoods:** an interlude may sit between two heavy chapters, or open the review.
- **Chapterless runs** (flat diff, no narration): none of these features apply; nothing new may leak into that mode.
- **Narrow terminal (~80 cols):** excerpt blocks, zoom indicator, and interlude pages all still legible.

## Open design decisions — your call

1. **How does quoted context declare itself?** Candidates: (a) a dimmed background band with a left border rule and a one-line header (`context · api/client.ts 118–140`); (b) same chrome as a collapsed file section but with a `context` badge where the +/- stats would be; (c) indented quote-style block with dim line numbers. Weak preference for (a) — but you own this; it's the load-bearing visual of the whole feature.
2. **Interlude identity in the sidebar.** A glyph? A different checkbox treatment? Copy like `2. Why the migration is staged` with no file count beneath? No preference — decide for us.
3. **Zoom indicator placement and copy.** Status bar segment (`10,000ft · 12/40 hunks`), sidebar footer, or a one-line banner atop the Story surface. Weak preference for status bar + sidebar echo. Exact wording is yours; "10,000ft" is the canonical preset name.
4. **Prose-comment entry gesture.** Chapter-level anchoring is decided, but discovery is not: a footer hint on the narration block, a key listed in help, a visible affordance (e.g. a comment glyph after the summary)? We were tempted by Google-Docs-style text-range highlighting and chose chapter-level for robustness — if you find a middle path (e.g. paragraph-level *display* of a chapter-level thread), sketch it, but don't require text-range identity.
5. **Where narration threads render on the page.** Inline beneath the summary, collapsed behind a count (`2 comments on this narration`), or only in the Comments surface? Weak preference for a collapsed count that expands.

## Glossary

| Term | What it means | What it is NOT |
|---|---|---|
| Chapter | one narrative beat: title, prose summary, the hunks it covers, judgment-call questions | not a file; not a commit |
| Interlude | a chapter with no hunks — prose (± context excerpts) only | not a modal, not a tooltip; a full page in the sequence |
| Context excerpt | unchanged code a chapter quotes from the run's frozen snapshots | not a diff hunk; not reviewable work; never +/- tinted |
| Hunk / review unit | one diff hunk, identity `(filePath, oldStart)`; the atom of coverage and progress | not commentary; not context |
| Key change | a severity-tagged *question* for the human, anchored to tight line ranges | not a changelog line |
| Prologue | the high-level overview page before chapter one | not a chapter; unchanged by this work |
| Surface | a top-level tab: Story, Files, Comments | not a page |
| Page | one unit of Story navigation: prologue or a chapter (including interludes) | — |
| Thread | anchored, mutable feedback with ordered messages; open or dealt-with | not part of the immutable run |
| Narration thread | a thread anchored to a chapter's prose (new in this work) | not anchored to lines of code |
| Zoom / depth | how much of the diff the narrative covers: "full" (everything) or "10,000ft" / freeform (partial) | not a display setting; fixed at generation time |
| Run | the immutable prepared diff directory the TUI displays | — |

## Reference material

- `CONTEXT.md` (repo root) — full domain glossary and key decisions; the source of truth for terminology.
- `docs/adr/0006-chapterless-runs.md` — chapters are an overlay; the flat diff always works.
- `docs/adr/0007-synthesised-patches-and-anchor-authority.md` — today's rule that only original git hunks accept comments; context excerpts are a sanctioned new anchor kind, *ad hoc* context expansion (GitHub-style reveal) stays uncommentable.
- `skills/revue/SKILL.md` — what the narrating agent is instructed to produce.
- `examples/sample-run/chapters.json` — a full valid narration.

### Engineering notes (context for you, not yours to solve)

- Excerpt content source is undecided: snapshots only exist for files *in the diff*, so quoting an untouched file means either embedding the excerpt text in the narration file or extending prep. Design as if any file can be quoted; we'll handle plumbing.
- Thread anchors for excerpts and narration are new anchor kinds keyed to the immutable run; regeneration at a different depth may orphan narration threads — comms for that (if any) can wait.

## What we want from you

1. Terminal mock-ups (monospace text frames, as in this brief) of: a chapter page containing a context excerpt among hunks; an interlude page; the sidebar + status bar for a 10,000ft run; the prose-comment affordance closed and open; Comments surface rows mixing code and narration threads.
2. Each mock at two widths: comfortable (~110 cols) and narrow (~80 cols).
3. A short rationale per open decision above — which option you chose and why.
4. Exact copy for every new string (labels, badges, hints, empty states), in the existing register.
5. Any new theme slots you require, named, with their light/dark intent described.

## Out of scope

- Files surface, prologue internals, menus, diff row anatomy, semantic (Difftastic) view.
- Live re-zooming inside the TUI, multi-level narratives in one run (schema will allow it later; no UI now).
- Markdown renderer expansion beyond what your design strictly needs.
- Mermaid rendering.

## Feedback loop

Drop mock-ups and copy back as markdown (text frames preferred over images) in `docs/design-briefs/` alongside this file, or paste them into the conversation. We'll iterate on the open decisions first, then the full frames.
