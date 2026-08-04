# revue

Narrative code review in your terminal.

revue organises a branch's diff into ordered, narrated **chapters** — an interactive, guided
tour of the change rather than a wall of files. Your agent writes the narrative; you read it
in the TUI, leave comments on exact lines as you go, and hand them straight back to the agent
to address. Everything happens on your machine.

## Install

```bash
brew install mtford90/tap/revue
```

Prebuilt executables for macOS (arm64 and x64) and Linux x64, with checksums, are on the
[releases page](https://github.com/mtford90/revue/releases). Git is required for `revue prep`;
[difftastic](https://difftastic.wilfred.me.uk/) is optional and enables the Semantic view
(`brew install difftastic`).

To run from a checkout instead, install [Bun](https://bun.sh) ≥ 1.3, `bun install`, and prefix
the commands below with `bun run`.

Register the chapter-writing agent skill (auto-detects your coding agents):

```bash
revue skill install          # project scope
revue skill install --user   # user scope
revue doctor                 # check the skill and dependencies
```

## Review anything, narrated

You don't drive the pipeline yourself — your agent does. In Claude Code, Codex, or any agent
with the skill installed:

```text
> /revue this branch against main

⏺ revue prep main                        # freezes the scope into an immutable run
⏺ reading hunks, writing chapters…       # the agent clusters and narrates the diff
⏺ revue show --check ✓                   # validates coverage before handing over

  The review is ready — run this in your terminal:

    revue show .revue/runs/a1b2c3d4e5f6
```

The reviewer is a full-screen TUI, so that last command runs in your own terminal, not the
agent's — copy it out and take the tour. Anything Git can diff can be narrated: a branch,
someone's GitHub PR, staged, unstaged, or the working tree. From a checkout, tour the bundled
sample without touching a repository: `bun run revue show examples/sample-run`.

## Just the diff

No agent handy? `revue diff` opens the same scopes immediately as a flat, file-by-file diff —
`revue diff main`, `revue diff --pr 123`, `revue diff --ref staged`. No narration, but the rest
of the reviewer comes with it: inline comment threads, review progress, copying, themes.

## While you review

Comment on any line — click or drag the line-number gutter — and mark chapters off as you
read. Threads live in plain JSON beside your repo and round-trip through a public CLI, so
your agent can pick up every comment, fix it, and reply inline against the same frozen scope.

The [guide](docs/guide.md) covers the rest: Markdown export, the semantic view, themes,
`.revueignore`, and the full keymap.

## More

- [`docs/guide.md`](docs/guide.md) — the full reference
- [`docs/adr/`](docs/adr/) — architecture decisions
- [`AGENTS.md`](AGENTS.md) — instructions for coding agents working on revue

## Credits

Built with [@pierre/diffs](https://github.com/pierrecomputer/diffs), renderer concepts adapted
from [hunk](https://github.com/modem-dev/hunk) (MIT), and the chapter model + skill from
[stage-cli](https://github.com/ReviewStage/stage-cli) (MIT). Thanks to all three.

## Licence

MIT — see [`LICENSE`](LICENSE). Adapted material is credited in the `THIRD_PARTY_NOTICES.md`
files beside the packages that adapt it, and release archives additionally carry
`BUNDLED_LICENSES.md` with the licence of every dependency compiled into the executable.
