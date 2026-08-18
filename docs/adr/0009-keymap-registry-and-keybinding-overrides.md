# ADR 0009 — One typed keymap registry; lenient JSONC overrides

- Status: accepted
- Date: 2026-08-05

## Context

Three places declared the shortcuts: the keyboard handler, the help surface, and the menu hints. The
three declarations became different. Users then asked for configurable keybindings. Configurable
keybindings need one source of truth to override. They also need a config format that survives hand
edits.

## Decision

One typed registry (`packages/tui/src/keymap.ts`) holds all context-level shortcuts. Each action
carries these fields:

- an id;
- its keys;
- its help text;
- a context (`global`, `page`, or `comments`).

These surfaces read the registry:

- the keyboard handler;
- the keys surface;
- the menu hints;
- the status-bar hints;
- the `revue keybindings` CLI.

No other code declares a shortcut.

The overrides live in `~/.revue/keybindings.json`. The reviewer edits this JSONC file by hand. The
file maps an action id to an array of keys. The direction is action-to-keys, not key-to-action. The
contract has these rules:

- **Reserved**: you cannot bind escape or the digits. You can rebind every registry action.
- Shifted letters expand automatically. The same expansion applies to the defaults and to the
  overrides. Thus `"Q"` and `shift+q` are aliases, and no entry must give both.
- The merge runs to a fixed point. If one override frees a default key, another override can take
  that key. The order of the entries in the file does not change the result.
- Validation is lenient for each entry. Revue drops a bad entry, shows a warning in the footer, and
  shows the detail on the keys surface. The full file never fails. If Revue cannot read the file,
  Revue gives a warning. Revue does not reset the keys without a message.

`revue keybindings` prints the effective map with the overridden flags. `keybindings init` writes a
start file with comments. The user owns the file, and the machine does not write to it (see ADR
0010).

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Keep per-site hardcoded shortcuts | Rejected | Three copies need maintenance, and they had already become different. |
| Fold overrides into `preferences.json` | Rejected | The machine rewrites that file on each UI action. The rewrite destroys hand edits and comments. |
| Key-to-action mapping direction | Rejected | Action-to-keys keeps the bindings of one action in one place, and it shows conflicts. |
| Strict reject-file-on-error validation | Rejected | One typing error reverts every binding during a review. |
| Make digits rebindable | Rejected | The digit jumps are structural. A rebind of a digit breaks the navigation grammar. |
| A `revue.config.ts` code-based config | Deferred | The scope is larger, because it needs a loader and a sandbox. If Revue adds it, the keybindings move in as one section. |

## Consequences

- To add an action, add one registry entry. The help, the menus, the CLI, and the overrides then
  follow.
- The action ids in `keybindings.json` are a public contract. A rename of an id is a breaking
  change.
- The fixed-point merge makes the order of the entries unimportant. But rules resolve the conflicts,
  not position. To find the cause of a conflict, read the overridden flags and the conflict flags of
  the CLI.
