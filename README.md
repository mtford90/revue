<div align="center">
  <h1>Revue</h1>
  <p>Narrated code reviews in your terminal.</p>
</div>

<p align="center">
  <a href="https://github.com/mtford90/revue/releases"><img src="https://img.shields.io/github/v/release/mtford90/revue" alt="GitHub release"></a>
  <a href="https://github.com/mtford90/revue/blob/master/LICENSE"><img src="https://img.shields.io/github/license/mtford90/revue" alt="licence"></a>
  <a href="https://github.com/mtford90/revue/actions/workflows/ci.yml"><img src="https://github.com/mtford90/revue/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/mtford90/homebrew-tap"><img src="https://img.shields.io/badge/Homebrew-mtford90%2Ftap-orange?logo=homebrew&logoColor=white" alt="Homebrew"></a>
</p>

<img width="1518" height="1155" alt="Revue showing a narrated code review chapter and its diff" src="https://github.com/user-attachments/assets/836d541a-43ab-43ec-87b4-4c753b5cf294" />

## What it is

A terminal-based code review tool that organises large code changes into ordered, narrated chapters.

Think of it as a guided tour of a change instead of the wall of files you often see in a pull request, especially these days.

Using the `/revue` skill, your agent generates the tour. Hosts such as Orca can launch it in a new terminal. Other hosts give you the command to run.

You can walk through the change, check each item off, and leave inline comments for your agent. Your agent can reply, which creates a natural back-and-forth.

If you do not need a narrative, `revue diff` provides the same diff viewer without narration.

## Why?

In this brave new agentic era, I found myself drifting further from the code. This is my attempt to pull myself back in somewhat, lighten the load, and focus on what is important.

Why use the terminal instead of a web UI? It is where I interact with my agents, usually in a multiplexer, and I prefer not to leave it.

## What it is not

Revue is not:

- **An agent that reviews for you.** The agent writes the narrative. *You* read the code and leave the comments.
- **A `git diff` or delta pager.** Revue is a full-screen reviewer, not something you pipe diffs through.
- **A hosted review service.** Runs and threads are local files beside your repo.
- **A web UI or GitHub PR replacement.** All review happens in your terminal, where you work.

## Install

```bash
brew install mtford90/tap/revue
```

Without Homebrew, this command gets the correct executable, checks its checksum, and installs it to `~/.local/bin`:

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

Review's ready. Run this in your terminal:

revue show .revue/runs/a1b2c3d4e5f6
```

### Just the diff (`revue diff`)

No narration. You still get the diffs, inline comments, and review progress.

```bash
revue diff                 # local changes if any, else HEAD vs main/master
revue diff main            # this branch against main (merge base)
revue diff main..HEAD      # those endpoints compared directly
revue diff --ref work      # staged + unstaged vs the last commit
revue diff --ref staged    # staged only
revue diff --ref unstaged  # unstaged only
revue diff --pr 123        # a GitHub PR number or URL
```

## Documentation

Read the [Revue documentation](docs/README.md) for navigation, narration, feedback, continuation, configuration, and troubleshooting.

## More

This repo also ships **Revuediff**, a separate ANSI diff pager for Git and Lazygit. See [`docs/revuediff.md`](docs/revuediff.md).

## Credits

Built with [@pierre/diffs](https://github.com/pierrecomputer/diffs), renderer concepts adapted from [hunk](https://github.com/modem-dev/hunk) (MIT), and the narrative model and skill from [stage-cli](https://github.com/ReviewStage/stage-cli) (MIT). All are awesome projects.

## Licence

MIT. See [`LICENSE`](LICENSE). Adapted material is credited in the `THIRD_PARTY_NOTICES.md` files beside the packages that adapt it. Release archives also contain `BUNDLED_LICENSES.md` with the licence of each compiled dependency.

