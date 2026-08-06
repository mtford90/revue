# ADR 0011 — Native per-platform executables, gated by a PTY smoke test

- Status: accepted
- Date: 2026-08-05

## Context

Revue targets reviewers who do not have Bun or Node installed, so distribution means compiled
executables. OpenTUI ships per-platform native libraries; a cross-compiled binary can silently
embed the wrong native code — or none — and the failure only appears when a real terminal drives
the TUI. Versioning also had three potential sources of truth (package.json files, git tags, the
embedded skill), and the Homebrew formula had already gone stale once through manual bumping.

## Decision

Each release tag compiles the CLI **natively on its own runner** — macOS arm64/x64 and Linux x64 —
with no cross-compilation. The tag is the single version source, stamped into the package before
compilation, which also versions the embedded skill (they ride one release train; `revue doctor`
detects drift).

Every artefact must pass `scripts/release-smoke.sh`, which drives the compiled binary through a
**real PTY** including an alternate-screen enter/leave check — proving the native terminal layer
survived compilation, which `--version` or `--check` never exercises. Releases ship sha256
checksums and bundled third-party licence texts collected from the production dependency closure
at build time.

Release automation is release-please over conventional commits. On release, CI regenerates the
Homebrew tap formula (`mtford90/tap`) from the checksums and pushes it with a scoped cross-repo
token, and `site/install.sh` provides a curl-pipe-sh path for non-brew platforms. npm distribution
is deliberately absent. Optional native dependencies are never bundled: difftastic is probed at
runtime, advised at install time (formula caveats), and its absence degrades to patch view.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Publish to npm | Rejected | Requires users to have a JS runtime; the audience is "anyone reviewing code". |
| Cross-compile from one runner | Rejected | Other platforms' OpenTUI native packages are not in `node_modules`; it fails silently. |
| `--version`/`--check` smoke tests | Rejected | Never exercises the terminal/input layer — exactly the part native packaging can break. |
| Manual version bumps and formula updates | Rejected | Already produced a stale formula; tag-driven automation removes the human step. |
| `depends_on "difftastic"` in the formula | Rejected | Forces a large install on users who never open semantic view. |
| Native matrix + PTY gate + tag-driven automation | Chosen | The matrix is the strategy, not an optimisation; the gate has already caught a real Intel-only hang. |

## Consequences

- Adding a platform (e.g. linux-arm64, currently a gap) means adding a runner, not a flag.
- The PTY smoke test is load-bearing; simplifying it away reintroduces the silent-native-breakage
  risk it exists to catch.
- A dependency change that breaks licence collection fails CI rather than shipping an
  under-attributed binary.
- Skill distribution policy (embed in binary, delegate installs to the skills CLI, never install
  binaries from the skill) is recorded in CONTEXT.md's key decisions and versioned by this train.
