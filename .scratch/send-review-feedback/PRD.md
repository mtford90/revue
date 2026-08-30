# PRD: Send review feedback to an agent

Status: ready-for-agent
Linear: REV-3

## Problem Statement

The reviewer reads the narrated chapters and leaves threads. Then the reviewer must go to the
agent's terminal and tell the agent in chat to check the threads. Revue does not do this step. The
reviewer must remember the words, find the correct terminal, and type the message. When the agent
is in a different harness, the reviewer must also know how that harness accepts a prompt.

An agent that waits for feedback has no signal either. It must poll `revue status` in a loop, or
wait for the reviewer to speak in chat.

The reviewer also has no view of what is sent and what is not. After a long review, the reviewer
cannot tell which comments the agent has seen.

## Solution

Add one action to the TUI: **Send to agent**. One key or one menu item sends every **unsent**
thread: an open thread where a human spoke last, and that message is newer than the last handoff.
This one rule serves two flows. After one comment, the unsent set is that comment, and a light
notice offers to send it now. After a full pass, the unsent set is the whole batch.

The action always writes a **handoff** record to disk first. The handoff is the durable path: an
agent reads it with `revue status`, and blocks on it with `revue status --wait`. Threads do not
change; they stay the feedback itself.

When the host can deliver a message to a terminal, Revue also sends a short wake-up prompt to the
agent. The first host is Orca. The target is the terminal of the agent that last did agent-side
work on this review. Revue records that terminal on the agent side, when the agent runs
`revue prep` or `revue threads reply`. When that terminal is gone, Revue shows a picker of the
other terminals in the worktree. When there is no compatible host, Revue copies the wake-up prompt
to the clipboard, and the reviewer pastes it into the agent by hand. The same happens when a host
is present but reaches no terminal, so the reviewer always has a manual path.

One slot in the status bar shows the state of the feedback: how many threads are unsent, or that
the last batch was sent and whether it was delivered or queued. A notice tells the reviewer the
result of each Send.

## User Stories

### Sending

1. As a reviewer, I want one key that sends my review feedback to the agent, so that I do not
   leave the TUI to tell the agent about my threads.
2. As a reviewer, I want the same action in the File menu, so that I can find it without the
   shortcut.
3. As a reviewer, I want Send to work from every surface, the Comments surface included, so that
   I can send from wherever I am.
4. As a reviewer, I want Send to include every unsent thread, so that one press after a full pass
   sends the whole batch.
5. As a reviewer, I want Send after one new comment to include only that comment, so that I can
   send feedback as I go.
6. As a reviewer, I want a light notice after I post a comment that tells me the key to send it
   now, so that the immediate flow is discoverable without a dialog.
7. As a reviewer, I want threads that already have the agent's reply excluded from Send, so that
   the agent does not receive its own answers again.
8. As a reviewer, I want a notice when nothing is unsent, so that I know why nothing was sent.
9. As a reviewer, I want Send ignored while a previous Send is still in flight, so that two
   presses do not produce two conflicting records.

### Durability

10. As a reviewer, I want Send to record the handoff on disk before any delivery, so that the
    feedback survives a failed delivery.
11. As a reviewer, I want a failed record write to stop the delivery, so that the agent is never
    told about a batch that is not on disk.
12. As an agent, I want the record on disk to be the source of truth, so that the wake-up prompt
    can be lost without loss of feedback.

### Delivery

13. As a reviewer, I want Send to reach the agent's terminal in Orca with no question, so that the
    common case is one key press.
14. As a reviewer, I want a picker of the worktree's terminals when the agent's terminal is gone,
    so that I can send the feedback to a new agent.
15. As a reviewer, I want a menu item that opens the picker on demand, so that I can choose a
    different agent even when the original terminal is alive.
16. As a reviewer, I want the picker to remember my choice for the session and to prefer it over
    the recorded origin, so that a second Send goes where I said.
17. As a reviewer, I want a vanished session choice to fall through to the recorded origin and then
    to the picker, so that a closed terminal does not strand my feedback.
18. As a reviewer, I want the wake-up prompt copied to the clipboard when no host can deliver it,
    or when the host reached no terminal, so that I can paste it into the agent by hand.
