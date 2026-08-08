# ADR 0015 — A theme choice is a light/dark pair the terminal chooses between

- Status: accepted
- Date: 2026-08-08

## Context

Revue remembered one `themeId`. `--theme auto` existed but chose between the two hard-coded Ayu
defaults, so a reviewer whose terminal follows the system light/dark setting could have the theme
they picked, or a theme that matched their terminal, but not both. Nothing carried a second
preference, and nothing reacted when a terminal changed appearance mid-review.

## Decision

A theme choice is `{ themeId, lightThemeId, darkThemeId }`. `themeId` pins one theme; `auto` — or
its absence, which is now the default — defers to the terminal, which picks a half of the pair.
A terminal that never reports its background is treated as dark. Unnamed halves and ids that no
longer name a theme fall back to the Ayu defaults, so a deleted custom theme leaves the reviewer
readable rather than unstyled. Either half may be a custom theme.

`resolveThemeChoice` in `@revue/theme` is the single resolver; the shell holds the choice and the
terminal's reported appearance as state and derives the theme from both, so a `theme_mode` report
repaints mid-review through the same path as a pick.

The picker stays one flat list. `a` toggles `follow terminal`; while it is on, `Enter` files the
highlighted theme under its own appearance, and both halves stay marked. Picking the half the
terminal is not currently asking for changes nothing on screen, so the status bar names the half
that moved.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| One theme id, `auto` picking the Ayu defaults (status quo) | Rejected | Following the terminal and choosing your own theme were mutually exclusive. |
| Three-way Auto/Light/Dark mode header in the picker | Rejected | More chrome and more keys to explain than the toggle, for the same two slots. |
| A separate light-theme picker | Rejected | Doubles the surface; the list already groups and labels themes by appearance. |
| Adopt the pinned theme into its half when following is switched on | Rejected | Silently overwrites a half the reviewer deliberately set. |
| Pair plus a follow toggle, filling the half by appearance | Chosen | One list sets both halves; the mark and the appearance column already carry the state. |

## Consequences

- Live following depends on the terminal reporting appearance changes; terminals that do not still
  resolve correctly at launch.
- `--theme-light` / `--theme-dark` join `--theme` as per-run overrides, validated up front like it.
- Custom themes now satisfy a followed choice, which the single-id resolver never allowed.
