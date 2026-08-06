# ADR 0009 — One typed keymap registry; lenient JSONC overrides

- Status: accepted
- Date: 2026-08-05

## Context

Shortcuts were hardcoded three times over — the keyboard handler, the help overlay, and the menu
hints — and drifted. Users then asked for configurable keybindings, which requires a single source
of truth to override against, and a config format that survives hand editing.

## Decision

All context-level shortcuts derive from one typed registry (`packages/tui/src/keymap.ts`): each
action carries an id, its keys, help text, and a context (`global`, `chord`, `page`, …). The
handler, help overlay, menu hints, and the `revue keybindings` CLI all read the registry; nothing
declares a shortcut anywhere else.

Overrides live in `~/.revue/keybindings.json`, a hand-edited JSONC map of action id → key array
(action-to-keys, not key-to-action). The contract:

- **Reserved**: escape, digits, and the raw `[`/`]` chord prefixes are unbindable, and chord
  actions cannot be rebound.
- Shifted letters expand automatically, so `"Q"` and `shift+q` are aliases.
- The merge runs to a fixed point, so a default key freed by one override is reassignable by
  another regardless of file order.
- Validation is per-entry lenient: a bad entry is dropped with a footer warning and help-overlay
  detail; the file as a whole never fails. Unreadable files warn rather than silently reset.

`revue keybindings` prints the effective map with overridden flags; `keybindings init` writes a
commented starter file. The file is user-owned and machine-untouched (see ADR 0010).

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Keep per-site hardcoded shortcuts | Rejected | Triple maintenance had already drifted. |
| Fold overrides into `preferences.json` | Rejected | The machine rewrites that file on every UI action and would clobber hand edits and comments. |
| Key-to-action mapping direction | Rejected | Action-to-keys keeps one action's bindings in one place and makes conflicts detectable. |
| Strict reject-file-on-error validation | Rejected | One typo would revert every binding mid-review. |
| Make digits and chords rebindable | Rejected | Digit jumps and chord prefixes are structural; rebinding them breaks navigation grammar. |
| A `revue.config.ts` code-based config | Deferred | Bigger scope (loader, sandboxing); if it happens, keybindings migrate in as one section. |

## Consequences

- Adding an action means adding one registry entry; help, menus, CLI, and overrides follow.
- The action ids in `keybindings.json` are a public contract; renaming an id is a breaking change.
- Fixed-point merging makes override files order-independent but means conflicts resolve by rule,
  not position — the CLI's overridden/conflict flags are the debugging surface.
