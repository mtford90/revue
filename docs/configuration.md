# Configure Revue

Revue separates machine preferences from repository review state.

Return to the [documentation index](README.md).

## Configuration files

Revue can use these machine files:

- `~/.revue/preferences.json` for choices that the TUI writes;
- `~/.revue/keybindings.json` for key overrides that you write;
- `~/.revue/themes/*.json` for custom themes that you write.

A repository can use these local files:

- `.revueignore` for persistent review exclusions;
- `.revue/state.json` for progress and review position;
- `.revue/threads.json` for feedback;
- `.revue/handoff.json` for the last feedback handoff;
- `.revue/runs/` for fixed review runs.

Do not edit machine-written review state while Revue is open.

## Themes

Revue uses one palette for the shell, diff rows, statuses, and syntax highlighting.

The default follows the terminal appearance:

- light terminals use `ayu-light`;
- dark terminals use `ayu-dark`;
- terminals that do not report an appearance use the dark choice.

Press `t` to open the theme picker. Press `a` in the picker to toggle terminal following. Press `Enter` to save the selected theme. Press `Escape` to cancel the preview.

When terminal following is active, Revue stores one light choice and one dark choice. The terminal selects between them.

List all themes:

```bash
revue themes
```

Choose themes for one run:

```bash
revue show <run-directory> --theme nord
revue show <run-directory> --theme auto
revue show <run-directory> --theme-light ayu-light --theme-dark nord
revue show <run-directory> --transparent-bg
```

A command option overrides the remembered preference for that run only.

### Custom themes

Create a starter file:

```bash
revue themes init my-ayu
```

This writes `~/.revue/themes/my-ayu.json`. Use `--force` to replace an existing file.

A custom theme can extend a bundled theme:

```jsonc
// ~/.revue/themes/my-ayu.json
{
  "extends": "ayu-dark",
  "overrides": {
    "accent": "#ff9940"
  }
}
```

It can also provide its own `background` and `foreground`. Optional inputs include diff colours, a syntax theme, and named slot overrides.

Revue derives all slots that you do not override. It applies contrast checks to derived colours. It uses an override exactly as written, without a contrast check.

A custom file with the same ID as a bundled theme replaces that theme in the picker. `revue themes` marks it as customised.

Validation is per file and per key. One broken custom theme does not disable the other themes. Revue reports theme issues in `revue themes`, the status bar, and the keys surface.

Restart Revue after you edit a custom theme file.

## Keybindings

List the complete default and effective keymap:

```bash
revue keybindings
```

Create a starter file:

```bash
revue keybindings init
```

This writes `~/.revue/keybindings.json`. Use `--force` to replace an existing file.

The file is JSON with comments. It does not support trailing commas.

Each entry maps an action ID to one key or a list of keys:

```jsonc
{
  "toggle-comments": ["o", "C"],
  "previous-page": "[",
  "next-page": "]"
}
```

An override replaces all default keys for that action. It does not add keys. Include a default key again when you want to keep it.

A key can be:

- a lowercase named key such as `up`, `pageup`, `return`, or `f10`;
- a `ctrl+` key such as `ctrl+r`;
- one literal character;
- an uppercase letter for a shifted character;
- a `shift+` prefix for a named key such as `shift+tab`.

`escape` and digits `1` through `9` are reserved. The square bracket page keys are ordinary bindable keys.

Revue drops one invalid or conflicting entry and keeps the rest of the file. It reports each issue in `revue keybindings`, the status bar, and the keys surface.

## Display preferences

The View menu can remember:

- a pinned theme or a light and dark theme pair;
- transparent neutral surfaces;
- sidebar display and width;
- split or stacked diff layout;
- line numbers and change markers;
- all or focused file display;
- smart, tree, or full path display.

Revue stores these values in `~/.revue/preferences.json`. A write failure does not stop the review. Revue continues with the current session choice.

## Repository ignore rules

Create `.revueignore` at the Git repository root to hide files from review. The syntax follows Git ignore rules.

Examples:

```gitignore
/generated.ts
fixtures/
**/*.generated.ts
!important.generated.ts
```

Rules are relative to the repository root:

- `/generated.ts` matches only the root path;
- `generated.ts` matches that name at any depth;
- a trailing slash matches a directory and its contents;
- `**` crosses directories;
- `!` negates an earlier rule.

A file cannot be included while its parent directory remains excluded.

Escape a leading `#` or `!` when it is part of a file name. Escape trailing spaces when they are significant.

Use repeatable command options for one prep only:

```bash
revue prep --ignore '*.generated.ts' --ignore '!keep.generated.ts'
```

Session rules run after `.revueignore`. They can refine or negate repository rules.

Show all rules and omissions:

```bash
revue prep --show-ignored
```

Prep records the effective rules and each omission in `run.json`. If every changed file is omitted, prep fails instead of creating an empty run.

For a rename or copy, Revue checks both the old and new paths. The file is omitted when either path remains ignored.

## Built-in exclusions

Revue excludes these inputs before `.revueignore` rules:

- `.revue/` state;
- binary files;
- Git submodules;
- common package and dependency lockfiles;
- minified JavaScript and CSS;
- source maps.

Examples include `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `Cargo.lock`, `*.min.js`, and `*.map`.

Use `--show-ignored` to see the exact reason for each omitted path.

Git ignore files control discovery of untracked files. They do not hide changes to files that Git already tracks.

## Related pages

- [Review code with Revue](guide.md)
- [Troubleshoot Revue](troubleshooting.md)
- [Use Revuediff](revuediff.md)
