# Handoff: narrative depth — context excerpts, interludes, zoom, prose yank

## Overview

Four additions to revue's Story surface, designed against the brief in `docs/design-briefs/2026-08-07-narrative-depth.md`:

1. **Context excerpts** — a chapter can quote a range of *unchanged* code alongside its diff hunks. Folded by default; opens in place; reads as scenery, not work; fully commentable and yankable.
2. **Interludes** — a chapter with no hunks: title, longer prose, optional excerpts and diagrams. A legitimate page in the sequence.
3. **Zoomed-out narratives** — a run generated at a chosen depth (`"10,000ft"`, `"full"`, or a freeform label) narrates only part of the diff. The UI states coverage calmly and permanently, and says nothing at all at full depth.
4. **Prose yank** — the narration is selectable, yankable, and carries an optional chapter reference. **No comment threads on narration** — explicitly out of scope for this work.

Decided options: **7a** (folded excerpt band), **3a** (`¶` interlude glyph), **4a + 4b** (status-bar segment plus index line), **8a** (diagrams use the context block), **9b** (yank offers a chapter reference).

## About the design files

`Revue - narrative depth.dc.html` is a **design reference**, not production code. It is an HTML recreation of the terminal — a character grid built from `<div>` rows and `<span>` cells at 13px/19px monospace, where 1 column = `1ch`. It exists so the design can be judged at exact column counts before implementation.

**Do not port the HTML.** Implement in the existing environment: `packages/tui` (React + OpenTUI, TypeScript on Bun, no build step) and `packages/diff-opentui` for anything that renders inside a diff body. Every colour in the mock is a *derived theme slot* — use the slot name from `@revue/theme`, never the hex.

Open the file in a browser and read it top to bottom: §1 recreates today's product for comparison; sections A–C hold the options each decision was made from, stamped with what was chosen; **section D (`#t10`) is the design as decided** and is the one to build from. Frames `10c`, `10a`, `10b`, `10d`.

## Fidelity

**High-fidelity and character-exact.** Every frame is a whole terminal at a stated column count (110 unless labelled otherwise), with real chrome widths, real glyphs, and the `ayu-dark` palette derived verbatim by `buildThemeFromInputs`. Column positions in this document are authoritative — they were measured, not estimated.

## Row anatomy — the load-bearing detail

`OPENTUI_DIFF_CHROME` (`packages/diff-opentui/src/styles.ts`) plus `Gutter` gives each **stacked** diff row:

```
focusMarker(1) + lineNumber(digits) + attachmentMarker(3)   ← deletions gutter
focusMarker(1) + lineNumber(digits) + attachmentMarker(3)   ← additions gutter
sign(3)                                                      ← " + " / " - " / "   "
code…
```

With `digits = 3` that is **17 columns of chrome** before code.

### Excerpt row (open)

```
│  ......  ␣118 1●     export class ApiClient {
^  ^^^^^^  ^^^^^^^^^^  ^
1  6       7           code starts at column 17
```

- Column 0: the rule, `│`, in **`lineNumberFg`**. It occupies the deletions focus-marker slot — an excerpt never focuses.
- Columns 1–6: blank. The rest of the deletions gutter; an excerpt has no old side.
- Columns 7–13: the **additions** gutter, unchanged — marker, right-aligned line number, attachment marker (`attachmentMarker(count)` → `" 1●"`).
- Columns 14–16: blank. The sign slot, always empty; an excerpt is not a change.
- Column 17 onward: syntax-highlighted code on **`contextBg`** (i.e. the unstyled page).

Putting the numbers in the additions gutter is what makes quoted code land on the same column as reviewable code in the same file. Keep it.

In **split** layout the excerpt stays **full width with one gutter** — no pane divider, no second pane. An unchanged quotation has no two sides to compare.

### Excerpt header (open)

```
│ context · src/api/client.ts 118–140 · unchanged                    [▲ hide] 
```
Row background **`panel`**; label **`muted`**; `[▲ hide]` **`accent`**, right-aligned; rule glyph in `lineNumberFg` at column 0. Drop `· unchanged` below ~100 columns.

