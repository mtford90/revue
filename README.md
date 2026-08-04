# revue

Narrative code review in your terminal.

revue organises a branch's diff into ordered, narrated **chapters** — an interactive, guided
tour of the change rather than a wall of files. Your agent writes the narrative; you read it
in the TUI, leave comments on exact lines as you go, and hand them straight back to the agent
to address. Everything happens on your machine.

> **Status: early scaffold**, but the full loop below works today.

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

```bash
RUN=$(revue prep)   # freeze the diff into an immutable run
                    # → ask your agent to run the revue skill on "$RUN"
revue show "$RUN"   # take the tour
```

Any diff can be narrated:

| Scenario | Command |
| --- | --- |
| Whatever you're working on | `revue prep` — local changes if any, else the branch against its base |
| This branch against main | `revue prep main` |
| A GitHub PR — including someone else's | `revue prep --pr 123` · `revue prep --pr <github-pr-url>` |
| Staged + unstaged vs the last commit | `revue prep --ref work` |
| Staged only vs the last commit | `revue prep --ref staged` |
| Unstaged only (worktree vs index) | `revue prep --ref unstaged` |

From a checkout, tour the bundled sample without touching a repository:
`bun run revue show examples/sample-run`.

## Just the diff

No agent handy? `revue diff` takes the same scopes and opens immediately as a flat,
file-by-file diff — same reviewer, no narration.

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
