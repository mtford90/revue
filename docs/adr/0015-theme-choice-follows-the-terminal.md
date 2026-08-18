# ADR 0015 — A theme choice is a light/dark pair the terminal chooses between

- Status: accepted
- Date: 2026-08-08

## Context

Revue remembered one `themeId`. `--theme auto` existed, but it chose between the two hardcoded Ayu
defaults. Some terminals follow the light/dark setting of the system. A reviewer with such a
terminal could have the theme that they picked, or a theme that matched their terminal, but not
both. Nothing held a second preference. Nothing changed when a terminal changed its appearance
during a review.

## Decision

A theme choice is `{ themeId, lightThemeId, darkThemeId }`. `themeId` pins one theme. `auto`, or the
absence of a value, gives the choice to the terminal, and the terminal picks one half of the pair.
The absence of a value is now the default. Revue treats a terminal that never reports its background
as dark.

A half with no name, and an id that no longer names a theme, fall back to the Ayu defaults. Thus a
deleted custom theme leaves the reviewer with readable text, not with unstyled text. Either half can
be a custom theme.

`resolveThemeChoice` in `@revue/theme` is the only resolver. The shell holds two items of state: the
choice, and the appearance that the terminal reports. The shell derives the theme from both. Thus a
`theme_mode` report repaints during a review through the same path as a pick.

The picker stays one flat list. `a` toggles `follow terminal`. While the toggle is on, `Enter` files
the highlighted theme under its own appearance, and both halves stay marked. If you pick the half
that the terminal does not ask for now, the screen does not change. Thus the status bar gives the
name of the half that moved.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| One theme id, `auto` picking the Ayu defaults (status quo) | Rejected | You could follow the terminal, or choose your own theme, but not both. |
| Three-way Auto/Light/Dark mode header in the picker | Rejected | It adds more chrome and more keys to explain than the toggle, for the same two slots. |
| A separate light-theme picker | Rejected | It doubles the surface. The list already groups the themes by appearance and labels them. |
| Adopt the pinned theme into its half when following is switched on | Rejected | It overwrites a half that the reviewer set deliberately, and it gives no message. |
| Pair plus a follow toggle, filling the half by appearance | Chosen | One list sets both halves. The mark and the appearance column already carry the state. |

## Consequences

- A live follow needs a terminal that reports its appearance changes. A terminal that does not
  report them still resolves correctly at launch.
- `--theme-light` and `--theme-dark` join `--theme` as overrides for one run. Revue validates all
  three at the start.
- A custom theme can now satisfy a followed choice. The resolver with one id never allowed this.
