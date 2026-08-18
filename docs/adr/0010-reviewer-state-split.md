# ADR 0010 — Preferences belong to the reviewer; progress belongs to the repository

- Status: accepted
- Date: 2026-08-05

## Context

Revue first kept the preferences in `./.revue/`, with one copy for each repository. The preferences
are the theme, the layout, the view mode, and the display modes. Thus each new checkout lost the
choices of the reviewer. But the run progress and the session position have no meaning outside the
repository that holds their runs. One location held two different lifetimes.

## Decision

The state splits by owner:

- **Reviewer-owned, machine-wide** — `~/.revue/`:
  - `preferences.json` — the machine writes this file on UI actions. It holds the theme id, the
    layout, the view mode, and the display modes for paths and files.
  - `keybindings.json` and `themes/` — the user edits these by hand, and the machine does not write
    to them (ADRs 0008, 0009).
- **Repository-owned** — `./.revue/`:
  - `state.json` — the review progress and the session state of each page, keyed by run key. The
    session state holds the focused file, hunk, or question, the collapsed files, and the scroll
    offsets.
  - `threads.json` and `runs/` per ADRs 0003 and 0004.

Inside `~/.revue`, the important boundary is **machine-owned against user-owned**. Data that the TUI
rewrites must never share a file with hand edits. If it does, the rewrite destroys the comments and
the format. A new config surface must choose its side before it gets a filename.

A failed write of a preference or of the state is never fatal. A read-only checkout still permits a
review. It only forgets the choice.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Per-repository preferences (status quo) | Rejected | The theme of the reviewer is not a property of the repository. |
| One merged state file | Rejected | It mixes the lifetimes and the owners. A deletion of the repository data destroys the preferences. A move to another machine destroys the progress. |
| XDG config directories | Rejected | `~/.revue` agrees with the conventions of comparable tools, and it keeps all reviewer state in one place. |
| Persist layout choices per run in view state | Rejected | The view state is review progress. The layout is a short-lived choice for one session. |
| Reviewer-owned `~/.revue` split from repo-owned `./.revue` | Chosen | Each artefact lives with its owner and its lifetime. |

## Consequences

- Three artefacts already obey the `~/.revue` contract: the preferences, the keybindings, and the
  themes. This ADR gives a name to the rule that they follow.
- Revue keeps the sidebar preference and the diff-layout preference for one session only. Revue
  writes them to no file. This is deliberate.
- You can delete `./.revue/state.json` safely: you lose the progress and nothing more. You can copy
  `~/.revue` between machines safely.