19. As a reviewer, I want a failed Orca delivery, a failed terminal list, or a failed clipboard
    copy to fall back to queued with no error dialog, so that a host problem does not stop my
    review.
20. As a reviewer, I want Send to work when the TUI runs in a plain terminal, so that the feature
    does not depend on Orca.

### Visibility

21. As a reviewer, I want the status bar to show how many threads are unsent, so that I never
    finish a review with feedback the agent has not seen.
22. As a reviewer, I want the status bar to show that the last batch was sent, and whether it was
    delivered or queued, so that I can check the outcome after the notice fades.
23. As a reviewer, I want that state in the one slot the thread count already uses, so that the
    status bar does not grow.
24. As a reviewer, I want the slot to shrink sensibly on a narrow terminal, so that the bar does
    not overflow.
25. As a reviewer, I want the footer hints to show the send key while something is unsent, so
    that the key is discoverable.
26. As a reviewer, I want a notice that says "delivered to <terminal>", "queued", or "queued,
    prompt copied", so that I know if the agent was told.
27. As a reviewer, I want `revue status` without `--json` to print the last handoff, so that I can
    check what was sent from a shell.

### Agent side

28. As an agent, I want `revue status --json` to report the last handoff with its id, thread ids,
    and delivery result, so that I know which batch the reviewer sent.
29. As an agent, I want the handoff's thread ids resolved against the current active or pending
    run, so that a supersession does not hide the threads from me.
30. As an agent, I want `revue status --wait` to block until a handoff with a new id appears, so
    that an unattended loop does not poll in a busy loop.
31. As an agent, I want `--wait` to return at once when a newer handoff already exists, so that a
    handoff written before I started to wait is not lost.
32. As an agent, I want `--wait` to accept a timeout and a "since" handoff id, so that I do not
    wait forever and do not re-read a handoff I already handled.
33. As an agent, I want `revue prep` and `revue threads reply` to record my Orca terminal and the
    run I worked on, so that the reviewer's Send reaches me and not another pane or another
    review.
34. As an agent, I want the wake-up prompt to tell me to run `revue status --json` and follow the
    feedback step of the skill, so that a cold session knows what to do.
35. As an agent, I want the skill to name the wake-up prompt as a trigger of the feedback step, so
    that I route the prompt correctly.

### Maintenance

36. As a maintainer, I want host detection and delivery behind one small interface, so that a
    second host can be added without changes to the TUI action.
37. As a maintainer, I want the thread store schema unchanged, so that old thread files keep
    parsing and ADR 0004 holds.
38. As a maintainer, I want an ADR that records why the handoff is a repo-level record and why
    delivery is only a nudge, so that the next change starts from the reasons.

## Implementation Decisions

### Records

- **Handoff record.** Send writes one file, `.revue/handoff.json`, next to the thread store. It
  holds `schemaVersion`, `handoffId` (a UUID), `requestedAt`, `runId`, `threadIds`, and
  `delivery`. `delivery` is one of: `queued`; `delivered` with `host`, `terminal` handle, and
  terminal `title`; `copied`. Each Send overwrites the file. Writes are atomic, as the thread
  store's are, and go through the same lock. The schema is a Zod schema in the types package.
- **`handoffId` is the identity.** `requestedAt` is informational. Two Sends in one millisecond,
  or a clock that moves backwards, must not confuse a waiter.
- **`runId` means "requested against".** It is not the lookup key. Threads move across
  supersession (ADR 0018), so `revue status` resolves `threadIds` against the current active or
  pending run and reports the ones it finds. The handoff itself does not migrate.
- **Unsent.** A thread is unsent when it is open, its last message is from a human, and either
  the last handoff does not name its id or that message's `createdAt` is later than the handoff's
  `requestedAt` (or there is no handoff). Thread ids are stable across supersession, so a second
  review in the same repository cannot mark this one as sent. This is derived; nothing is written
  to threads.
- **Agent origin.** Agent-side CLI commands record the agent's pane in `.revue/agent.json`:
  `schemaVersion`, `host`, `paneKey`, `worktreeId`, `runId`, `recordedAt`. The commands are the
  top-level `revue prep` and `revue threads reply`, after they succeed. The record is not written
  from the prep library: the TUI's reload path calls the same library, and would record the
  reviewer's own pane. A failed origin write is a warning on stderr, never a command failure.
  Outside Orca the commands write nothing. The record is repo-level, not in `run.json`, because
  prep returns an existing run early and the origin must follow the latest agent.
