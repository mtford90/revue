# Revue Patch view

Revue's Patch view turns a unified patch into a line-numbered terminal diff. It is designed to be
useful outside Revue too: the reusable centre is patch parsing, changed-line analysis, row planning,
and terminal-aware wrapping, with OpenTUI as its current presentation adapter.

This document describes the existing engine and the decisions behind it. A standalone ANSI pager is
a planned consumer, not part of the package today.

## What it owns

The Patch view spans two packages:

- `@revue/diff-model` adapts the public `@pierre/diffs` parser into Revue's file model and owns
  language inference, statistics, changed-line pairing, and intra-line spans.
- `@revue/diff-renderer` turns that model into split or stacked rows, applies syntax and intra-line
  styling, wraps those rows to terminal columns, and presents them through OpenTUI.

The renderer deliberately stops at the diff body and compact file header. Its host owns application
navigation, scrolling, layout policy, persistence, and any review workflow around the patch.

## Pipeline

```text
unified patch
    │
    ▼
parse and normalise files                 @revue/diff-model
    │
    ├── paths, statuses, hunks and line numbers
    ├── language and +addition/-deletion totals
    └── paired changed lines and intra-line spans
    │
    ▼
build terminal-independent rows           @revue/diff-renderer
    │
    ├── split or stacked cells
    ├── syntax spans and emphasis overlays
    ├── side-aware ranges and attachments
    └── terminal-safe text
    │
    ▼
plan visual rows for a terminal width
    │
    └── gutters, signs, padding, wrapping and wide characters
    │
    ▼
OpenTUI DiffBody                          current adapter
```

Patch parsing accepts Git-formatted and plain multi-file unified patches. Revue normalises CRLF,
keeps file boundaries intact, handles `/dev/null` additions and deletions, recognises binary patch
markers, preserves rename paths, and uses only public `@pierre/diffs` APIs. Pierre is pinned to
version 1.2.2 so its parsed and highlighted data shapes remain a bounded compatibility risk.

## Split and stacked rows

The same parsed file can produce either layout:

- **Split** pairs old and new cells horizontally. A change block occupies the length of its longer
  side, with empty cells filling the shorter side. Context appears on both sides.
- **Stacked** emits deletions followed by additions. Context is represented once while retaining
  both old and new line identities.

Rows retain their file, hunk, side, and source line identities regardless of layout. That lets a host
switch presentation without redefining what a line means. The renderer accepts an explicit layout;
the host decides whether terminal width or user preference should choose it.

In stacked layout, new and deleted files drop gutters that can never contain a line number. Binary
files, pure renames, oversized files, empty additions or deletions, and other metadata-only states
receive explicit text instead of a fabricated source diff.

## Intra-line emphasis

A change block is a run of removed lines followed by a run of added lines. Before Revue can emphasise
changed text within those lines, it must decide:

1. which removed line became which added line; and
2. which parts of each paired line changed.

`@revue/diff-model` owns both decisions as pure functions. The renderer only paints their result.

### Pairing changed lines

Pairing is deliberately conservative:

- **Equal-count blocks** pair by position, matching the visual reading of the rows.
- **Unequal-count blocks** score every candidate by its common prefix plus common suffix. The best
  candidates are accepted first, and crossing or duplicate pairs are forbidden so the result stays
  ordered.
- **Both paths use a similarity gate.** The shared affix must cover roughly half the shorter line.
  A shared affix shorter than three characters is not enough by itself.
- A blank line pairs only with another blank line. This preserves useful indentation and
  trailing-whitespace emphasis without claiming that a blank line became a statement.

Failing to pair is normal. An unrelated rewrite keeps its ordinary added or removed row tint rather
than receiving a near-whole-line highlight that implies a relationship Revue cannot justify.

### Finding changed spans

For each accepted pair, Revue:

1. trims the common prefix and suffix;
2. widens the remaining middle to complete tokens;
3. tokenises word, whitespace, and punctuation runs;
4. compares those token streams using longest common subsequence (LCS);
5. merges adjacent unmatched tokens into changed ranges; and
6. widens the ranges to complete grapheme clusters.

The result is a set of zero-based, end-exclusive code-unit ranges for each side. Token-level spans
avoid the scattered single-character "confetti" produced by character-level matching. Grapheme
snapping prevents a combining mark, emoji sequence, or other user-perceived character from being
split between styles or wrapped rows.

Whitespace-only changes within parsed lines produce spans because the background is often their only
visible signal. Syntax foreground colours remain intact; Patch view adds a stronger side-coloured
background behind the changed spans.

## How this differs from GitHub

The comparison here is intentionally narrow: it concerns how Patch view pairs changed lines for
intra-line emphasis, not Revue's surrounding review workflow.

| Change block | GitHub | Revue Patch view |
| --- | --- | --- |
| Equal numbers of removed and added lines | Pairs by position | Pairs by position, then rejects dissimilar pairs |
| Unequal numbers of removed and added lines | Gives the block no intra-line emphasis | Uses gated, order-preserving similarity pairing |
| Unrelated equal-sized rewrite | Positional pairing can imply that unrelated rows correspond | Leaves rejected pairs with their ordinary row tint |

Revue prefers missing emphasis to misleading emphasis. The gate can reject a genuine rewrite, but
that costs less reviewer attention than strongly highlighting unrelated lines as a revision pair.

See [ADR 0005](../../docs/adr/0005-intra-line-emphasis-pairing-and-spans.md) for the alternatives
considered, including Delta, Git's `diff-highlight`, and `codediff.nvim`.

## Wrapping and terminal geometry

