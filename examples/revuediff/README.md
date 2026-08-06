# Revuediff local demo

This is a ready-made, local demo of the standalone Revuediff formatter. It uses the checkout's
TypeScript entrypoint, so after `bun install` there is no build or global installation step.

From the repository root:

```bash
./examples/revuediff/demo.sh basic
./examples/revuediff/demo.sh split
./examples/revuediff/demo.sh narrow
./examples/revuediff/demo.sh themes
./examples/revuediff/demo.sh passthrough
./examples/revuediff/demo.sh paging
./examples/revuediff/demo.sh all
```

`basic` renders a realistic multi-file Git patch with additions, deletions, edits, and TypeScript
syntax highlighting. `split` uses a 120-column split layout; `narrow` uses a wrapped 48-column
stacked layout. `themes` shows three bundled themes, and `passthrough` shows safe handling of
unsupported input. `paging` uses `cat -` as a safe explicit downstream pager in a terminal, so it
is passed to a downstream child process rather than treated as Revuediff's direct-output `cat`
sentinel. In a non-TTY shell (including most agents), Revuediff intentionally bypasses downstream
paging, prints an explanation, and completes without hanging. Therefore `all` is safe to run
noninteractively.

## Try it with local Git configuration

This configures only the current repository, never your global Git settings:

```bash
git config --local pager.diff "bun run $PWD/packages/revuediff/src/main.ts --paging=never"
git diff
```

Restore the repository setting when finished:

```bash
git config --unset pager.diff
```

If `pager.diff` was already locally configured, save its value first and restore that exact value
instead of unsetting it:

```bash
previous=$(git config --local --get pager.diff || true)
# ... try the demo configuration ...
git config --local pager.diff "$previous"  # only when $previous was non-empty
```

For an installed `revuediff` binary, the usual persistent configuration is
`git config --global pager.diff revuediff`; this demo deliberately does not run it.

## Lazygit

Use Lazygit's stdin renderer (replace the command with `revuediff --paging=never` after
installation):

```yaml
git:
  diffRenderers:
    - type: stdinFilter
      name: revuediff-local
      command: bun run /absolute/path/to/revue/packages/revuediff/src/main.ts --paging=never
      colorArg: never
```

Remove this `diffRenderers` entry from your Lazygit configuration to restore its previous renderer.