- **Malformed records.** A malformed handoff or origin file is reported in the status JSON as a
  warning and treated as absent. It must not stop `revue status`; orientation is a cold-start
  need and the threads are still valid.

### Host

- **Host module.** One module detects the host and talks to it. Interface: `detectHost`,
  `listTerminals`, `sendToTerminal`. Orca is present when `ORCA_WORKTREE_ID` and `ORCA_PANE_KEY`
  are set. The CLI executable is `ORCA_CLI_COMMAND` when set, otherwise `orca`. Calls run without a
  shell and with a short timeout. Every CLI error becomes "no delivery", never a TUI error.
- **Own pane.** `listTerminals` lists the terminals of the active worktree and removes the TUI's
  own pane. The own pane is the terminal whose `tabId:leafId` equals `ORCA_PANE_KEY`.
- **Titles.** Terminal titles are sanitised before display or storage: control characters are
  removed, and the text is truncated to a sane length.

### Feedback controller

- One **feedback controller**, supplied to the TUI as a prop like the thread actions are, owns:
  the unsent computation, the handoff write, target resolution, the host calls, the clipboard,
  and the guarded finalisation. The TUI owns only key handling, picker state, the in-flight
  guard, and notices. Render tests use a fake controller.
- **Order of operations.** Write the record as `queued` first. If that write fails, stop and show
  an error notice. Then resolve a target and try delivery. On success, rewrite the record as
  `delivered`. On clipboard success, rewrite as `copied`. On any failure, leave `queued`.
- **Guarded finalisation.** The rewrite happens under the lock and only when the file still holds
  the same `handoffId`. A newer handoff is never overwritten by an older result.
- **Target resolution**, in order: the session target chosen in the picker, when it is still in
  the terminal list; the recorded origin, when it is in the list, with a matching `runId`
  preferred over a mismatched one; the sole remaining terminal; the picker, when Orca has more
  than one other terminal; the clipboard, when there is no host or the host reached no terminal.
  A vanished session target is forgotten.
- **Picker.** An overlay like the theme picker. It lists sanitised terminal titles, most recent
  output first. Escape closes it and leaves the record `queued`.
- **Wake-up prompt.** One line: `Review feedback is waiting in revue: run \`revue status --json\`
  and follow the revue skill's "Responding to review feedback" step.` Delivery sends the text and
  Enter. The prompt carries no thread content.

### TUI

- **Keymap and menu.** New keymap action `send-to-agent`, key `S`, global context, Review
  section. It is dispatched once, before the page and Comments splits, so it works on every
  surface. Lowercase `s` (sidebar) is unaffected; the registry expands `S` to `shift+s`. File
  menu gains "Send feedback to agent". Under Orca the File menu also gains "Send feedback to
  another terminal…", which opens the picker.
- **Status bar slot.** The existing thread-count slot becomes one state-driven slot; nothing is
  added beside it. States: `3 threads` (nothing unsent, no handoff); `3 threads · 2 unsent`
  (something unsent); `3 threads · sent ✓`, `3 threads · copied ⧉`, or `3 threads · not sent ⚠`
  (a handoff exists and nothing is unsent since it; delivered, copied, or queued). Narrow width
  keeps only the state half (`2 unsent`, `sent ✓`);
  tiny width drops the slot as today. The slot reads the handoff through the existing run watcher
  extended with the handoff path, so the TUI reflects the file, not memory.
- **Footer hint.** `S send` appears in the footer hints while unsent > 0.
- **Notices.** The existing timed notice tells the reviewer whether the agent was told or what to
  do themselves: "Sent to <title> (N threads)"; "Saved — prompt copied, paste it into your agent
  (N threads)" with no host; "Saved, but no terminal reached — prompt copied, paste it into your
  agent (N threads)" when a host reached nobody; "Saved, but not sent — tell your agent to run
  revue status (N threads)" when the clipboard failed too or the picker was dismissed; or
  "Nothing to send". "Queued" and "polling" never appear in the TUI.
  After a comment is posted, the notice reads "Comment added — S sends it to the agent".
- **In-flight guard.** While a Send awaits the host, further presses show "Sending…" and do
  nothing.

