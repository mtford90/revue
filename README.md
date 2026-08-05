# revue

Narrative code review in your terminal.

revue organises a branch's diff into ordered, narrated **chapters** - a guided tour of the
change rather than a wall of files. Your agent writes the narrative; you read it in the TUI,
comment on exact lines as you go, and hand the comments straight back to the agent to fix.
Everything happens on your machine.

<img width="1518" height="1155" alt="CleanShot 2026-08-04 at 16 47 02" src="https://github.com/user-attachments/assets/836d541a-43ab-43ec-87b4-4c753b5cf294" />

## Install

```bash
brew install mtford90/tap/revue
```

Or without Homebrew - grabs the right executable, checks the checksum & installs to
`~/.local/bin`:

```bash
curl -fsSL https://revue.mtford.co.uk/install.sh | sh
```

Prebuilt executables for macOS (arm64 & x64) & Linux x64, with checksums, are on the
[releases page](https://github.com/mtford90/revue/releases). You'll need git for `revue prep`;
[difftastic](https://difftastic.wilfred.me.uk/) is optional & unlocks the Semantic view
(`brew install difftastic`).

Running from a checkout instead: install [Bun](https://bun.sh) ≥ 1.3, `bun install`, and prefix
the commands below with `bun run`.

Register the chapter-writing agent skill (auto-detects your coding agents):

```bash
revue skill install          # project scope
revue skill install --user   # user scope
revue doctor                 # check the skill and dependencies
```

## How to use

### Review anything, narrated

You don't drive the pipeline yourself - your agent does. In Claude Code, Codex, or any agent
with the skill installed:

```text
> /revue this branch against main

⏺ revue prep main                        # freezes the scope into an immutable run
⏺ reading hunks, writing chapters…       # the agent clusters and narrates the diff
⏺ revue show --check ✓                   # validates coverage before handing over

  Review's ready - run this in your terminal:

    revue show .revue/runs/a1b2c3d4e5f6
```

The reviewer is a full-screen TUI, so that last command runs in your own terminal - copy it
out and take the tour. Anything git can diff can be narrated: a branch, someone's GitHub PR,
staged, unstaged, the working tree.

### Just the diff

No agent handy? `revue diff` opens the same scopes immediately as a flat, file-by-file diff -
`revue diff main`, `revue diff --pr 123`, `revue diff --ref staged`. No narration, but you get
the rest of the reviewer: inline comment threads, review progress, copying, themes.

### While you review

Comment on any line - click or drag the line-number gutter - and mark chapters off as you
read. Threads live in plain JSON beside your repo and round-trip through a public CLI, so
your agent can pick up every comment, fix it & reply inline against the same frozen scope.

Every shortcut can be remapped in `~/.revue/keybindings.json`; the help overlay (`?`) shows each
action's ID alongside its keys. `revue keybindings init` writes a commented starter file.
Themes can be customised too, deriving from a bundled palette in `~/.revue/themes/*.json`;
`revue themes init <name>` writes a commented starter file.

The [guide](docs/guide.md) covers the rest: Markdown export, the semantic view, themes,
`.revueignore`, the full keymap & remapping shortcuts.

## Why was this made?

Agent-written PRs kept getting bigger, and I caught myself drifting away from the code -
skimming diffs rather than actually reading them. revue is my attempt to make review light
enough that I stay close to the changes. [hunk](https://github.com/modem-dev/hunk) inspired
the diffs-in-the-terminal side (I'm a bit obsessed with living in the terminal), and
[stage-cli](https://github.com/ReviewStage/stage-cli) the idea of review as a narrative.

## More

- [`docs/guide.md`](docs/guide.md) - the full reference
- [`docs/adr/`](docs/adr/) - architecture decisions
- [`AGENTS.md`](AGENTS.md) - instructions for coding agents working on revue

## Credits

Built with [@pierre/diffs](https://github.com/pierrecomputer/diffs), renderer concepts adapted
from [hunk](https://github.com/modem-dev/hunk) (MIT), and the chapter model + skill from
[stage-cli](https://github.com/ReviewStage/stage-cli) (MIT). Cheers to all three.

## Licence

MIT - see [`LICENSE`](LICENSE). Adapted material is credited in the `THIRD_PARTY_NOTICES.md`
files beside the packages that adapt it, and release archives also carry `BUNDLED_LICENSES.md`
with the licence of every dependency compiled into the executable.
