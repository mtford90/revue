# revue

Narrative code review in your terminal.

revue organises a branch's diff into ordered, narrated **chapters** with a high-level **prologue**
that tells you what to look at before you dive into the code. Your agent writes the narrative; you
review it in an interactive TUI, leave inline threads, and export the result as Markdown.
Everything happens on your machine.

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

## Quick start

```bash
# try the bundled sample run
bun run revue show examples/sample-run

# review your own changes
RUN=$(bun run revue prep)     # freeze the current diff into an immutable run
                              # → ask your agent to run the revue-chapters skill on "$RUN"
bun run revue show "$RUN"     # open the interactive reviewer
```

`revue prep` supports committed, staged, unstaged, and working-tree scopes.

## Export

```bash
bun run revue export "$RUN" > review.md         # full review, chapter order
bun run revue export "$RUN" --chapter-order 2   # one chapter
bun run revue export "$RUN" --prologue          # prologue only
```

## Review threads

Leave feedback inline from the TUI — click or drag a line-number gutter — or from an agent through
the CLI:

```bash
revue threads create "$RUN" --file src/value.ts --old-start 4 \
  --side additions --start-line 8 --end-line 10 \
  --author "Review agent" --body "Should this limit be lower?"
revue threads list "$RUN" --json
revue threads reply "$RUN" <thread-id> --author "Fix agent" --body "Fixed."
```

Threads persist in `.revue/threads.json` and survive chapter regeneration.

## Semantic diff

The View menu offers an optional read-only semantic diff powered by
[Difftastic](https://difftastic.wilfred.me.uk/). Install `difft` to enable it:

```bash
brew install difftastic          # macOS
cargo install --locked difft     # anywhere with Rust
```

Other package managers: see the
[Difftastic installation guide](https://difftastic.wilfred.me.uk/installation.html).
Without `difft`, the Patch view simply remains the only view.

## .revueignore

Exclude files from review (not from Git) with gitignore-style rules in `.revueignore` at the repo
root, or per-run:

```bash
bun run revue prep --ignore '*.generated.ts' --show-ignored
```

## Keys

Vim/less conventions: `j`/`k` scroll · `]c`/`[c` chapters · `x` mark chapter reviewed · `a` next
unreviewed · `t` themes · `F10` menu · `?` full keymap.

## More

- [`docs/guide.md`](docs/guide.md) — full reference: threads, copying, export, ignore rules,
  layout, themes, navigation, roadmap
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