### Excerpt folded (the default state)

```
  ⋯  context · src/api/client.ts 118–140  [▼ show 7 lines]
```
Structurally identical to `ExpanderBand` in `packages/diff-opentui/src/components.tsx`: `panel` background, `"  ⋯"` in `muted`, label `muted`, bracketed action in `accent`. One row.

The agent's optional caption sits **above** the block, indented to column 3, in `muted` — a figure label, not a heading:
```
   the caller this change has to satisfy
```

### Diagram block (interludes)

Same chrome as an excerpt, labelled by kind:
```
│ diagram · ascii                                                   [▲ hide] 
│                ▏prep ──▶ chapters.json ──▶ show
```
No line numbers (there is no file), so columns 1–16 are blank and text starts at column 17. Labels: `diagram · ascii`, `diagram · mermaid source`. Mermaid body renders in `muted` (it is source, not a picture); ASCII in `text`.

## Screens

### 1. Chapter page with excerpts — frames `10c` (folded) and `10a` (open)

**Layout at 110 columns:** menu bar (1 row, `panelAlt`) · sidebar 41 cols + `│` divider 1 col + content 68 cols · status bar (1 row). Widths come from `resolveLayout` in `packages/tui/src/layout.ts` and are unchanged by this work.

**Content column, top to bottom:** file header → hunk header → diff rows → blank → caption → excerpt block → blank → separator rule → next file section → expander band.

The excerpt sits **in narration order** — between the file it follows and the file it explains — not pinned to the end of the chapter.

**Sidebar** is today's `ChapterBrief` with two changes: the index header carries the depth label, and a coverage line sits under it (see §3). No narration thread affordance anywhere.

### 2. Interlude — frame `10b`

Sidebar: index entry `  [x] ¶ 2. Why the migration is staged`, then title, then one dim line `¶ interlude · nothing to review here`, then the prose (which may run longer than a normal chapter summary). **No file list**, **no "What to review"** — an interlude has neither.

Content column: caption + diagram block(s) + any excerpts, then:
```
  ── end of chapter ──
  x mark this page read · ]c next page
```
Both in `muted`. There is deliberately **no** "nothing to review on this page" line — the page has no diff and the close says when it is done.

Prev/Next, the chapter checkbox, `Chapter 2/4`, and progress all behave exactly as for a normal chapter.

### 3. Coverage indicator (a 10,000ft run) — visible in every frame in D

Two places, both required:

**Status bar** — a new segment on `panel`, `muted` text, immediately after the files count:
```
 10,000ft · 12/40 hunks 
```
**Sidebar index** — the header gains the label, and one line sits under it:
```
 ▾ Chapters (4) · 10,000ft
    12 of 40 hunks · rest in Files
```

At **full depth both disappear entirely.** Full is not a mode, it is the baseline. A freeform depth substitutes the agent's own label verbatim (`just the API changes · 9/31 hunks`). Shedding order as the terminal narrows: the word `hunks`, then the whole segment — but only after the gauge and thread count have gone.

**Width arithmetic you will hit.** At 110 columns the non-shrinkable status segments already spend 88 columns (` revue ` 7 + gauge 9 + ` 3/9 files ` 11 + coverage 24 + ` 2 threads │` 12 + ` Patch │` 8 + ` ? help · q quit ` 17). The context segment gets what is left and truncates, which is what `StatusBar` already does. When a copy notice is up there is room for one of the three: **the notice wins, the context segment drops to `Ch 3/4`, and the thread count yields.** See frame `10d`.

### 4. Yanking the narration — frame `10d`

Prose selects with the pointer and yanks with `y`. Right-click opens the same `MenuPanel` the diff uses — `background` fill, `muted` border, `  label` + right-aligned hint, `border`-coloured separators — with only the verbs prose can answer:

