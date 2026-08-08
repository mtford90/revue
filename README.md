# Revue

Narrative code review in your terminal.

This repository contains two independently released products that share the same Patch engine:

- **Revue** (`revue`) is the narrated, interactive code-review product.
- **Revuediff** (`revuediff`) is a standalone ANSI diff formatter and pager for Git and Lazygit.

Revue organises a branch's diff into ordered, narrated **chapters** - a guided tour of the
change rather than a wall of files. Your agent writes the narrative; you read it in the TUI,
comment on exact lines as you go, and hand the comments straight back to the agent to fix.
Everything happens on your machine.

<img width="1518" height="1155" alt="CleanShot 2026-08-04 at 16 47 02" src="https://github.com/user-attachments/assets/836d541a-43ab-43ec-87b4-4c753b5cf294" />

## Install Revue

```bash
brew install mtford90/tap/revue
```

Or without Homebrew — grabs the right executable, checks the checksum, and installs to
`~/.local/bin`:

```bash
curl -fsSL https://revue.mtford.co.uk/install.sh | sh
```

You'll need Git for `revue prep`; [difftastic](https://difftastic.wilfred.me.uk/) is optional
and unlocks the Semantic view (`brew install difftastic`).

## Install Revuediff

Revuediff is installed and released independently from Revue:

```bash
brew install mtford90/tap/revuediff
```

Or use its direct installer:

```bash
curl -fsSL https://revue.mtford.co.uk/revuediff/install.sh | sh
```

Prebuilt executables for both products and their checksums are on the
[releases page](https://github.com/mtford90/revue/releases). Revue keeps `vX.Y.Z` tags and
`revue-vX.Y.Z-{darwin-arm64,darwin-x64,linux-x64}.tar.gz` assets. Revuediff starts at 0.1.0
and uses `revuediff-vX.Y.Z` tags and matching
`revuediff-vX.Y.Z-{darwin-arm64,darwin-x64,linux-x64}.tar.gz` assets.

Running from a checkout instead: install [Bun](https://bun.sh) ≥ 1.3, run `bun install`, and use
`bun run revue` or `bun run revuediff`.

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

### Ask for less

Not every change needs a line-by-line tour. Ask for a `10,000ft` narrative and your agent writes a
handful of chapters over the shape of the change, quoting the code that carries it and leaving the
rest reachable on the Files surface:

```text
> /revue this branch against main at 10,000ft
```

The reviewer states the coverage it's giving you - `10,000ft · 22/249 hunks` in the status bar - so
a skim never passes for a complete read. Full depth is the default, and still demands that every
hunk be narrated exactly once.

### Just the diff

For a fast review without narration, `revue diff` opens any scope immediately as a flat,
file-by-file diff - `revue diff main`, `revue diff --pr 123`, `revue diff --ref staged`. You still
get the full reviewer: inline comment threads, review progress, copying, and themes.

### Format diffs with Revuediff

Revuediff formats Git diffs without starting Revue's full-screen reviewer. Configure only Git's
diff pager (not `core.pager`):

```bash
git config --global pager.diff revuediff
```

Current Lazygit uses named Git pagers:

```yaml
git:
  pagers:
    - name: Revuediff
      colorArg: never
      pager: revuediff --paging=never
```

Add more entries under `git.pagers` and use `|` / `\` in Lazygit to cycle forward/backward.
`less` improves automatic paging but is optional; unsupported input is safely emitted as sanitised
plain output. The `revue` CLI intentionally has no `pager` command. See the complete
[Revuediff reference](docs/revuediff.md) for options, configuration, integrations, and troubleshooting.

### While you review

Comment on any line - click or drag the line-number gutter - and mark chapters off as you
read. Threads live in plain JSON beside your repo and round-trip through a public CLI, so
your agent can pick up every comment, fix it & reply inline against the same frozen scope.

A chapter can also quote code it didn't change - frozen off disk by `revue context freeze`, never
transcribed by the agent - and a chapter with no diff at all is an interlude: prose, a diagram, and
the code it points at. Quoted lines comment like any other line.

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
