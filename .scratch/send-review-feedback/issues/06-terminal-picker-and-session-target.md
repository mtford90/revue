# 06 — Terminal picker and session target

Status: ready-for-agent

## Parent

.scratch/send-review-feedback/PRD.md

## What to build

When Orca has more than one other terminal and no live origin, Send opens a picker overlay (like
the theme picker) that lists sanitised titles, most recent output first. Choosing one delivers
there and remembers it as the session target, which then wins over the recorded origin for later
Sends. A session target that vanishes is forgotten and resolution falls through to the origin and
the picker. Escape closes the picker and leaves the record `queued`.

Under Orca the File menu gains "Send feedback to another terminal…", which opens the picker even
when an origin is alive.

## Acceptance criteria

- [ ] The picker opens when more than one candidate exists and no origin or session target is live
- [ ] A chosen terminal is delivered to and reused by the next Send without a prompt
- [ ] A vanished session target falls through to the origin, then the picker
- [ ] Escape leaves the record `queued` with the queued notice
- [ ] The menu item opens the picker even when an origin is live, and the choice becomes the session target
- [ ] Render tests drive the picker with a fake controller; controller tests cover the order

## Blocked by

- 05-orca-delivery-to-the-agent-terminal