```
┌────────────────────────────────┐
│  Copy selected text          y │
│  Copy with chapter reference   │
│  ──────────────────────────────│
│  Copy path:line         Ctrl+Y │   ← disabled, muted
└────────────────────────────────┘
```

`Copy with chapter reference` prepends the chapter heading and quotes the prose:
```
Ch 3 · Wire org ID through the API layer
> Now that the schema carries org_id, the handlers thread it through to the client.
```
Notice: `Copied narration · Ch 3`. Plain yank keeps the existing `Copied N selected lines`.

No GitHub link (prose has no line), no comment verb.

## Interactions & behaviour

| Action | Key / gesture | Notes |
|---|---|---|
| Fold / open an excerpt | click the band, or `return` when the excerpt is focused | `return` is already `toggle-file-diff`; extend it to the focused excerpt segment |
| Select excerpt lines | drag the line-number gutter | identical to a diff line; the gutter is live |
| Yank selection | `y` (`copy-selection`) | works on excerpt code and on prose |
| Pointer menu on excerpt lines | right-click | full `buildRangeMenu`: copy text, copy `path:line`, copy GitHub link, comment on selection |
| Comment on excerpt lines | `Enter` on a selection | a new anchor kind; see ADR 0007 |
| Pointer menu on prose | right-click | reduced set, above |
| Mark an interlude read | `x` (`toggle-chapter-review`) | unchanged |
| Next / previous page | `]c` / `[c` | interludes are ordinary pages |

**No new keybindings are required.** Nothing in `keymap.ts` needs adding; `n` was reserved for narration comments in an earlier round and is no longer needed.

**Copy link is available on excerpt lines.** An excerpt comes from a run's pinned blob, so `permalinkFor` resolves as it does for a diff line, subject to the usual `permalinkBlocker` rules.

## State

- **Fold state per excerpt** — session state, alongside `collapsedFiles` in `ReviewSessionState` (`.revue/state.json`). Default folded. Not part of the immutable run.
- **Excerpts contribute nothing to progress.** Not in `ViewState`, not in the gauge, not in `N/M files`, no checkbox.
- **Interludes do participate** in chapter progress: `isChapterReviewed` works as for any chapter, and an interlude with no files auto-completes on `x` alone.
- **Coverage numbers come from the run**: narrated hunk count over total hunk count, both derivable from `chapters.json` + `hunks.txt`. Nothing new to persist.
- **Thread anchors** for excerpt lines are a new anchor kind keyed to the immutable `runId`. Regenerating a narrative at a different depth may orphan them; no comms designed for that yet.

## Design tokens

Slot names from `@revue/theme`. Hex values are the `ayu-dark` derivation, for reference only — **read the slots, never hardcode**.

| Use | Slot | ayu-dark |
|---|---|---|
| Page / excerpt body | `background` / `contextBg` | `#10141c` |
| Excerpt + diagram header, hunk headers, file headers | `panel` | `#1e2228` |
| Menu bar, status-bar ends, active index row | `panelAlt` | `#25282e` |
| Rules, dividers, menu separators | `border` | `#303238` |
| Body text, quoted code | `text` | `#bfbdb6` |
| Labels, captions, folded-band text, coverage lines | `muted` | `#acadb0` |
| Excerpt rule glyph `│`, line numbers | `lineNumberFg` | `#a4a6a9` |
| Section headings (`Files (N)`) | `heading` | `#99bbdb` |
| Titles, actions, `[▼ show N lines]`, `[▲ hide]` | `accent` | `#73b8ff` |
| Selection tint on excerpt lines | `selectedHunk` | `#293d55` |
| Reviewed marks, additions, copy notices | `badgeAdded` / `addedSignColor` | `#70bf56` |
| Deletions, errors | `badgeRemoved` / `removedSignColor` | `#f26d78` |

**No new theme slots are required.** The excerpt reads as scenery precisely because its body is the unstyled page. If a tinted band is ever wanted, that is one new derivation slot — `excerptBg`, text blended toward the background at 6% on dark and 3% on light, floored so `text` still clears 4.5:1, weaker than any diff tint by construction. Transparent mode would drop it with the other neutral surfaces, leaving the rule and the header word to carry the cue.