### CLI

- **`revue status`.** The report gains `handoff`: the parsed record plus `resolvedThreadIds` (the
  ids found on the current run), or null. The human format prints it. New flags: `--wait`,
  `--since <handoffId>`, `--timeout-ms <n>` (default 15 minutes). `--wait` returns the report
  when a handoff whose id differs from `--since` exists, at once if it already does; exits with a
  distinct non-zero code on timeout; rejects `--since` without `--wait`.
- **Waiter.** A dedicated race-free waiter: read, watch the `.revue` directory, read again, then
  wait for events. It is separate from the TUI run watcher, which stays TUI-specific.
- **Skill.** The feedback step lists the wake-up prompt as a trigger. The orient section documents
  `handoff`, `resolvedThreadIds`, and `--wait`. A short note says which commands record the agent
  origin.

### Docs

- ADR **0020** records the handoff design. (ADRs 0004, 0011, 0013, 0016, and 0017 link to a
  `0019-agent-directed-review-granularity.md` that does not exist; that is a separate loose end
  and this work does not touch it.)
- `CONTEXT.md` gains **handoff**, **unsent**, and **agent origin**.
- The changelog is generated from commits; use `feat:` commits.

## Testing Decisions

A good test drives an existing seam and asserts only what a user or an agent can observe: a file
on disk, JSON on stdout, a notice or a slot on screen. No test asserts on a call to an internal
function.

- **Feedback controller seam** (new; prior art: the thread store tests with a scratch
  repository). The controller runs against a scratch `.revue` directory, a fake host, and a fake
  clipboard. Tests cover: the unsent rule across no handoff, an older handoff, and a reply from
  the agent; the queued-then-delivered sequence; queued-then-copied; every fallback (list
  failure, send failure, clipboard false, escape from the picker); the target order including a
  vanished session target and a `runId` mismatch; guarded finalisation when a newer handoff lands
  mid-flight; a failed initial write that stops delivery.
- **Host module seam** (new, small). `ORCA_CLI_COMMAND` points at a fake `orca` script in a
  temporary directory. The script prints canned `terminal list` JSON and records the arguments of
  `terminal send`. Tests cover own-pane removal, title sanitising, and CLI failure as "no
  delivery". This seam is new because a real Orca is not available in tests, and the CLI override
  is the documented way to substitute one.
- **CLI process seam** (prior art: `revue status` and `revue threads` tests that spawn the binary
  in a scratch repository). `handoff` present, absent, and malformed; `resolvedThreadIds` after a
  supersession; `--wait` returns at once for an existing newer handoff, returns when a new one
  lands, and exits non-zero on timeout; `revue prep` and `revue threads reply` write the origin
  under Orca variables and nothing without them; a deduplicated prep still updates the origin; a
  failed prep or reply does not.
- **TUI render seam** (prior art: app render tests that inject events). With a fake controller:
  `S` sends from the page and from the Comments surface and `s` still toggles the sidebar; the
  slot shows each of its states at wide and narrow widths; the hint appears only while unsent >
  0; the notices for each outcome; the composer notice; the picker opens when the controller asks
  for a choice; the in-flight guard.
- **Skill**: no automated seam. `revue show --check` and manual runs validate the prose.

## Out of Scope

- A second host. The host module has room for one, but this work adds only Orca.
- Delivery of the thread content itself. The prompt is a nudge; the content stays on disk.
- A handoff history. One record, overwritten per Send.
- Per-thread Send. One Send is all unsent threads.
- A banner for unsent threads. The status bar slot is the only persistent signal.
- Any change to the thread schema or to Revuediff.
- The missing ADR 0019.
- Automated tests of the skill prose.

## Further Notes

- A second Send while the first is unanswered overwrites the record. The new record lists the
  full unsent set at that moment, so nothing is lost; the agent reads the latest.
- `revue threads reply` moves the origin to the replying agent. This is intended: the last agent
  to work the review is the one to nudge. Two reviews in one repository are told apart by the
  `runId` on the origin.
- Send ignores threads that await the reviewer. The reviewer sees them in the Comments surface
  and marks them dealt-with; they are not feedback for the agent.
- The cold-start rule of the interactive review loop holds: everything the agent needs is on disk,
  and the wake-up prompt is disposable.
