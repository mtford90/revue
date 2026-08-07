# Revuediff reference

Revuediff is the standalone ANSI diff formatter and downstream pager. It shares the headless Patch
engine, syntax highlighting, wrapping, and themes with narrative Revue, but it does not start
OpenTUI or read chapters, prepared runs, threads, `~/.revue`, or Revue preferences. The `revue`
executable intentionally has no pager command.

## Install

```bash
brew install mtford90/tap/revuediff
# or
curl -fsSL https://revue.mtford.co.uk/revuediff/install.sh | sh
```

Release archives and checksums are on the repository's Releases page. From a checkout, install Bun
1.3 or newer, run `bun install`, then use `bun run revuediff`.

## Input contract and examples

Revuediff reads one complete Git or ordinary unified diff from stdin. It takes no diff path or other
positional argument.

```bash
git diff | revuediff
git show --format=fuller | revuediff --line-numbers --change-markers
revuediff --paging=never --width=100 < change.patch
```

Input and formatted output are buffered. This lets Revuediff classify the whole stream before
rendering, prepare syntax colours, choose layout, and decide whether automatic paging is needed.
Do not use it for an unbounded stream.

## Options and defaults

```text
--line-numbers / --no-line-numbers
--change-markers / --no-change-markers
--theme <bundled-name|auto>
--width <positive-columns>
--paging <auto|always|never>
--pager <command>
--config <path>
--no-config
--help
--version
```

Line numbers and change markers default **off** and are independent. Marker-only, numbers-only,
both-on, and both-off are supported in stacked and split layouts. Supplying either form of the same
boolean more than once is an error, as are duplicate scalar options. There is deliberately no
no-colour option: Revuediff emits semantic ANSI colour and safely strips hostile input controls.

When numbers are on, removed-line numbers use the theme's deletion/red semantic colour, added-line
numbers use addition/green, and unchanged numbers use the muted neutral colour. Old and new number
columns remain distinct in stacked context rows.

## Persistent configuration

The default path is:

```text
$XDG_CONFIG_HOME/revuediff/config.toml
```

When `XDG_CONFIG_HOME` is unset or empty, it falls back to
`~/.config/revuediff/config.toml`. `REVUEDIFF_CONFIG` overrides that discovery path,
`--config <path>` outranks the environment, and `--no-config` disables every config source.
Revuediff does not read Git config, `~/.revue`, or narrative Revue preferences.

The complete format is:

```toml
[display]
line-numbers = false
change-markers = false
theme = "ayu-dark"

[paging]
mode = "auto"
```

`display.theme` accepts a bundled theme name or `auto`. `paging.mode` accepts `auto`, `always`, or
`never`. Width is intentionally not persistent; it remains a property of the current host and
terminal.

Precedence is applied per value:

1. built-in defaults;
2. the discovered config file;
3. existing environment-derived process values;
4. CLI flags.

The environment-derived values concern their existing boundaries: `LAZYGIT_COLUMNS`, `COLUMNS`,
and terminal columns determine width unless `--width` is present; `REVUEDIFF_PAGER`, then `PAGER`,
determine the pager unless `--pager` is present. Config does not define a pager command or width.
`GIT_PAGER` is never consulted, preventing a Git pager from recursively launching itself. Paging
mode has no environment variable, so it resolves built-in/config/CLI only.

### Initialise and inspect

```bash
revuediff config init
revuediff config init --config ./revuediff.toml
revuediff config init --force
revuediff config show
revuediff config show --no-config --line-numbers
```

`config init` creates parent directories and writes a commented starter. It refuses to overwrite an
existing file unless `--force` is supplied. On success stdout contains only the written path;
diagnostics go to stderr.

`config show` does not read stdin. It prints the selected path, effective display and paging values,
pager and width, with each value's source. This is intended to be readable in a terminal and stable
enough for line-oriented scripts; it is not TOML output.

### Invalid configuration

Validation is structural and per key. Unknown tables and keys, wrong types, and invalid enum/theme
values produce warnings on stderr; valid sibling keys continue to apply. Malformed TOML warns and
continues with safe built-in/CLI values. This validation happens before diff stdin is read, so a bad
config never consumes or loses the input.

