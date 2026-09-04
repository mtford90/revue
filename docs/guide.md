# Review code with Revue

Revue presents a code change as an interactive terminal review. A narrated review adds a prologue and ordered chapters. A flat review shows the same diff tools without narration.

See the [documentation index](README.md) for feedback, continuation, configuration, and troubleshooting guides.

## Install Revue

Install the CLI with Homebrew:

```bash
brew install mtford90/tap/revue
```

You can also use the installer:

```bash
curl -fsSL https://revue.mtford.co.uk/install.sh | sh
```

Install the agent skill if you want narrated reviews:

```bash
revue skill install          # project scope
revue skill install --user   # user scope
revue doctor                 # check the installation
```

Run `revue skill install` again after you upgrade Revue. The CLI supplies the matching version of the skill.

## Start a narrated review

Ask an agent that has the Revue skill:

```text
> /revue this branch against main
```

The agent prepares a fixed snapshot of the change. It then writes and validates the narration. A host such as Orca can open the review in a new terminal. Other hosts give you a command:

```bash
revue show .revue/runs/a1b2c3d4e5f6
```

The agent does not run the full-screen interface inside its own process. It either creates a real interactive terminal or gives the command to you.

Read [Narrated reviews](narration.md) for chapters, excerpts, diagrams, and coverage.

## Start a flat review

Run `revue` without arguments to review local changes:

```bash
revue
```

Use `revue diff` when you want an explicit scope:

```bash
revue diff                       # local changes, or HEAD against main/master
revue diff main                  # merge base of main and HEAD against HEAD
revue diff main..HEAD            # compare these endpoints directly
revue diff main...feature        # merge base of main and feature against feature
revue diff --ref committed       # committed branch changes
revue diff --ref staged          # index against HEAD
revue diff --ref unstaged        # worktree against the index
revue diff --ref work            # staged and unstaged changes against HEAD
revue diff --pr 123              # GitHub pull request
revue diff --pr <pull-request-url>
```

A bare command prefers local work when Git reports staged, unstaged, or untracked changes. Otherwise, it compares `HEAD` with the detected `main` or `master` base.

The PR URL form fetches the pull request head with Git. It can review a pull request from another GitHub repository when the local repository shares its target history.

Run `revue diff --help` for all scope and theme options.

## Understand the review surfaces

A narrated review has three surfaces:

- **Narrative** shows the prologue and the ordered chapters.
- **Diff** shows the complete change as one file stream.
- **Comments** lists all review threads.

Press `w` to open Diff. Press `o` to open Comments. Use the surface strip below the menu bar when you prefer the pointer.

A flat review has no Narrative surface. Its Diff and Comments surfaces work in the same way as a narrated review.

## Navigate chapters and files

The prologue is the first page of a narrated review. Each chapter is another page.

- Press `[` or `]` to move between chapters.
- Press `a` to move to the next unreviewed chapter.
- Press `Tab` or `J` to move to the next file or other review stop.
- Press `Shift-Tab` or `K` to move to the previous stop.
- Press `Enter` to open or close the focused file.
- Press `-` or `+` to close or open all files.

The default file display shows all files in the chapter. Focused display shows one file at a time. Use the View menu to change this setting.

Press `p` to cycle the path display:

- **Smart** removes the common prefix and shortens directories.
- **Tree** groups files by directory.
- **Full** shows each complete path.

## Move through the diff

The review line cursor moves across lines that can accept review actions.

- Press `j` or `k` to move through source lines and inline thread cards.
- In a split diff, press `h` or `l` to move between the old and new sides.
- Press `v` to start a selection. Press `v` again to stop the selection.
- Press `Enter` to comment on the cursor or selection.
- Press `Escape` to cancel the current interaction.

A selection stays inside one file. It can include old and new ranges and can cross multiple hunks. Revue stores those ranges as one comment anchor.

The arrow keys scroll the visual rows without moving the review line cursor. Use `d` and `u` for half pages. Use `Space` and `b` for full pages. Press `g` or `G` to reach the top or bottom.

