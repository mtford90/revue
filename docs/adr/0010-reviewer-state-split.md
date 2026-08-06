# ADR 0010 — Preferences belong to the reviewer; progress belongs to the repository

- Status: accepted
- Date: 2026-08-05

## Context

Preferences (theme, layout, view mode, display modes) originally persisted per repository in
`./.revue/`, so every checkout forgot the reviewer's choices. Meanwhile run progress and session
position are meaningless outside the repository whose runs they describe. Two different lifetimes
were sharing one location.

## Decision

State splits by owner:

- **Reviewer-owned, machine-wide** — `~/.revue/`:
  - `preferences.json` — machine-written on UI actions: theme id, layout, view mode, path/file
    display modes.
  - `keybindings.json` and `themes/` — hand-edited, machine-untouched (ADRs 0008, 0009).
- **Repository-owned** — `./.revue/`:
  - `state.json` — review progress plus per-page session state (focused file/hunk/question,
    collapsed files, scroll offsets), keyed by run key.
  - `threads.json` and `runs/` per ADRs 0003 and 0004.

Within `~/.revue`, the load-bearing boundary is **machine-owned versus user-owned**: files the TUI
rewrites must never share a file with hand edits, or comments and formatting are clobbered. New
config surfaces must pick a side before picking a filename.

All preference and state writes are non-fatal: a read-only checkout still reviews; it just forgets
the choice.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Per-repository preferences (status quo) | Rejected | The reviewer's theme is not a property of the repository. |
| One merged state file | Rejected | Mixes lifetimes and owners; a repo wipe would eat preferences, a machine move would eat progress. |
| XDG config directories | Rejected | `~/.revue` matches the existing `~/.revue`-adjacent conventions of comparable tools and keeps all reviewer state discoverable in one place. |
| Persist layout choices per run in view state | Rejected | View state is review progress; layout is ephemeral session taste. |
| Reviewer-owned `~/.revue` split from repo-owned `./.revue` | Chosen | Each artefact lives with its owner and lifetime. |

## Consequences

- Three artefacts already share the `~/.revue` contract (preferences, keybindings, themes); this
  ADR names the rule they follow.
- Sidebar and diff-layout preferences are deliberately session-only — not persisted anywhere.
- `./.revue/state.json` is safe to delete (loses progress, nothing else); `~/.revue` is safe to
  copy between machines.
