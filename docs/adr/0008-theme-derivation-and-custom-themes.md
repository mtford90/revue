# ADR 0008 — Derive palettes from minimal inputs; custom themes extend bundled ones

- Status: accepted
- Date: 2026-08-05

## Context

Revue once carried two hand-picked palettes (shell and renderer) that disagreed, plus a pinned
syntax theme. Every new UI surface forced another round of colour picking, and nothing enforced
readability. Users then asked for their own themes, which raised the classic trade-off: a full
hand-authored palette per theme is tedious, produces unreadable combinations, and breaks every time
a new colour slot is added.

## Decision

`@revue/theme` derives the complete palette — shell surfaces, renderer rows, diff tints, semantic
status colours, and the Shiki syntax theme — from four inputs: `background`, `foreground`,
`diffColors`, `syntaxTheme`. Derivation enforces WCAG contrast floors. The derivation core is
adapted from Hunk v0.17.7 under MIT with provenance in `THIRD_PARTY_NOTICES.md`.

Custom themes are **derivation-input files, not palettes**: JSONC files under `~/.revue/themes/`
that either `extends` a bundled theme or supply their own inputs, with `overrides` pinning
individual derived slots verbatim afterwards. The overridable slot names are derived mechanically
from the theme type, so new slots become overridable without maintenance. A custom id matching a
bundled one shadows it.

Validation is lenient and per-file: a broken theme, or a wrong-typed key within one, is dropped
with a surfaced issue — never the whole directory. Package boundaries follow functional-core /
imperative-shell: `@revue/theme` owns schema, derivation (`buildThemeFromInputs`), and override
application; the TUI owns file loading, issue surfacing, the picker, and the `revue themes` /
`themes init` CLI. The renderer takes the theme as a prop and the shell reads one context, so no
package keeps a palette of its own.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Hand-picked full palettes per theme (status quo) | Rejected | Disagreeing palettes, unreadable combinations, breaks on every new slot. |
| Custom themes as full hand-authored palettes | Rejected | Same problems exported to users, plus a compatibility burden on slot changes. |
| Strict fail-the-file validation | Rejected | One typo would kill a user's whole theme; per-key dropping degrades gracefully. |
| Repo-local theme files | Rejected | A theme is the reviewer's preference, not the repository's (see ADR 0010). |
| A separate `@revue/theme-loader` package | Rejected | Overkill; a pure `parseCustomTheme` plus a thin loader in the TUI suffices. |
| Derivation inputs + `extends` + `overrides` | Chosen | Matches ecosystem convention (Helix, bat, delta): nobody specifies every slot; overrides are the customisation currency. |

## Consequences

- The custom theme file format is a public contract; changes must remain backward-compatible once
  users author files against it.
- Adding a theme slot means updating derivation once; bundled and custom themes inherit it.
- WCAG floors mean a custom theme cannot produce unreadable text through derivation — only
  explicit `overrides` can, and that is the user's deliberate choice.
- The domain-package-owns-schema / consumer-owns-acquisition split is the template for future
  config surfaces.
