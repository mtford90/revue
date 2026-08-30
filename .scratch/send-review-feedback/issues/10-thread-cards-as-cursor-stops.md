# 10 — Thread cards as review cursor stops

Status: done

## Parent

.scratch/send-review-feedback/PRD.md

## Why

The page has no single notion of "the thread I am on". The review line cursor names only diff
lines; the Tab cycle names cited threads (`focusedThreadRef`); a jump leaves `threadFocusTarget`
behind as if it were focus. Ticket 09 unioned the three, so every card on screen shows the same
key labels and `R` can mean two threads at once. One cursor, one focus: a thread card is a stop
the line cursor can rest on.

## What to build

### Stops

`packages/tui/src/reviewLineCursor.ts` gains

```ts
type ReviewStop =
  | { kind: "line"; line: DiffLineRange }
  | { kind: "thread"; threadId: string; anchor: DiffLineRange };
```

`reviewStops(file, attachments)` lists a file's stops in order: each changed row, followed by
the cards anchored beneath it (the same matching `attachmentsForRow` uses, by anchor, so no
heights are involved). `moveReviewLine` walks stops, crossing files as today. Card stops are
side-neutral in split layout: leaving a card resumes on the preferred side.

Resolved threads are stops too; the reviewer must be able to land on one to reopen it.

### Cursor

The app's cursor state becomes a `ReviewStop`. Line-only consumers — `v` select, `e` open editor,
`h`/`l` side moves, selection extension — read the line stop and do nothing on a card (`h`/`l`
skip to the nearest line stop). `j`/`k` walk stops; `up`/`down` still scroll visual rows.

`Enter` on a card opens the reply composer (the same as `R`). Clicking a card puts the cursor on
it.

### Focus retired

- `focusedThreadRef` is removed. The Tab cycle's cited-thread entries put the cursor on that
  thread's card instead (opening the excerpt or file that holds it, as jumping does today).
- `threadFocusTarget` remains a scroll request only; landing sets the cursor on the card.
- The focused-thread resolver from ticket 09 reads the cursor on the page and `selectedThread`
  on Comments. Nothing else.

### Rendering

The card whose thread is under the cursor is the only one that shows key labels
(`[Reply R] [Resolve X] [Send to agent A] [Delete D]`) and gets the accent border; every other
card shows plain `[Reply] [Resolve] [Send to agent] [Delete]` and its current border colour.

### Hints

Footer hints follow `cursor.kind`: a line stop shows the review hints as today; a thread stop
shows only the thread hints from ticket 09 (`R reply · X resolve|reopen · A send · D delete`,
each only when it applies) plus `Enter reply`. Never both.

## Acceptance criteria

- [x] `reviewStops` interleaves cards after their anchor row; unit tests cover one card, two cards on one row, a card on a deletion-side row in split, and a resolved card
- [x] `j`/`k` land on a card between the lines around it, and cross files as before
- [x] `v`, `e`, `h`, `l` on a card do not act on the card; `h`/`l` move to a line
- [x] `Enter` and `R` on a card open the reply composer; `X`, `A`, `D` act on that card only
- [x] Only the card under the cursor shows key labels and the accent border
- [x] Tab onto a cited thread puts the cursor on its card; `focusedThreadRef` no longer exists
- [x] Jumping from Comments lands the cursor on the card
- [x] Hints show review hints on a line and thread hints on a card, never both
- [x] Existing rev-5 cursor tests still pass

## Blocked by

- 09-thread-actions-by-key-and-mouse