A missing or unreadable path supplied explicitly with `--config` is a user error and exits nonzero
without reading or emitting stdin. A missing default config is normal. A broken default or
environment-selected file warns and continues, preserving diff input.

## Paging

- `auto` pages only when stdout is a TTY and formatted output exceeds the terminal height.
- `always` requests paging when stdout is a TTY.
- `never` writes directly and is required when another application, such as Lazygit, owns paging.

Pager command precedence is `--pager`, `REVUEDIFF_PAGER`, `PAGER`, then `less`. Bare `less` is
started with `-RFK`. A missing implicit/environment pager falls back to direct output. A missing
explicit `--pager` is an error. In non-TTY output all modes write directly, which keeps scripts and
pipes noninteractive. Signals and pager exit statuses are propagated; an early pager close is
handled as a successful pipe close.

## Width, layout, and themes

Width precedence is `--width`, positive `LAZYGIT_COLUMNS`, positive `COLUMNS`, stdout terminal
columns, then 80. Files with additions and deletions use split layout at 80 columns or wider and
stacked layout below 80. Addition-only and deletion-only files remain stacked. Every rendered row
is bounded by the chosen terminal width, including wide Unicode and narrow wrapped output; hidden
chrome returns its columns to code.

Revuediff supports the bundled Revue themes. Run `revuediff --help` for option syntax and
`revue themes` from a Revue installation to inspect the shared bundled catalogue. `auto` uses the
safe dark fallback because a buffered stdin filter cannot query terminal appearance. Revuediff does
not read custom Revue theme files. Neutral surfaces are transparent while changed rows retain their
semantic tints.

## Git

Configure only Git's diff pager, not `core.pager`:

```bash
git config --global pager.diff revuediff
```

Use a quoted command when choosing chrome explicitly:

```bash
git config --global pager.diff 'revuediff --line-numbers --change-markers'
```

Revuediff deliberately does not replace pagers for logs, help, or arbitrary Git commands.

## Lazygit and multiple pagers

Current Lazygit uses `git.pagers`. Lazygit owns the terminal page, so disable nested paging and ask
Git for uncoloured input:

```yaml
git:
  pagers:
    - name: Revuediff
      colorArg: never
      pager: revuediff --paging=never
```

Multiple named pagers can coexist:

```yaml
git:
  pagers:
    - name: Revuediff
      colorArg: never
      pager: revuediff --paging=never --line-numbers
    - name: Native
      colorArg: always
      pager: cat
```

Press `|` in Lazygit to cycle forward through pagers and `\` to cycle backward. Keep
`--paging=never` on Revuediff entries to avoid a pager inside Lazygit's pager.

## Fail-open behaviour

Ordinary complete unified-diff envelopes are formatted. Unsupported, combined, submodule, malformed,
or ambiguous streams are emitted in full as sanitised passthrough rather than partially formatted.
Terminal-control input is removed while printable text is preserved. Syntax-highlighting or layout
choices do not weaken this whole-stream fallback.

## Troubleshooting

### Colours look doubled or wrong

Make the producer send uncoloured input. Lazygit needs `colorArg: never`; custom Git commands should
avoid forcing `--color=always`. Revuediff intentionally has no no-colour output mode. Check that the
selected theme is valid with `revuediff config show`.

### Paging nests, hangs, or does not start

Use `--paging=never` under Lazygit or another host pager. For Git's `pager.diff`, leave `auto` or use
`always`. Inspect `REVUEDIFF_PAGER` and `PAGER`; use `--pager <command>` to test explicitly. Revuediff
never uses `GIT_PAGER`.

### Configuration seems ignored

Run `revuediff config show` and inspect both the selected path and per-value sources. Check
`--no-config`, `--config`, `REVUEDIFF_CONFIG`, and `XDG_CONFIG_HOME` in that order. TOML keys are
hyphenated exactly as shown above. Warnings go to stderr, so do not discard it while diagnosing.

### Layout is unexpectedly stacked

Check `--width`, `LAZYGIT_COLUMNS`, and `COLUMNS`. Split starts at 80 columns and only applies when a
file has both additions and deletions. Use `revuediff config show` to see the effective width.
