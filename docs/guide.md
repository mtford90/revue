# Revue reference guide

The [README](../README.md) covers install and the core loop. This guide holds the full detail.

## How revue relates to its parents

revue combines ideas from MIT projects without taking on their application shells:

- **Stage is the brain.** Its real value is the *skill* (chapter-clustering + prologue rules) and the
  *chapter data model* — not its React/SQLite web UI. We port the skill and the zod schema.
- **Pierre parses and highlights.** `@revue/diff-renderer` uses public `@pierre/diffs` APIs, then owns
  the terminal split/stack rows, exact side-aware range decorations, and OpenTUI presentation.
- **Hunk informed bounded terminal surfaces.** Revue selectively adapts Hunk v0.15.3
  body/row/geometry/highlighting concepts in the renderer and menu-bar/controller concepts in the
  TUI under MIT; Hunk is not a runtime dependency.

See [`adr/0002-own-diff-renderer.md`](adr/0002-own-diff-renderer.md) for the current decision
and [`../packages/diff-renderer/THIRD_PARTY_NOTICES.md`](../packages/diff-renderer/THIRD_PARTY_NOTICES.md)
for Hunk provenance.

## Package layout

```
packages/
  diff-model/     Shared Pierre patch model and stable file/hunk identities
  diff-renderer/  Revue-owned OpenTUI presentation over the shared model
  prep/            Git scope resolution, immutable snapshots, filtering, and hunk formatting
  markdown-export/ Pure deterministic Markdown formatting with no OpenTUI dependency
  theme/           Contrast-aware palettes derived from bundled editor themes
  types/           zod schemas for chapters, review state, and run manifests
  tui/             The CLI and OpenTUI chapter-navigation shell
skills/
  revue/           The chapter-generating agent skill (adapted from stage-chapters)
examples/
  sample-run/      A complete prepared run that works without a Git repository
```

## Installing the agent skill

