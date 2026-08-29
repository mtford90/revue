# 07 — Clipboard fallback outside a host

Status: ready-for-agent

## Parent

.scratch/send-review-feedback/PRD.md

## What to build

In a plain terminal with no compatible host, Send copies the one-line wake-up prompt to the
clipboard (the existing local-plus-OSC-52 copy), rewrites the record as `copied`, and shows
"Queued for polling — prompt copied (N threads)". The reviewer pastes the prompt into the agent
by hand. When the copy reports failure the record stays `queued` and the notice says so.

## Acceptance criteria

- [ ] Without a host, Send writes `copied` and the clipboard holds the prompt
- [ ] A failed copy leaves `queued` with the queued notice
- [ ] The prompt carries no thread content
- [ ] Controller tests use a fake clipboard

## Blocked by

- 01-handoff-record-and-send-action