Long lines hard-wrap at the available code-column boundary rather than at word boundaries. The
column budget accounts for line-number gutters, attachment markers, change signs, padding, and the
split divider. Code keeps a minimum budget of eight columns; a pane narrower than that deliberately
overflows rather than shredding every line into unusably small fragments.

Wrapping preserves every span's foreground, background, and text attributes. It also guarantees:

- wide characters consume their real terminal width;
- a grapheme within one span is never split;
- a grapheme wider than the available budget still makes progress;
- continuation rows do not repeat line numbers or change signs;
- continuation gutters do not accept range-selection input; and
- split panes use the taller side's visual height, keeping the divider aligned.

Row measurement and rendering use the same width calculation, so a host can plan scrolling and
windowing without disagreeing with what OpenTUI draws. Internally generated intra-line ranges snap
to grapheme boundaries; a host supplying its own spans or emphasis ranges must likewise avoid
placing a span boundary inside a grapheme cluster.

## Highlighting and terminal safety

Syntax highlighting is prepared through Pierre's public Shiki-backed API and cached by parsed line
array identity and syntax theme. Rendering never waits for highlighting: an unavailable grammar or
failed highlighter falls back to readable raw text.

All patch content is untrusted terminal input. Before display, the renderer removes ANSI control
sequences, OSC and other terminal control strings, C0/C1 control bytes, and line breaks while
preserving printable Unicode. Tabs are rendered consistently as two spaces.

## Decorations, selection, and attachments

The OpenTUI adapter exposes optional host seams without owning the features attached to them:

- inclusive, side-aware range decorations;
- shared focus identities and concrete scroll anchors;
- gutter click-and-drag range selection within one file, hunk, and side;
- context-menu callbacks for a line or selected range;
- inline attachments placed after their anchored line;
- host-provided range resolution for display-only patch variants;
- host-provided controls for expanding hunk boundaries; and
- row windows plus attachment measurements for large-diff virtualisation.

Revue uses these seams for review questions, threads, copying, context expansion, and viewport
windowing. Those behaviours are host features, not part of the Patch-view algorithm.

## Performance limits

The renderer degrades by removing optional emphasis rather than blocking the diff:

- intra-line spans are skipped when either line exceeds 1,000 code units;
- unequal blocks exceeding 100,000 removed-by-added candidates skip similarity pairing;
- equal-count positional pairing remains linear and is not subject to that candidate cap; and
- pairing results are memoised on the parsed change block, so unrelated re-renders do not repeat the
  analysis.

Large-screen performance is a separate host concern. Revue's TUI mounts only rows near its viewport;
`DiffBody` supports a supplied row window but does not choose or manage one itself.

One current parser limitation sits outside the emphasis algorithm: normalising a file chunk trims
trailing whitespace from its final patch line. A trailing-whitespace-only change on that exact line
therefore cannot reach the renderer. Other parsed whitespace changes retain their emphasis.

## Current public surface

`@revue/diff-model` exports patch parsing and analysis:

- `parsePatch`, `createDiffFile`, `countDiffStats`, and `inferLanguage`;
- `pairChangedLines` and `intralineSpans`; and
- the corresponding file, statistics, pair, and range types.

`@revue/diff-renderer` exports:

- `DiffBody` and `DiffFileHeader`;
- pure row, layout, decoration, attachment, and line-identity helpers;
- syntax-highlighting preparation and terminal sanitisation; and
- the types hosts need for rows, ranges, spans, layouts, decorations, and attachments.

Both packages are currently private workspace packages. Their interfaces still expose Pierre,
Revue theme, React, and OpenTUI types; they should not be treated as a stable external contract yet.
The wrapping implementation is internal today, even though row planning and rendering both depend on
it; a reusable render-plan interface will need to make that capability available without exposing
OpenTUI.

## Reuse direction

Two consumers are intended:

1. **Embeddable OpenTUI view** — another terminal application mounts the interactive Patch body and
   supplies its own shell, navigation, and optional interactions.
2. **ANSI pager/filter** — a command reads a unified patch from stdin and writes width-constrained,
   styled ANSI output to stdout. This is the mode expected by hosts such as Lazygit, which embed the
   output and therefore require the command not to open an alternate-screen interface.

A direct terminal invocation may add interactive paging, but the ANSI filter and OpenTUI component
should share parsing, pairing, row planning, and wrapping rather than develop separate diff
algorithms. Building that second adapter will establish which current interfaces form the stable
reusable core before any package is published.

Semantic diff is intentionally outside this direction. It compares old and new file contents using
Difftastic and synthesises another patch for Revue's renderer; it is not a feature of a unified-patch
pager.

## Non-goals

The Patch-view packages do not own:

- Git scope resolution or immutable review runs;
- repository access or blob-backed context expansion;
- semantic or structural diff generation;
- chapters, narration, review progress, or persistence;
- thread storage, authorship, or lifecycle;
- application navigation, menus, keybindings, or scrolling; or
- responsive policy for choosing split versus stacked layout.

## Decisions and provenance

- [ADR 0002 — Own the terminal diff renderer](../../docs/adr/0002-own-diff-renderer.md)
- [ADR 0005 — Intra-line emphasis pairing and spans](../../docs/adr/0005-intra-line-emphasis-pairing-and-spans.md)
- [ADR 0007 — Synthesised patches and anchor authority](../../docs/adr/0007-synthesised-patches-and-anchor-authority.md)
- [ADR 0012 — TUI-owned viewport windowing](../../docs/adr/0012-tui-owned-viewport-windowing.md)

Revue uses public `@pierre/diffs` parsing and highlighting APIs. The terminal body, row geometry, and
highlighting approach selectively adapt concepts from Hunk under MIT; exact provenance and deliberate
exclusions are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