The CLI is the source of truth for the bundled `revue` skill and stamps it with its own
version. `revue skill install` hands that stamped copy to the open skills CLI
([vercel-labs/skills](https://github.com/vercel-labs/skills)) through the first available runner
(npx, pnpm, bunx, or yarn); the skills CLI detects the coding agents on the machine and writes
the skill into each one's directory, so new harnesses are supported without changes to revue.
`--user` installs at user scope. Without a package runner, `revue skill print` emits the stamped
skill for manual placement. Re-run install after upgrading revue; `revue doctor` reports a stale
or missing skill alongside the required Git and optional Difftastic dependencies. The skill
itself only ever advises how to install the CLI — it never downloads or installs binaries.

## Markdown export

`revue export` consumes only a complete run directory and uses the same integrity and chapter-
coverage validation as `show`. A full review in chapter order is the default:

```bash
bun run revue export examples/sample-run > review.md
```

Select one portable slice explicitly by stable chapter identity, numeric chapter order, or the
prologue:

```bash
bun run revue export examples/sample-run --chapter-id chapter-2
bun run revue export examples/sample-run --chapter-order 2
bun run revue export examples/sample-run --prologue
```

Use `--output <path>` to write the Markdown directly. With no `--output`, stdout contains only the
Markdown; errors and the output-file confirmation go to stderr. Export reads review progress for the
pinned run from the same `.revue/state.json` used by `show` and reads inline feedback from
`.revue/threads.json`; it never writes either store. When local review state is absent, all chapter,
file, and review-question checkboxes are deterministically unchecked.

The document includes the prologue overview, key changes, focus areas and optional Mermaid diagram;
ordered chapter titles and summaries; pinned file paths, statuses and whole-file line counts; review
questions and line anchors; chapter/file/question review state; and threads for the selected chapters.
It does not recompute Git state. Full and chapter exports preserve each thread and message ID, thread
status, exact review-unit anchor, author kind/name, creation time, and multi-line body; prologue-only
exports contain no threads.

## Flat review without chapters

Chapters are optional. `revue show` opens a run with no `chapters.json` as a flat file-by-file
diff on the Files surface, with review state, threads, copying, and themes all working as usual —
only the narrative chrome (story pages, prologue, key changes) is absent. `revue diff` collapses
prep and show into one step:

```bash
revue diff                 # local changes when any exist, else HEAD vs the detected main/master
revue diff main            # this branch against main, from their merge base
revue diff main..HEAD      # the same endpoints compared directly
revue diff --pr 123        # a GitHub PR (or --pr <github-pr-url>)
revue diff --ref work      # staged + unstaged vs the last commit
revue diff --ref staged    # staged only vs the last commit
revue diff --ref unstaged  # unstaged only: worktree vs index
```

"Local changes" means anything `git status` would report — staged, unstaged, or untracked — so on
a dirty branch the bare command shows uncommitted work, not the branch against its base.

It prints the run directory to stderr, so agents can still target the run with `revue threads`.
Generating chapters for that same run later upgrades it to the full narrated review; `revue export`
still requires a narrated run.

## Inline review threads

A **thread** is the official feedback concept. In Patch view, click a visible old/new line-number
gutter to start one on a single line, or drag within one gutter to select an inclusive range in the
same hunk and side. Dragging source code instead highlights the text itself, which the next section
covers. The composer opens inline beneath the selected range; use `Ctrl+Enter` or its pointer control
to save and `Escape` to cancel. Any number of independent threads may share an exact anchor.

Every root message and reply records an author kind (`human` or `agent`) and display name. Human TUI
messages use the reviewed repository's `git config user.name`, falling back to the system login.
Messages from the public agent CLI require an explicit author name. `[Reply]` opens an inline composer
inside the owning thread. Each thread's status and short id sit in its box border title; open threads
use an attention marker, and resolved threads remain visible with a green check and dimmed messages
and can be reopened. Replies may be deleted individually via the control on their author row, while
the root message is deleted only by deleting its thread; either deletion asks for confirmation in a
modal first.

The **Comments** surface (`o`, or the strip under the menu bar) lists every thread in the review in
one place; `Enter` jumps to the thread's chapter and anchor. While open threads remain, the Comments
tab carries their count, so triage state reads from anywhere in the review.

Threads are stored atomically under `.revue/threads.json` at the reviewed repository root, located
from the supplied run directory and keyed by immutable `runId`. Every mutation takes a cross-process
lock and re-reads the latest same-run threads before replacing the file, so concurrent TUI and agent
writers preserve each other's feedback. Regenerating chapters for the same frozen code preserves
feedback without modifying the run directory.

Agents create and reply through the verified public interface:

```bash
revue threads create "$RUN" \
  --file src/value.ts --old-start 4 --side additions --start-line 8 --end-line 10 \
  --author "Review agent" --body "Should this limit be lower?"
revue threads reply "$RUN" <thread-id> --author "Fix agent" --body-file response.md
revue threads list "$RUN" --json          # open threads only
revue threads list "$RUN" --json --all    # include resolved threads
revue threads mark-dealt "$RUN" <thread-id>
revue threads reopen "$RUN" <thread-id>
revue threads delete-message "$RUN" <thread-id> <message-id>
revue threads delete "$RUN" <thread-id>   # permanent; erroneous feedback only
```

Use `--body-file -` to read a multi-line message from stdin. List and mutation output is JSON. Every
operation validates the supplied prepared run and its local thread state without recomputing Git
scope. `revue comments` remains a command-name compatibility alias, but `threads` is the official API.

## Copying

The lines a thread anchors to are also the lines you want to quote elsewhere, so the same selection
answers to more than one verb. Right-clicking anywhere on a line — its gutter or its code — opens a
menu at the pointer offering copy `path:line`, copy GitHub link, and comment. Every verb acts on the
whole selection rather than the one line under the pointer, whether that selection came from a gutter
drag or from dragging across the code. While a composer is open the same two copies are on `Ctrl+Y`
and `Ctrl+G` and in its footer, and neither disturbs the draft.

Dragging across source code highlights the text itself in one theme-matched Visual-mode colour,
which `y` copies verbatim and the pointer menu offers as its first entry while a highlight exists. A
successful yank flashes in the theme's success colour, then clears the selection as Vim leaves Visual
mode. Change markers are chrome rather than code, so no `+` or `-` is ever caught in a drag. Because
mouse reporting is on, this is Revue's own selection rather than the terminal's; reach the terminal's
with whichever modifier it uses (usually
<kbd>Option</kbd> or <kbd>Shift</kbd>). Opening the pointer menu redraws the lines under it and so
drops the highlight, but the menu keeps both the text and the lines it covered.

A deleted-side range is numbered and linked under the path and commit it had then, so a rename
resolves to the old file rather than the new one. A permalink needs a `github.com` `origin` remote
and a side backed by a commit: in `unstaged` and `work` runs the new side is the working tree, which
no commit holds, so the link verb is disabled and says why instead of handing over a URL that
resolves to different content. Copying is delivered by OSC 52 so it survives ssh and a multiplexer,
with a local pipe alongside it for terminals that quietly drop the sequence.

## Menus, layout, and views

The top File/Navigate/View/Help menu makes the main actions discoverable with a mouse or keyboard.
Press `F10` to open it, use arrow keys and `Enter`, and press `Escape` or click outside to close.
Navigate walks pages and unreviewed chapters, View switches rendering, file display, and file
collapse, and Help opens the keymap in a modal over the review.

A review has three **surfaces**, switched from the strip under the menu bar: **Story** (the narrated
chapter pages), **Files** (`w`, the whole diff without the story), and **Comments** (`o`, every
thread in one list). The Comments tab shows its open-thread count while any remain.

The bottom row is a powerline-style **status bar**: the review context, a reviewed-files gauge, the
open-thread count, and the active Patch/Semantic view, with transient success/error notices in
place. Terminals known to ship the powerline glyphs (Ghostty, WezTerm, iTerm, kitty) get arrow
separators; everyone else gets flush segments, and narrow terminals drop segments rather than wrap.

File lists render paths in one of three **path display modes**, cycled with `p` and listed in the
View menu. **Smart** (the default) hoists the common directory prefix into the Files header and
abbreviates the remaining directories fish-style, always keeping the filename intact; **tree**
nests directories with single-child chains collapsed; **full** keeps raw paths. The choice persists
alongside the other display preferences.

In Patch view, a `⋯` band between hunks (and above the first, below the last) reveals the
unchanged lines around them, GitHub-style: click **▲ expand up**, **▼ expand down** (20 lines a
step), or **↕ expand all** to close the gap. The lines come from the run's pinned blobs, so
expansion never touches Git state.

The sidebar and a side-by-side diff compete for the same columns, so View settles both together.
Diff layout is `auto`, `split` or `stacked`, and the sidebar is `auto`, `shown` or `hidden`. Under
`auto` the panel appears only while the diff beside it could still go side-by-side — below that it
is taking columns from the thing under review — and a split body is used only when it fits and both
sides of the file have changed lines. That threshold is measured against the panel's default width,
so dragging the divider never makes it disappear under the pointer. Asking for `split` outranks an
`auto` sidebar, which matters once the divider has been dragged wide, but an explicit sidebar
preference is never overridden. Both preferences, along with the panel width, chosen diff view, and file display, are remembered
across repositories in `~/.revue/preferences.json`; they do not belong to one run's view state.

Losing the sidebar never costs the chapter. The narrative it holds—title, summary, key changes and
file list—stacks above the diff in a single column instead, the way the prologue already renders,
and the panel's navigation row is replaced by a strip under the menu bar. Terminals wide enough for
the panel are unaffected: they keep the two-column layout exactly as before.

File display is **all** by default, stacking every chapter file in narrative order. **Focused**
shows only the selected file; `Tab` / `Shift+Tab` and the sidebar file list replace it with the next
selection. This choice applies equally to Patch and Semantic views.

Patch is the default view. The View menu can lazily generate a read-only Semantic diff when a compatible
[`difft`](https://difftastic.wilfred.me.uk/) executable is available; it compares only the verified
old/new blobs in the prepared run. Semantic uses Difftastic's coloured side-by-side presentation at
wide content widths and coloured inline output when narrow, translating its styling into safe
OpenTUI spans rather than emitting terminal escapes. A missing or incompatible executable leaves
Patch active and shows a terminal-safe explanation.

## Themes

Every colour Revue paints comes from one theme, derived from one bundled editor theme: the shell,
the diff body, and the highlighted source always agree. Press `t` (or **View → Theme**) to open the
picker; arrow keys preview a palette live, `Enter` accepts, `Escape` cancels. The accepted theme is
remembered machine-wide in `~/.revue/preferences.json`, alongside the reviewer's layout choices.

```bash
# name a theme for this run
bun run revue show examples/sample-run --theme catppuccin-mocha

# list every available name
bun run revue show examples/sample-run --theme list

# let the terminal's own background choose between the light and dark defaults
bun run revue show examples/sample-run --theme auto

# keep the terminal background visible behind Revue's neutral surfaces
bun run revue show examples/sample-run --transparent-bg
```

Without `--theme`, Revue uses the remembered theme and otherwise starts with `ayu-dark`. Pass
`--theme auto` to ask the terminal for its background colour and choose `ayu-light` or `ayu-dark`.
Derivation enforces WCAG contrast floors, so body
text, status colours, and diff row tints stay readable on light and dark themes alike.

## Review ignore rules

A repository may put review-only rules in `.revueignore` at its Git root. Rules use gitignore
semantics and are always relative to that root:

- `/generated.ts` is root-anchored, while `generated.ts` matches that name at any depth.
- A trailing slash matches a directory and its contents (`fixtures/`); `**` spans directories.
- Empty lines and lines beginning with `#` are comments. Escape a leading `#` or `!` (`\#name`,
  `\!name`) to match it literally, and escape trailing spaces when they are significant.
- `!pattern` negates an earlier rule. A file cannot be re-included while one of its parent
  directories remains excluded, matching normal gitignore behaviour.

Repeatable `--ignore <pattern>` options add rules for one prep invocation only. They are evaluated in
command-line order after `.revueignore`, so they can refine or negate persistent rules, and they
never read or modify `.revueignore`. Revue does not import a global Git excludes file into these
rules. Repository `.gitignore` still controls discovery of untracked files, but never hides changes
to files Git already tracks.

Added and modified files match their current path. Deleted files match their deleted path. Renames
and copies match both the current path and the old path; the file is omitted when either path's final
rule state is ignored. Current-path matches are reported first when both paths are ignored. Negate
the relevant old and current patterns to re-include a rename.

Every prepared run records the ordered `.revueignore` and session patterns plus each omitted current
path, matched old/current path, source, and pattern. Prep always reports the omitted count on stderr;
pass `--show-ignored` for a deterministic listing of the effective patterns and omission reasons.
If every changed file is omitted, prep fails with the responsible paths and patterns instead of
creating an empty run.

## Review state and navigation

Review controls and state are shown inline as `[ ]` / `[x]` checkboxes; `▸` identifies the active
chapter, file, and key change. `x` toggles the chapter, `f` toggles the focused file, and `r` toggles
the focused key change; `1`–`9` remain direct key-change shortcuts. Clicking chapter, file, or key-
change content navigates without changing review state—only its checkbox toggles it.

Navigation follows Vim/less conventions: `j`/`k` (or `↑`/`↓`) scroll by line · `d`/`u` or
`Ctrl-d`/`Ctrl-u` scroll by half-page · `Space`/`b`, `Ctrl-f`/`Ctrl-b`, or `Page Down`/`Page Up`
scroll by page · `g`/`G` jump to the top/bottom · `]c`/`[c` move between chapters · `{`/`}` focus key
changes · `tab`/`shift-tab` focus files · `enter` toggles the focused diff · `c`/`e` collapse/expand
all diffs · `a` jumps to the next unreviewed chapter · `w` opens the Files surface · `o` opens the
Comments surface · `p` cycles path display · `s` shows/hides the sidebar · `y` copies the
highlighted text · `Ctrl-y`/`Ctrl-g` copy the open thread's location/GitHub link · `F10` opens the
menu · `?` toggles shortcut help ·
`q`/`esc` quits.
Mouse-wheel and trackpad scrolling are supported. The selected chapter/file is retained when views
or file display change, and switching Patch/Semantic carries the reviewer's relative position through
the chapter.
Semantic mode is intentionally read-only. Key-change anchors and severity-tinted exact ranges work
in both views by source line number; Difftastic rows never become durable review anchors. Binary,
symlink, mode-only, and content-identical metadata changes are described rather than passed off as
semantic source diffs. Progress and the reviewer's location persist to `.revue/state.json`, keyed by both the pinned run and
its chapter narration. Reopening the same run restores the current page, focused file/hunk/question,
collapsed files, and the main and chapter-panel scroll offsets. Saved threads load independently from
`.revue/threads.json`; an unfinished composer draft is deliberately not restored.

### Remapping shortcuts

Every action listed in the help overlay or `revue keybindings` can be rebound in
`~/.revue/keybindings.json`, a JSONC file (`//` and `/* */` comments are stripped before
parsing — trailing commas are not, so keep the JSON itself strict) of `"action-id": "key"` or
`"action-id": ["key", "key"]` entries — an entry replaces that action's full default key list
rather than adding to it. Ctrl-y/Ctrl-g (copy the open thread's location/GitHub link) are
hardcoded outside the registry and cannot be rebound this way. The help overlay (`?`) shows each
action's ID next to its keys, and:

```bash
revue keybindings          # every action, its description, default keys, and effective keys
revue keybindings init     # write a commented starter template to ~/.revue/keybindings.json
```

For example, to swap half-page scrolling onto `Ctrl-d`/`Ctrl-u`:

```jsonc
{
  "half-page-down": "ctrl+d",
  "half-page-up": "ctrl+u"
}
```

Keys are lowercase named keys (`up`, `pageup`, `return`, `f1`–`f12`, …), a `ctrl+` prefix, a
single-character literal, an uppercase letter for a shifted character (`G`, not `shift+g`), or a
`shift+` prefix over a named/special key (`shift+tab`). `escape`, the raw `[`/`]` chord prefixes,
and the digits `1`–`9` are reserved and cannot be bound; the `]c`/`[c` chapter-navigation chord
itself is fixed. An invalid, unknown, or conflicting entry is dropped with a warning — surfaced in
`revue keybindings`'s output and the TUI's footer/help overlay — while the rest of the file still
applies.

### Custom themes

Beyond the bundled palettes, Revue reads reviewer-authored themes from `~/.revue/themes/*.json` —
one theme per file, id taken from the filename. Comments are stripped before parsing (JSONC, like
keybindings). A theme either derives from a bundled theme via `extends` or supplies its own
`background`/`foreground` pair, then may pin individual colour slots verbatim with `overrides`:

```jsonc
// ~/.revue/themes/my-ayu.json
{
  "extends": "ayu-dark",
  "overrides": {
    "accent": "#ff9940"
  }
}
```

`extends` names a bundled theme id (`revue themes` lists them); `background`, `foreground`,
`diffColors.added/removed/modified`, and `syntaxTheme` (a bundled Shiki theme id) fall back to the
`extends` base when the key itself is unset, while `label` falls back to the theme's own id rather
than the base's. Every non-pinned colour is then derived with the same WCAG contrast floors as the
bundled themes. `overrides` pins any of the slot names listed in `revue themes init`'s starter
template to a `#rgb`/`#rrggbb` colour verbatim, after derivation, with no contrast policing — a
pinned colour is used exactly as written.

A custom file whose id matches a bundled theme shadows it in place (shown once, marked
"customised"); any other id is appended as a new theme. Validation is lenient and per-file: a
malformed file, a missing `background`/`extends`, or an unknown `extends` drops the whole theme; a
bad colour, syntax theme, or override slot drops just that key. Dropped entries and their reasons
show up in `revue themes`'s Issues block and the TUI's footer/help overlay.

```bash
revue themes               # bundled + custom themes, grouped by appearance, plus any issues
revue themes init <name>   # write a commented starter template to ~/.revue/themes/<name>.json
```

Custom themes are read once at startup, so editing a file takes effect on the next launch. `auto`
selection between the light/dark defaults, transparent mode, and a missing or broken preferred
theme falling back without rewriting `~/.revue/preferences.json` all behave the same as with
bundled themes.

## Roadmap

- [x] Chapters/prologue zod schema (ported from Stage)
- [x] `revue show` — load and validate a complete run, navigable TUI shell, `--check` summary
- [x] Render each chapter's **diff body** via `@revue/diff-renderer` (`hunkRefs` → filtered hunks; `lineRefs` → exact decorations)
- [x] **Mark-as-reviewed** at chapter / file / key-change level, with progress + auto-advance, persisted to `.revue/state.json`
- [x] Per-chapter **file list** with reviewed checkboxes and `+a -d` stats
- [x] `revue prep` — pin Git scope, old/new blobs, patch, exclusions, and stable `(filePath, oldStart)` review identities
- [x] Scroll long diffs; choose split/stack layout by terminal width
- [x] File/View application menu with pointer and keyboard operation
- [x] Deterministic **Markdown export** for the full review, prologue, or one chapter
- [x] Read-only **Difftastic semantic diff** view over the pinned old/new snapshots
- [x] Authored inline **review threads** with replies and Revue-owned persistence/lifecycle
- [x] **Themes** derived from bundled editor themes, with a live picker, `--theme`, and transparency
- [ ] Decide static-file vs live agent-driven session
- [ ] Mermaid prologue diagram rendering (ASCII)
