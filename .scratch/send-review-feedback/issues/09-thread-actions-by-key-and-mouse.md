# 09 — Thread actions by key and by mouse

Status: todo

## Parent

.scratch/send-review-feedback/PRD.md

## Why

Every action in the TUI must work by keyboard and by mouse, every button must show its key, and a
footer hint must appear only while its action applies. Send breaks this today: the Comments
surface has no click target for Send, the thread card's `[Reply]`, `[Resolve]` and
`[Delete thread]` buttons have no keys, and there is no way to send one thread on its own.

## What to build

### Send one thread

`FeedbackController.send(copyPrompt?, { threadIds? })` narrows the batch to those ids (still
filtered through the unsent rule). The id-based unsent rule already leaves the other threads
unsent, so a later `S` carries only what is left. Outcomes and notices are unchanged.

### The focused thread

One resolver, shared by the page and the Comments surface, names the thread an action applies
to: on Comments, the selected row; on the page, the cited-thread row the chapter cursor is on
(`focusedThreadRef`), or the conversation that is open (`threadFocusTarget`). With nothing
focused an action shows the notice "No thread focused — o opens Comments" and does nothing.

### Keys (global context, shifted letters, all free on master)

| Key | Action id             | Effect on the focused thread                              |
| --- | --------------------- | --------------------------------------------------------- |
| `A` | `send-thread`         | Send this thread to the agent (notice as for `S`)          |
| `R` | `reply-thread`        | Open the reply composer                                    |
| `X` | `toggle-thread-status`| Resolve, or reopen when resolved                           |
| `D` | `delete-thread`       | Ask, then delete                                            |

`D` and the `[Delete]` button confirm the same way: the first press shows
"Delete this thread? D confirms · Esc cancels"; a second `D` deletes; any other key or a click
elsewhere cancels. The mouse button no longer deletes on the first click.

`A` on a thread that is not unsent shows "Already sent" and sends nothing.

### Mouse

- Comments header: `2 open · 0 resolved · 1 unsent  [Send 1 unsent to agent · S]`. The button is
  present only while something is unsent; clicking it is `S`.
- Comments rows: an `unsent` / `sent` marker after the status glyph (blank when there is no
  handoff and the thread has no human-last message, i.e. nothing to say), and a `[send A]` button
  on unsent rows.
- Thread card buttons: `[Reply R] [Resolve X]` (or `[Reopen X]`), `[Send to agent A]` on an
  unsent thread, and `[Delete D]`; each shows its key.
- Status-bar thread slot: clicking it is `S`.

### Hints — only when they apply

Footer hints follow the focused thread, in both contexts:

- unsent, open: `R reply · X resolve · A send · D delete`
- sent, open: `R reply · X resolve · D delete`
- resolved: `R reply · X reopen · D delete`
- `S send` stays as today, only while something is unsent.
- No focused thread: none of the four.

Comments keeps `Enter open` first. Existing page hints are untouched apart from the thread ones
joining them while a thread is focused.

## Acceptance criteria

- [ ] `send({ threadIds })` sends only those ids; the rest read as unsent afterwards
- [ ] `A` sends the focused thread from the page and from Comments; the Comments row `[send]` does the same
- [ ] `R`, `X`, `D` act on the focused thread in both contexts; `D` and the button both confirm first
- [ ] The Comments header button sends all unsent; the status-bar slot click sends all unsent
- [ ] Every card button shows its key
- [ ] Footer hints show exactly the actions that apply to the focused thread's state
- [ ] The help surface lists the four new actions
- [ ] Render tests cover each key and click; controller tests cover `threadIds`

## Blocked by

- 08-skill-adr-and-glossary
