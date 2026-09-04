# Troubleshoot Revue

Start with the built-in check:

```bash
revue doctor
```

The command reports the CLI version, Git, and installed skill versions.

Return to the [documentation index](README.md).

## The skill is missing or stale

Install the skill again:

```bash
revue skill install
revue skill install --user
```

Use project scope when the repository owns the skill. Use user scope when you want it in all repositories.

The CLI stamps the installed skill with its version. A different skill version can produce narration that the CLI rejects.

## The agent did not open the review

The full-screen TUI needs a real interactive terminal. An agent must not run it through a non-interactive shell tool.

A host such as Orca can let the agent create a terminal and run:

```bash
revue show <run-directory>
```

Other hosts must give this command to you. Run it in your terminal.

If an agent claims that it launched Revue but no terminal appears, ask for the exact run directory and use the command yourself.

## Validation opens a flat diff

A run without `chapters.json` is valid. `revue show --check` reports a flat review instead of treating the missing narration as an error.

Check that the agent wrote this file:

```text
<run-directory>/chapters.json
```

Then validate again:

```bash
revue context freeze <run-directory>
revue show <run-directory> --check
```

The context command is only necessary when the narration cites unchanged code.

## Revue reports stale narration

The diff changed after the narration was written. Do not copy the old `chapters.json` over the new run.

Check the repository state:

```bash
revue status --json
```

If status reports `pendingRun`, give that run to the agent. The agent must use `revue delta` and update the stale narration.

Read [Continue a review](continuing.md) for the complete process.

## Revue cannot open the editor

Pressing `e` opens the first selected additions-side line. The action menu's "Open in editor" entry uses the same action on the clicked line or range.

Revue selects the editor in this order:

1. a non-empty `$VISUAL`;
2. a non-empty `$EDITOR`.

Set one variable before you start Revue:

```bash
export VISUAL='code --wait'
export EDITOR='vim'
```

Revue parses the value as command arguments without a shell. Quotes and backslashes can group spaces. Shell substitutions, redirects, and command separators do not run.

Revue calls the editor with this shape:

```text
<editor arguments> +<line> -- <absolute-path>
```

The TUI gives the terminal to the editor and restores itself after the editor exits.

Revue refuses to open:

- a deleted-side line;
- a path outside the reviewed worktree;
- a line when the repository root is unavailable.

A malformed or failed `$VISUAL` does not fall through to `$EDITOR`. Fix `$VISUAL`, unset it, or copy the location and open the file yourself.

## Copy does not reach the clipboard

Revue sends copied text through OSC 52. This method works through many SSH and multiplexer sessions, but a terminal can discard it without an error.

On macOS, Revue also writes to `pbcopy`. Other platforms do not have that local fallback.

Check that your terminal and multiplexer permit OSC 52. If Revue reports a clipboard failure, use the terminal's native text selection and copy command.

A GitHub link also needs:

- a `github.com` origin remote;
- exactly one selected range;
- a selected side that exists in a commit.

The new side of an unstaged or `work` review does not exist in a commit. Revue disables the link instead of producing a link to different content.

## Feedback was not delivered

Send writes `.revue/handoff.json` before it contacts an agent terminal. The feedback remains safe when delivery fails.

Check status:

```bash
revue status --json
```

If the handoff is queued, tell the agent to run `revue status --json` in the reviewed repository. The agent can read the thread data from disk.

When Orca shows several possible agent terminals, use the picker. Revue remembers the selected terminal for later sends in the same TUI session.

Read [Feedback and agent handoff](feedback.md) for target selection and waiting.

## Syntax highlighting falls back

Native builds use the bundled Syntect addon for syntax highlighting. If the addon is missing or damaged, Revue reports one warning and uses Shiki instead.

Use this environment variable only for diagnostics:

```bash
REVUE_SYNTAX_ENGINE=syntect revue show <run-directory>
REVUE_SYNTAX_ENGINE=shiki revue show <run-directory>
```

A forced Syntect run fails when the addon is unavailable. Automatic mode falls back.

## A custom theme or keybinding is ignored

Run the matching diagnostic command:

```bash
revue themes
revue keybindings
```

Revue reports invalid files, unknown IDs, invalid colours, bad key names, and conflicts.

A bad custom entry does not disable all custom configuration. Revue drops the smallest invalid part that it can isolate.

JSONC files allow comments but do not allow trailing commas.

## The display is too narrow

Revue changes its layout when the terminal width changes.

At narrow widths it can:

- hide the automatic sidebar;
- stack the old and new diff sides;
- remove less important status segments;
- place narration above the diff.

Use the View menu to request a stacked diff or hide the sidebar. Press `s` to toggle the sidebar.

Long source lines wrap at terminal columns. Revue keeps grapheme clusters intact and sanitises terminal control characters before display.

## A file is missing from the review

Use:

```bash
revue prep --show-ignored
```

Revue can omit a path because of:

- a built-in exclusion;
- `.revueignore`;
- a session `--ignore` rule;
- Git exclusion of an untracked file.

Binary files, submodules, common lockfiles, minified assets, source maps, and `.revue/` state are built-in exclusions.

Read [Configuration](configuration.md) for ignore order and rename handling.

## A local state file is damaged

`revue status` treats damaged handoff and agent-origin records as absent. It reports a warning instead of blocking the review.

A damaged run, chapter file, or thread store can block loading because these files define code or feedback authority. Keep the error text and identify the named path. Do not delete review data until you know which record is damaged.

You can start a separate fresh review with `--no-carry`, but that does not repair the earlier review or migrate its feedback.

## Related pages

- [Review code with Revue](guide.md)
- [Configure Revue](configuration.md)
- [Feedback and agent handoff](feedback.md)
- [Continue a review](continuing.md)
