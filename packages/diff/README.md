# `@revue/diff`

`@revue/diff` is Revue's Bun-targeted, presentation-neutral Patch engine. It parses unified patches
into Revue-owned structural types, analyses changed lines, prepares safe styled spans, and produces a
complete width-aware visual plan. It does not choose responsive layout policy or import React,
OpenTUI, Revue themes, Git, chapters, threads, review state, or semantic-diff generation.

Pierre 1.2.2 supplies the public parser and highlighter APIs behind this boundary. Pierre declares
React and React DOM peers itself, so installing the engine is not transitively React-free; the engine
has no direct React dependency and exports no Pierre type.

## Pipeline

```text
unified patch
  -> parsePatch (paths, statuses, modes, hunks, lines, statistics)
  -> changed-line pairing and intra-line spans
  -> syntax spans, decorations, sanitisation, split/stack logical rows
  -> planDiff(layout, width, visibility, styles, chrome)
  -> fully wrapped visual rows with resolved pane/code widths and split padding
```

`planDiff` takes an explicit `split` or `stack` layout, available width, line-number and hunk-header
visibility, plain style slots, range decorations, optional span emphasis, and a declarative chrome
request. Each planned line retains its file/hunk/side/line identity, continuation index, sign,
first-row gutters, wrapped spans and resolved background. Split cells are already padded to the same
height. An adapter mounts or serialises the plan; it must not wrap, align or invent continuation rows.

The engine also exports pure range-to-hunk, row-to-range and focus-anchor lookup. Durable identities
are source identities, never presentation renderable IDs.

## Parsing and analysis

Git and plain multi-file patches are accepted. CRLF is normalised; file boundaries, trailing patch
line whitespace, `/dev/null` additions/deletions, binary markers, rename paths, statuses, modes and
line arrays are retained. Language inference includes `.env*` fallback.

Changed-line pairing is conservative: equal blocks pair positionally under a similarity gate;
unequal blocks use gated, order-preserving affix similarity. Changed spans are token-level,
end-exclusive code-unit ranges snapped to grapheme boundaries. Long or pathological inputs degrade
by omitting optional emphasis rather than blocking display.

Terminal text is sanitised before planning. Long lines hard-wrap by terminal columns without
splitting graphemes, and style spans survive wrap boundaries. Chrome widths are declarative: the
OpenTUI adapter requests its one focus-marker and three attachment-marker columns; another adapter
may request zero.

## Ownership boundaries

The OpenTUI components, pointer behaviour, React-valued attachments, renderable IDs, measurement and
theme mapping live in [`@revue/diff-opentui`](../diff-opentui/README.md). Prep depends only on this
engine. TUI-owned semantic generation, context expansion, viewport window selection, source links,
threads and review state remain outside both packages.

A future ANSI pager may serialise the same visual plan, but no ANSI output mode or pager is included
in this refactor.

See [ADR 0013](../../docs/adr/0013-separate-patch-engine-from-presentation-adapters.md) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
