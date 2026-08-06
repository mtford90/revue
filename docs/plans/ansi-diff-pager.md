# Add a reusable ANSI diff pager for Git and Lazygit

> **Historical plan:** this records the original `revue pager` implementation. The approved product
> separation moved that implementation to the standalone `revuediff` CLI and replaced its release,
> configuration, and ownership details. See the current [guide](../guide.md#revuediff-ansi-diff-pager)
> and `packages/revuediff`; do not use the historical command examples below.

## Goal

Add a linear ANSI presentation adapter over the Patch engine introduced by
[ADR 0013](../adr/0013-separate-patch-engine-from-presentation-adapters.md), and expose it through
`revue pager` for command-specific Git paging and Lazygit diff rendering:

```text
Git / Lazygit unified diff
  -> safe stream classification
  -> @revue/diff parsing and syntax preparation
  -> shared planDiff / paintDiff geometry
  -> @revue/diff-ansi serialisation
  -> less-compatible pager or direct stdout
```

The pager is a transient view over stdin. It does not create or read prepared runs and does not
include chapters, review state, threads, semantic diff, context expansion, or OpenTUI interaction.

## User contract

### Command

```text
revue pager [--paging auto|always|never] [--pager <command>]
             [--width <columns>] [--theme <name>]
```

- stdin is required and contains a Git or plain unified diff; when stdin is a TTY, fail immediately
  with usage on stderr rather than waiting silently for interactive input;
- `--paging` defaults to `auto`;
- `--pager` overrides the downstream pager command;
- `--width` is a positive integer override for integrations and deterministic checks;
- `--theme` accepts the same bundled and custom theme ids as `show` and `diff`;
- neutral surfaces always use the terminal's default background; there is no pager-specific
  transparent-background preference in the initial interface; and
- stdout contains only printable text, tabs, newlines, and SGR styling. The command never
  initialises OpenTUI, enters the alternate screen, enables pointer modes, moves the cursor,
  queries the terminal, or emits OSC sequences.

The first documented Git integration is deliberately command-specific:

```bash
git config --global pager.diff 'revue pager'
```

Do not recommend `core.pager` until Revue intentionally supports every Git output family that can
reach it. Non-diff input remains fail-open as sanitised direct output, but that safety net is not a
claim of global-pager support.

Current Lazygit uses a stdin diff renderer:

```yaml
git:
  diffRenderers:
    - type: stdinFilter
      name: revue
      command: revue pager --paging=never
      colorArg: never
```

Document only the current `diffRenderers` contract; migration guidance for older Lazygit
configuration is outside this work.

### Width and layout

Resolve the output width once, in this order:

1. `--width`;
2. positive `LAZYGIT_COLUMNS`;
3. positive `COLUMNS`;
4. `process.stdout.columns` when available; then
5. 80 columns.

Git captures the terminal width into `COLUMNS` before redirecting output to its pager. Lazygit runs
its renderer in a PTY and also exposes the panel width through `LAZYGIT_COLUMNS`.

Layout remains host policy rather than an engine decision. Resolve it independently for every file:

- below 80 columns, use stack;
- at 80 columns or above, use split only when that file has at least one added and one deleted
  changed line; and
- additions, deletions, binary files, and metadata-only changes never receive a wasteful empty pane.

The boundary is exactly 79/80 and must not depend on changes in another file. Line numbers and hunk
headers are always shown.

### Themes and backgrounds

Resolve the requested theme using the existing custom-theme and preference paths:

1. explicit `--theme`;
2. the remembered `themeId` in `~/.revue/preferences.json`; then
3. `ayu-dark`.

The pager cannot rely on OpenTUI's terminal-background query, especially inside Lazygit's
`TERM=dumb` PTY. Accept `--theme auto` for CLI consistency but resolve it with unknown appearance,
matching the existing pre-OpenTUI startup path: it chooses the dark default. Document that a
light-terminal user must select or remember a light Revue theme explicitly. A remembered `auto`, if
one is ever persisted, follows the same total rule rather than creating an unresolved theme state.

Apply `withTransparentSurfaces(theme)` before ANSI formatting:

- context rows, file headers, hunk headers, and blank separators use the terminal's default
  background;
- addition and deletion rows retain Revue's derived semantic tints;
- intra-line emphasis retains the stronger derived tint; and
- syntax, status, line-number, and heading foregrounds come from the selected Revue theme.

This follows established pager behaviour: neutral content belongs to the host terminal, while
background colour is reserved for change meaning. Full opaque theme surfaces remain a full-screen
TUI concern.

### Paging

Keep formatting separate from downstream pagination. The CLI resolves a pager command in this
order:

1. `--pager`;
2. non-empty `REVUE_PAGER`;
3. non-empty `PAGER`; then
4. `less`.

Never use `GIT_PAGER` as the downstream-pager source. Git reads that variable when choosing Revue
but does not create it for the child; if the user exported `GIT_PAGER=revue pager`, the child inherits
that user value and reading it would recurse. Git communicates active paging through
`GIT_PAGER_IN_USE` and terminal width through `COLUMNS`. Treat an empty downstream command or `cat`
as direct output. Use a shell to interpret an explicitly configured command because pager
environment variables conventionally allow arguments.

When the resolved command is bare `less`, pass `-RFK` as command-line arguments and inherit `LESS`
unchanged. Those safety flags are therefore additive; a user who wants complete flag control can set
`--pager`, `REVUE_PAGER`, or `PAGER` to an explicit command. Deliberately do not force `-X`: modern
`less` keeps mouse support without it, while a Git invocation normally inherits Git's `LESS=FRX`
default and therefore retains Git's scrollback behaviour. Direct invocations without that
environment default may clear a paged screen on quit. Any other custom command is used verbatim and
its owner is responsible for preserving SGR.

Paging modes are:

- `never`: always write the formatted stream directly;
- `always`: start the resolved downstream pager when stdout is a terminal, otherwise write directly;
- `auto`: write directly when stdout is not a terminal or the rendered output fits the known
  terminal height; otherwise start the downstream pager. When height is unknown, prefer paging.

A missing default pager degrades to direct output. Failure to start an explicit `--pager` is an
argument/runtime error. Closing the pager early is normal: an EPIPE while writing after the child
has exited must not print a stack trace or turn a successful quit into failure. Propagate genuine
child failures and forward termination signals so Revue does not leave an orphaned pager.

Exit status is explicit: 0 for formatted output, sanitised passthrough, missing-default fallback, and
normal early pager closure; 1 for Revue argument, stdin, theme, internal formatting, or explicit-pager
startup errors; and a downstream pager's non-zero numeric status when it starts and then fails.
Signal termination is forwarded and Revue exits non-zero rather than translating it into success.

Complete-stream classification, syntax preparation, exact fits-height paging, and whole-input
fallback require buffering stdin and the rendered result before the first output byte. Record this
latency/memory trade-off in ADR 0014 rather than presenting the pager as a streaming filter.

## Supported-input boundary

Git normally colours output sent to a pager. Revue's current parser sees no files when SGR sequences
remain in Git headers, so input must be normalised before parsing.

Create a display copy by splitting on line endings, applying `sanitizeTerminalLine` to each line,
and restoring the line boundaries. This removes incoming SGR along with cursor, OSC, C1, and other
unsafe control sequences without letting sanitisation erase newlines. Parsing and every passthrough
path consume this display copy; raw stdin is never emitted.

A small stateful classifier in the CLI layer must distinguish a supported single-diff stream from an
input that should pass through. It tracks hunk old/new counts so patch contents cannot be mistaken
for envelope markers.

Supported input:

- a Git multi-file `diff --git` stream;
- a plain unified patch with paired `---` / `+++` headers;
- one optional `git show` preamble before the first file, including commit metadata and `--stat`
  output;
- additions, deletions, ordinary changes, renames, binary markers, empty files, and mode-only
  changes that `parsePatch` represents completely.

Whole-input sanitised passthrough:

- no recognised patch;
- combined diff markers (`diff --cc`, `diff --combined`, or `@@@`);
- a second top-level commit preamble after patch output has begun;
- submodule presentation that the Patch engine cannot represent as ordinary file content;
- unexplained inter-file or trailing material outside a hunk; or
- any mismatch between classified file boundaries and the files returned by `parsePatch`.

Fail open at the complete-stream level. Never render only the files Revue happened to understand
while silently dropping the rest.

For a supported `git show` stream, emit the sanitised preamble before the first Revue file envelope.
Do not attempt to restyle commit prose or `--stat` output in this work.

## Package boundaries

### `@revue/diff`

Keep the Patch engine presentation-neutral. The pager consumes its existing public parsing,
highlighting, planning, painting, sanitisation, and source types. Do not add Git stream policy,
paging, themes, ANSI bytes, or responsive-layout decisions to the engine merely to serve the new
adapter.

Only extend the engine if implementation reveals a missing presentation-neutral source fact that
cannot be recovered from its existing Revue-owned types. Such a change requires a focused engine
contract test and must not expose Pierre types.

### `@revue/diff-ansi`

Create `packages/diff-ansi/` as a deterministic presentation adapter depending on `@revue/diff` and
`@revue/theme`, with no React, OpenTUI, Git, filesystem, environment, stdin, or subprocess imports.
Its public surface accepts a parsed `DiffFile`, explicit `DiffLayout`, width, and resolved `Theme`,
and returns ANSI text for one complete file envelope.

It owns:

- `ANSI_DIFF_CHROME`, with zero focus/attachment columns and exact sign/divider/edge widths plus the
  required `minimumCode` budget matching what the serialiser emits;
- mapping a Revue theme into `DiffPlanStyles`;
- calling `planDiff` and `paintDiff` for one complete file;
- file headers, path transitions, stats, and metadata-only body messages;
- line-number gutters, change signs, hunk headers, and the split divider;
- SGR foreground/background/bold/dim serialisation;
- terminal-column padding for full-row and split-pane backgrounds; and
- a reset before every newline so style never leaks into following host output.

The adapter must represent every parsed file even when the engine plan has no visual rows:

- binary difference;
- pure rename;
- mode-only change, including old/new modes when available;
- new empty file;
- deleted file;
- generic content-identical metadata change; and
- an `isTooLarge` file with the same explicit "Diff too large to display" outcome as OpenTUI.

`planDiff` supplies vertical split padding only. The ANSI adapter owns its own `Bun.stringWidth`
measurement and must horizontally pad each pane to its planned width using terminal columns, not
JavaScript string length or unexported engine width helpers. Wide Unicode therefore cannot move the
divider or make a row exceed the requested width. Context rows need enough split padding to place
the divider correctly; changed backgrounds extend across their complete pane or stacked row.

Implement the serialiser from the engine plan rather than copying OpenTUI component code. If code is
adapted from Hunk or another package despite that constraint, add accurate provenance and include its
notice in release archives; otherwise the new adapter needs no local third-party notice of its own.

### `@revue/tui`

The executable remains the integration owner. Add focused modules rather than expanding
`main.tsx` with formatting and process mechanics:

- `packages/tui/src/pagerInput.ts`: input sanitisation, classification, preamble extraction, and
  complete-stream passthrough decisions;
- `packages/tui/src/pager.ts`: option types, width/layout/theme resolution, syntax preparation,
  adapter orchestration, paging decisions, and downstream process lifecycle; and
- `packages/tui/src/main.tsx`: help text, argument parsing, stdin read, command dispatch, and
  user-facing errors.

Reuse `loadPreferences`, custom-theme loading, and theme validation. Do not initialise the OpenTUI
application or load run/review state from the pager path.

## Implementation tasks

### 1. Record and expose the command contract

- Add `docs/adr/0014-ansi-diff-pager.md` recording the stdin-filter boundary, command-specific Git
  scope, safe whole-stream fallback, owned auto-paging, transparent neutral surfaces, and package
  ownership.
- Amend ADR 0013 and `packages/diff/README.md` so the future adapter is now an implemented consumer,
  without rewriting the historical rationale.
- Add `PAGER_HELP` and strict parsing for the agreed options in `packages/tui/src/main.tsx`.
- Reject positional arguments, duplicate scalar options, unknown options, invalid paging modes, and
  non-positive/non-integer widths before reading stdin.
- Reject TTY stdin immediately with usage and exit 1 so a bare `revue pager` never appears to hang.
- Keep stdout reserved for rendered content; usage and runtime failures go to stderr.

### 2. Build the deterministic ANSI adapter

- Create `packages/diff-ansi/package.json`, `tsconfig.json`, `README.md`, and `src/index.ts`.
- Define adapter chrome and theme-to-engine style mapping once.
- Format complete file envelopes and every hunkless/metadata-only state.
- Serialise stack and split rows directly from planned/painted visual rows.
- Pad by terminal columns, fill semantic backgrounds, and terminate each line with an SGR reset.
- Prepare syntax highlighting before calling the adapter; passing only `syntaxTheme` into `planDiff`
  does not populate the engine's highlight cache.

Protect the adapter through the smallest realistic public boundary:

- one compact stack fixture proving file/hunk/gutter/sign text and syntax/intra-line SGR survive;
- one split fixture with CJK or emoji proving pane padding and divider columns;
- parameterised metadata-only fixtures for binary, rename, mode, new-empty, deleted, and
  `isTooLarge` states;
- assertions that each output line resets, no non-SGR terminal controls escape, and visible rows do
  not exceed the requested width; and
- exact 79/80 per-file layout tests in the CLI policy module rather than retesting engine wrapping.

Use a small focused character/style golden only if direct behavioural assertions cannot make the
adapter's visible contract readable. Do not duplicate the existing OpenTUI golden matrix.

### 3. Add safe stdin classification

- Implement line-preserving terminal sanitisation over the whole input.
- Implement a hunk-aware classifier for the supported single-diff envelope.
- Preserve one initial `git show` preamble.
- Detect combined, multi-commit, submodule, unexplained, and parser-boundary mismatch cases before
  formatting.
- Return one of two explicit outcomes: supported parsed stream or sanitised whole-stream passthrough.

Add pure tests using minimal realistic patches for coloured Git headers, plain patches, one `git
show` preamble, multiple ordinary files, combined diff, two commits, submodule output, non-patch
text, and ambiguous trailing material. Assert that unsupported input is preserved visibly in full,
not partially formatted.

### 4. Add formatter and pager orchestration

- Resolve width with the documented precedence.
- Resolve layout independently per file at the exact 79/80 boundary.
- Load the requested/remembered theme and force transparent neutral surfaces.
- Call `prepareSyntaxHighlighting` before formatting supported files.
- Join the optional preamble and complete file envelopes with deterministic separators.
- Resolve downstream pager configuration without consulting `GIT_PAGER`.
- Implement `auto`, `always`, and `never`, downstream stdin streaming, EPIPE handling, child exit
  propagation, and signal cleanup.
- Degrade to direct output only for a missing default/environment pager; report an invalid explicit
  `--pager`.

Keep pure decisions unit-tested and genuine boundaries process-tested. Use a fake pager executable
in a temporary directory to verify selected command/arguments, received ANSI input, exit-code
propagation, and early closure without depending on the developer's `less` configuration.

Extend the CLI process helper to supply stdin and cover:

- `revue pager --help`;
- invalid options without consuming stdin;
- `--paging=never` with a coloured multi-file fixture;
- explicit width and theme selection;
- non-patch sanitised passthrough;
- auto mode with non-TTY stdout;
- fake-pager success, failure, missing explicit command, and early close; and
- clean stdout/stderr separation.

Add one real-PTY check for behaviour that pipe tests cannot exercise: with piped stdin but TTY
stdout, `auto` selects a fake downstream pager for long output, returns cleanly, and emits no
alternate-screen or pointer-mode bytes. Keep the existing pipe-level control-byte assertions for
`--paging=never`. Do not automate Lazygit itself: its rendering and resize behaviour remain a manual
integration check.

### 5. Wire packages, releases, and documentation

- Add `@revue/diff-ansi` to `packages/tui/package.json` and update `bun.lock`.
- Add its TypeScript project to the root `typecheck` command.
- Update `scripts/release-smoke.sh` to pipe a committed minimal patch into the compiled
  `revue pager --paging=never --width 80`, assert recognisable file output and SGR, and reject
  alternate-screen bytes.
- Do not add the adapter to `copy-local-notices.ts` unless it gains copied/adapted third-party code.
- Update `README.md` with the command-specific Git and current Lazygit configuration.
- Update `docs/guide.md` with supported input, paging resolution, theme/background behaviour,
  integration examples, and explicit unsupported fallback.
- Update `CONTEXT.md` with a **Pager** glossary entry and the load-bearing package/input decisions.
- Update the package layout in active docs to include `diff-ansi/`.
- Keep install requirements honest: `less` improves auto-paging but is not required because direct
  output remains functional. Do not make it a Homebrew dependency.

## Acceptance criteria

- `git diff` configured through `pager.diff` opens Revue-formatted output and pages through a
  less-compatible command when needed.
- Current Lazygit renders Revue output through `diffRenderers` with `--paging=never` and
  `colorArg: never`, without a nested pager or terminal-control corruption.
- `@revue/diff-ansi` depends on the Patch engine and theme only; it has no OpenTUI, React, Git,
  filesystem, environment, or subprocess dependency.
- The pager shares parsing, changed-line pairing, syntax spans, wrapping, source identities, and
  paint semantics with the existing Patch view rather than reimplementing them.
- Incoming Git SGR and every unsafe control sequence are removed before parsing or passthrough.
- Unsupported streams are emitted completely as sanitised text; no recognised or unrecognised
  section is silently lost.
- Every parsed file has a visible identity and outcome, including binary and metadata-only changes.
- Split dividers remain in the planned terminal column for wide Unicode, semantic backgrounds fill
  their intended pane/row, and every line resets styling.
- Layout is stack at 79 columns and per-file auto split at 80 when both sides changed.
- The pager never enters the alternate screen, enables pointer reporting, queries the terminal, or
  emits non-SGR control strings.
- Auto paging, explicit paging, missing pager fallback, genuine child failures, signals, early quit,
  and the documented exit statuses have deterministic process behaviour.
- The implementation buffers the complete input and output intentionally; the ADR and guide state
  that trade-off rather than implying streaming output.
- Existing OpenTUI characters/styles, reviewer behaviour, prepared-run validation, and release PTY
  smoke checks remain unchanged and passing.

## Verification

Run repository checks:

```bash
bun install
bun run typecheck
bun run lint
bun test
bun run revue show examples/sample-run --check
```

Verify package direction and control-sequence ownership:

```bash
rg '@opentui|from "react"|node:fs|Bun\.stdin|Bun\.spawn|process\.' \
  packages/diff-ansi/src packages/diff-ansi/package.json
rg '@revue/diff-opentui' packages/diff-ansi packages/prep
rg 'GIT_PAGER' packages/tui/src/pager.ts packages/tui/src/pagerInput.ts
```

The first two commands must find no forbidden dependency. Any `GIT_PAGER` occurrence in pager code
must be a deliberate recursion guard or test, never a downstream-pager source.

Exercise the filter directly at both layout boundaries:

```bash
git show --format= --color=always HEAD \
  | bun run revue pager --paging=never --width 79

git show --format= --color=always HEAD \
  | bun run revue pager --paging=never --width 80
```

Confirm both contain file headers, line numbers, hunk headers, syntax/intra-line colour, and no raw
Git SGR fragments; 79 is stacked and eligible files at 80 are split.

Exercise Git in a temporary configuration scope rather than overwriting the reviewer's global
configuration:

```bash
GIT_CONFIG_GLOBAL=/dev/null \
  git -c pager.diff='bun run revue pager' -c color.ui=auto diff HEAD^
```

Use enough output to enter `less`; confirm navigation, `q`, short-output auto-return, and terminal
restoration.

Exercise current Lazygit with a temporary config containing:

```yaml
git:
  diffRenderers:
    - type: stdinFilter
      name: revue
      command: bun run revue pager --paging=never
      colorArg: never
```

Inspect staged, unstaged, untracked, renamed, binary, and selected-commit diffs. Resize the main pane
across 79/80 columns and confirm there is no nested pager, opaque neutral rectangle, shifted divider,
style leakage, or missing commit/file metadata.

Finally build and run the release smoke locally when the platform supports compilation:

```bash
bun build --compile packages/tui/src/main.tsx --outfile dist/revue
bash scripts/release-smoke.sh dist/revue
```
