<div align="center">
  <h1>Revue</h1>
  <p>Narrative code review in your terminal.</p>
</div>

<p align="center">
  <a href="https://github.com/mtford90/revue/releases"><img src="https://img.shields.io/github/v/release/mtford90/revue" alt="GitHub release"></a>
  <a href="https://github.com/mtford90/revue/blob/master/LICENSE"><img src="https://img.shields.io/github/license/mtford90/revue" alt="licence"></a>
  <a href="https://github.com/mtford90/revue/actions/workflows/ci.yml"><img src="https://github.com/mtford90/revue/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/mtford90/homebrew-tap"><img src="https://img.shields.io/badge/Homebrew-mtford90%2Ftap-orange?logo=homebrew&logoColor=white" alt="Homebrew"></a>
</p>

<img width="1518" height="1155" alt="CleanShot 2026-08-04 at 16 47 02" src="https://github.com/user-attachments/assets/836d541a-43ab-43ec-87b4-4c753b5cf294" />

## What it is

A terminal-based code review tool that organises large code changes into ordered, narrated chunks for easier consumption

Think of it as a guided tour of a change, as opposed to the wall of files you often see in a pull request (especially these days!)

Using the `/revue` skill, your agent of choice can generate and launch a tour in a new terminal session, or else give you the command to launch it

You can then walk through the change, checking each item off but also - optionally - leaving inline comments that you can return to your agent. Your agent can also respond, creating a natural back & forth.

If you don't need a narrative, `revue diff` makes available the same powerful diff tool for any change but without the narration.

## Why...?

In this brave new agentic era, I found myself drifting further from the code. This is my attempt to pull myself back in somewhat - to lighten the load - not to read every line but to focus on what's important.

Why in the terminal and not in a UI? Well it's where I interact with my agents, in a multiplexer and I prefer not to leave it!

## What it is not

Revue is not...

- **...an agent that reviews for you.** The agent writes the narrative; *you* read the code and leave the comments.
- **...a `git diff` / delta pager.** Revue is a full-screen reviewer, not something you pipe diffs through (although I've made the pager that powers revue available seperately in case you like it, and would like to use it as a pager elsewhere in your workflow)
- **...a hosted review service.** Runs and threads are local files beside your repo
- **...a web UI or a GitHub PR replacement.** all review happens in your terminal, right where you work

## Install

```bash
brew install mtford90/tap/revue
```

Or without Homebrew - grabs the right executable, checks the checksum, and installs to `~/.local/bin`:

```bash
curl -fsSL https://revue.mtford.co.uk/install.sh | sh
```

For narrated reviews, register the narrative-writing agent skill (auto-detects your coding agents):

```bash
revue skill install          # project scope
revue skill install --user   # user scope
revue doctor                 # check the skill and dependencies
```

Prebuilt binaries and checksums are on the [releases page](https://github.com/mtford90/revue/releases). From a checkout: install [Bun](https://bun.sh) ≥ 1.3, run `bun install`, then `bun run revue`.

## Recipes

### Full narrated review

In Claude Code, Codex, or any agent with the skill installed:

```text
> /revue this branch against main

Review's ready - run this in your terminal:

revue show .revue/runs/a1b2c3d4e5f6
```

### 10000 ft review

Not every change needs a line-by-line tour. Ask for **10,000ft** and the agent writes fewer acts over the shape of the change.

```text
> /revue this branch against main at 10,000ft
```

### Just the diff (`revue diff`)

No narration. You still get the nice diffs, inline comments, review progress etc.

```bash
revue diff                 # local changes if any, else HEAD vs main/master
revue diff main            # this branch against main (merge base)
revue diff main..HEAD      # those endpoints compared directly
revue diff --ref work      # staged + unstaged vs the last commit
revue diff --ref staged    # staged only
revue diff --ref unstaged  # unstaged only
revue diff --pr 123        # a GitHub PR (number or URL; needs `gh`)
```

## More

This repo also ships **Revuediff**, a separate ANSI diff pager for Git and Lazygit - see [`docs/revuediff.md`](docs/revuediff.md).

## Credits

Built with [@pierre/diffs](https://github.com/pierrecomputer/diffs), renderer concepts adapted from [hunk](https://github.com/modem-dev/hunk) (MIT), and the narrative model + skill from [stage-cli](https://github.com/ReviewStage/stage-cli) (MIT). All awesome projects/

## Licence

MIT - see [`LICENSE`](LICENSE). Adapted material is credited in the `THIRD_PARTY_NOTICES.md` files beside the packages that adapt it, and release archives also carry `BUNDLED_LICENSES.md` with the licence of every dependency compiled into the executable.