Syntax colours in the mock are Shiki's `ayu-dark` token colours; in the product they come from `theme.syntaxTheme` via the existing highlighting path. Nothing to do.

## Copy — every new string, verbatim

| String | Where |
|---|---|
| `⋯  context · {path} {start}–{end}  [▼ show N lines]` | folded excerpt; the default state |
| `context · {path} {start}–{end} · unchanged` | open excerpt header; drop `· unchanged` below ~100 cols |
| `[▲ hide]` | right of that header |
| `diagram · ascii` | ASCII diagram header |
| `diagram · mermaid source` | Mermaid diagram header |
| `¶ interlude · nothing to review here` | under an interlude's title, once |
| `── end of chapter ──` | closes an interlude's content column |
| `x mark this page read · ]c next page` | the interlude's two keys, dim, below the close |
| `10,000ft · 12/40 hunks` | status-bar segment; freeform depths substitute the agent's label |
| `▾ Chapters (4) · 10,000ft` | index header on a partial run |
| `   12 of 40 hunks · rest in Files` | index line under it; both absent at full depth |
| `Copy selected text` | pointer-menu item on prose (`y` does the same) |
| `Copy with chapter reference` | second item; prepends `Ch 3 · {title}` and quotes the prose |
| `Copied narration · Ch 3` | its status notice |

British English, sentence case, no exclamation marks — matching `What to review`, `All files`, `No comments in this review yet.`

## Where to change what

| Change | File |
|---|---|
| Excerpt block: fold band, header, rows, gutter behaviour | `packages/diff-opentui/src/components.tsx` — model on `ExpanderBand` + `Gutter` + `LineContent`; add an excerpt row kind to the plan in `@revue/diff` so heights stay measurable |
| Excerpt chrome widths | `packages/diff-opentui/src/styles.ts` (`OPENTUI_DIFF_CHROME`) — no changes needed, reuse the existing slots |
| Placing excerpts in the chapter stream | `packages/tui/src/app.tsx` `ChapterView` (~1565) and its window plan |
| Interlude page: sidebar entry, glyph, no file list | `app.tsx` `PageIndexRows` (~284), `ChapterBrief` (~458), `FileList` (~900) |
| Interlude close + keys | `app.tsx` `ChapterView` |
| Coverage segment | `packages/tui/src/statusBar.tsx` |
| Coverage index line | `app.tsx` `ChapterPanel` (~509), the `Chapters (N)` header row |
| Prose selection + pointer menu | `app.tsx` `buildRangeMenu` (~2238) — add a reduced variant; `menu.tsx` `ContextMenu` unchanged |
| Fenced code blocks in narration | `packages/tui/src/markdown.tsx` — the one renderer addition; reuse the excerpt chrome |
| Fold state | `ReviewSessionState`, beside `collapsedFiles` |

## Two engineering notes

1. **Fold state must live in the plan.** A folded excerpt is one row and an open one is `header + caption + N lines`; viewport windowing (ADR 0012) mounts only near-window rows and needs measurable heights, so the fold has to be an input to planning rather than something measured after mount.
2. **Excerpt content source is undecided upstream.** Snapshots only exist for files *in* the diff, so quoting an untouched file means either embedding the excerpt text in `chapters.json` or extending `prep`. The design assumes any file can be quoted.

## Out of scope

Files surface layout, prologue internals, menus, diff row anatomy (gutter, tints, intra-line emphasis), semantic view, live re-zooming inside the TUI, comment threads on narration.

## Files in this bundle

- `Revue - narrative depth.dc.html` — the design. Section D (`#t10`) is what to build; frames `10c`, `10a`, `10b`, `10d`.
- `2026-08-07-narrative-depth.md` — the original brief.
- `github.md` — the source association and screen map for the repo this was designed against (`mtford90/revue`, branch `master`).
