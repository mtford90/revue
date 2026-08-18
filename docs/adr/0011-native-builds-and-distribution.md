# ADR 0011 — Native per-platform executables, gated by a PTY smoke test

- Status: accepted
- Date: 2026-08-05

## Context

Revue is for reviewers who do not have Bun or Node on their machine. Thus Revue must ship compiled
executables. OpenTUI ships one native library for each platform. A cross-compiled binary can hold
the wrong native code, or no native code, and give no message. The failure occurs only when a real
terminal drives the TUI.

The version also had three possible sources of truth: the `package.json` files, the git tags, and
the embedded skill. Manual version changes had already made the Homebrew formula out of date one
time.

## Decision

Each release tag compiles the CLI **natively on its own runner**, with no cross-compilation. The
runners are macOS arm64, macOS x64, and Linux x64. The tag is the one source of the version. The
build stamps the tag into the package before compilation. The same stamp gives the version of the
embedded skill, because the binary and the skill move on one release train. `revue doctor` detects a
difference between them.

Every artefact must pass `scripts/release-smoke.sh`. The script drives the compiled binary through a
**real PTY**. The script also makes a check of the entry to and the exit from the alternate screen.
Thus the script proves that the native terminal layer survived the compilation. `--version` and
`--check` never use that layer. Each release ships sha256 checksums and the licence texts of the
third parties. The build collects those texts from the closure of the production dependencies.

release-please automates the release from the conventional commits. At each release, CI makes the
Homebrew tap formula (`mtford90/tap`) again from the checksums, and pushes the formula with a scoped
cross-repo token. For platforms without brew, `site/install.sh` gives a curl-pipe-sh path. Revue
does not ship to npm, and this is deliberate. Revue never bundles an optional native dependency.
Revue looks for difftastic at run time, and the formula caveats advise difftastic at install time.
If difftastic is absent, Revue shows the patch view.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Publish to npm | Rejected | It needs a JS runtime on the user's machine. But the audience is each person who reviews code. |
| Cross-compile from one runner | Rejected | The OpenTUI native packages of the other platforms are not in `node_modules`. The build then fails and gives no message. |
| `--version`/`--check` smoke tests | Rejected | They never use the terminal layer or the input layer. Native packaging can break exactly that part. |
| Manual version bumps and formula updates | Rejected | They had already made an out-of-date formula. Tag-driven automation removes the human step. |
| `depends_on "difftastic"` in the formula | Rejected | It forces a large install on users who never open the semantic view. |
| Native matrix + PTY gate + tag-driven automation | Chosen | The matrix is the strategy, not a speed improvement. The gate already found a real hang on Intel only. |

## Consequences

- To add a platform, add a runner, not a flag. linux-arm64 is such a gap now.
- The PTY smoke test is necessary. Do not remove it. If you remove it, native breakage occurs again
  with no message.
- If a change of a dependency breaks the collection of the licences, CI fails. Revue does not ship a
  binary with insufficient attribution.
- The key decisions in CONTEXT.md record the policy for skill distribution, and this release train
  gives that policy its version. The policy is: embed the skill in the binary; let the skills CLI do
  the installs; never install a binary from the skill.
