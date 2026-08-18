# ADR 0008 — Derive palettes from minimal inputs; custom themes extend bundled ones

- Status: accepted
- Date: 2026-08-05

## Context

Revue once carried two palettes that a person selected by hand, one for the shell and one for the
renderer. The two palettes disagreed. Revue also carried a pinned syntax theme. Each new UI surface
needed another selection of colours, and nothing enforced readability.

Users then asked for their own themes. That request raised a known trade-off: a full palette written
by hand for each theme is slow work, it gives combinations that a reader cannot read, and it breaks
each time someone adds a new colour slot.

## Decision

`@revue/theme` derives the complete palette from four inputs: `background`, `foreground`,
`diffColors`, and `syntaxTheme`. The palette contains:

- the shell surfaces;
- the renderer rows;
- the diff tints;
- the colours of the semantic status;
- the Shiki syntax theme.

The derivation enforces the WCAG contrast floors. The core of the derivation is adapted from Hunk
v0.17.7 under the MIT licence. `THIRD_PARTY_NOTICES.md` records the provenance.

A custom theme is **a file of derivation inputs, not a palette**. Custom themes are JSONC files under
`~/.revue/themes/`. A custom theme uses `extends` on a bundled theme, or it supplies its own inputs.
After the derivation, `overrides` pins single derived slots word for word. Revue derives the names
of the overridable slots mechanically from the theme type, thus a new slot becomes overridable with
no maintenance. A custom id that is the same as a bundled id shadows the bundled theme.

The validation is lenient and applies to one file at a time. Revue drops a broken theme, or a key
with the wrong type inside a theme, and it shows an issue. It never drops the whole directory.

The package boundaries follow the pattern of a functional core and an imperative shell.
`@revue/theme` owns the schema, the derivation (`buildThemeFromInputs`), and the application of the
overrides. The TUI owns the file load, the display of the issues, the picker, and the CLI for
`revue themes` and `themes init`. The renderer takes the theme as a prop, and the shell reads one
context. Thus no package keeps a palette of its own.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Hand-picked full palettes per theme (status quo) | Rejected | The palettes disagree, some combinations are not readable, and each new slot breaks them. |
| Custom themes as full hand-authored palettes | Rejected | It gives the same problems to the users. It also adds a compatibility burden when a slot changes. |
| Strict fail-the-file validation | Rejected | One typing error would stop the whole theme of a user. The drop of one key degrades better. |
| Repo-local theme files | Rejected | A theme is the preference of the reviewer, not of the repository (see ADR 0010). |
| A separate `@revue/theme-loader` package | Rejected | Too much. A pure `parseCustomTheme` and a thin loader in the TUI are enough. |
| Derivation inputs + `extends` + `overrides` | Chosen | It matches the convention of the ecosystem (Helix, bat, delta). No user specifies every slot. The overrides are how a user customises a theme. |

## Consequences

- The file format of a custom theme is a public contract. After users write files against it, each
  change must stay backward-compatible.
- To add a theme slot, update the derivation one time. The bundled themes and the custom themes then
  inherit the slot.
- Because of the WCAG floors, the derivation of a custom theme cannot make text that a reader cannot
  read. Only an explicit `overrides` entry can do that, and the user makes that choice deliberately.
- The domain package owns the schema, and the consumer owns the acquisition. This split is the
  template for future configuration surfaces.
