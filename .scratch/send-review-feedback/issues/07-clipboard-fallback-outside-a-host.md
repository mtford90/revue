# 07 — Clipboard fallback outside a host

Status: done

## Parent

.scratch/send-review-feedback/PRD.md

## What to build

In a plain terminal with no compatible host, Send copies the one-line wake-up prompt to the
clipboard (the existing local-plus-OSC-52 copy), rewrites the record as `copied`, and shows
"Saved — prompt copied, paste it into your agent (N threads)"; a host that reached no terminal copies too, with "Saved, but no terminal reached — prompt copied, paste it into your agent (N threads)". The reviewer pastes the prompt into the agent
by hand. When the copy reports failure the record stays `queued` and the notice says so.

## Acceptance criteria

- [x] Without a host, Send writes `copied` and the clipboard holds the prompt
- [x] A failed copy leaves `queued` with the queued notice
- [x] The prompt carries no thread content
- [x] Controller tests use a fake clipboard

## Blocked by

- 01-handoff-record-and-send-action