Press `?` at any time to see the keys that apply to the current surface. Run `revue keybindings` for the complete effective keymap.

## Expand unchanged code

A `⋯` band appears above, below, or between hunks when more unchanged lines are available. Use its controls to reveal lines in steps or reveal the complete gap.

Revue reads these lines from the fixed run snapshot. It does not read the current worktree. Ad hoc expanded lines cannot accept comments.

A narration excerpt is different. The agent selected and froze that code as part of the review. An excerpt can accept comments. It does not count as changed code or review progress.

## Track review progress

Revue records progress for chapters, files, and key changes.

- Press `x` to mark the current chapter reviewed.
- Press `f` to mark the focused file reviewed.
- Press `r` to mark the focused key change reviewed.
- Press `{` or `}` to move between key changes.

Completing a chapter completes its files and moves to the next unreviewed chapter. Completing all files in a chapter completes that chapter. Reopening an item returns focus to it.

Progress belongs to the fixed code snapshot and its narration. Revue stores it in `.revue/state.json` beside the repository. It also stores your position, open files, excerpt state, and scroll positions.

Read [Continue a review](continuing.md) to learn what happens when the code changes.

## Change the layout

Revue supports split and stacked diffs. The automatic layout uses a split view only when the terminal has enough width and both sides contain changed lines.

The sidebar can be automatic, shown, or hidden. Press `s` to show or hide it. When the sidebar is hidden, the chapter text appears above the diff.

The View menu also controls:

- split or stacked layout;
- all files or the focused file;
- line numbers;
- `+` and `-` change markers;
- sidebar width;
- path display.

Revue keeps these display choices in `~/.revue/preferences.json`.

## Read changed lines

Revue adds a stronger background to the changed characters inside a paired removed and added line. It uses conservative similarity checks before it pairs two lines.

Long lines wrap to the terminal width. Revue does not split a grapheme cluster. It also removes terminal control characters before display.

A file can have no textual hunk. Pure renames, mode changes, and empty files use a metadata review unit instead. Revue shows the file state without inventing source lines.

## Copy code and locations

Drag across source text to highlight it. Press `y` to copy the text.

Right-click a review line or an active range to open the action menu. The menu can copy a location, copy a GitHub link, start a comment, or open the line in your editor.

A location copy includes every selected range. A GitHub link needs exactly one range and a `github.com` origin remote. The selected side must also exist in a commit. New-side links are not available for unstaged working-tree content.

You can also select narration text with the pointer. Revue can copy the text alone or include its chapter reference.

Press `e` to open the first selected new-side line in `$VISUAL` or `$EDITOR`. The action menu runs the same action on the clicked line or range. Revue refuses deleted-side lines and files outside the reviewed worktree, and the menu entry is disabled when the selection has no new-side line. See [Troubleshooting](troubleshooting.md) for editor and clipboard details.

## Leave comments

Press `Enter` on a line or range to open the comment composer. Press `Ctrl+Enter` to save the comment. Press `Escape` to cancel it.

Thread cards are part of the review cursor:

- Press `R` to reply to the focused thread.
- Press `X` to resolve or reopen it.
- Press `D` twice to delete it.
- Press `A` to send only that thread to the agent.

Press `S` to send all unsent feedback to the agent. Read [Feedback and agent handoff](feedback.md) for delivery, storage, and agent replies.

## Reload the review

Press `Ctrl-r` or `F5` to prepare the same scope again.

An unchanged scope is a true no-op. Revue keeps the same run, progress, threads, and position.

Changed code creates a new fixed run. A narrated continuation can carry unchanged chapters, progress, and threads into that run.

A PR run is an exception. Reload rereads its fixed run because the recorded PR head is not a reusable Git ref. Run `revue prep --pr` again with the original PR number or URL to fetch a newer PR head.

Read [Continue a review](continuing.md) before you use reload during an active agent exchange.

## Next steps

- [Understand narrated reviews](narration.md)
- [Send feedback to an agent](feedback.md)
- [Continue after the code changes](continuing.md)
- [Configure Revue](configuration.md)
- [Troubleshoot Revue](troubleshooting.md)
