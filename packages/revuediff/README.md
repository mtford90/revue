# Revuediff

Revuediff is the standalone `revuediff` ANSI diff formatter and pager for Git and Lazygit. It is
released independently from narrative Revue while sharing the `@revue/diff` Patch engine and
`@revue/diff-ansi` presentation adapter.

```bash
git config --global pager.diff revuediff
printf '%s\n' '--- a/file' '+++ b/file' '@@ -1 +1 @@' '-old' '+new' |
  revuediff --paging=never
```

The CLI depends only on `@revue/diff`, `@revue/diff-ansi`, and `@revue/theme`. It does not load
OpenTUI, prepared runs, chapters, review threads, skills, or narrative Revue state.

See the complete [Revuediff user reference](../../docs/revuediff.md) for installation, options,
persistent configuration, Git/Lazygit integration, paging, fail-open behaviour, and troubleshooting.
