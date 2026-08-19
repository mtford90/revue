# `@revue/diff`

`@revue/diff` is Revue's Bun-targeted, presentation-neutral Patch engine. It parses unified patches
into Revue-owned structural types, analyses changed lines, prepares safe styled spans, and produces a
stable width-aware visual plan. It does not choose responsive layout or viewport policy and does not
import React, OpenTUI, Revue themes, Git, chapters, threads, or review state.

Pierre 1.2.2 supplies the public parser and highlighter APIs behind this boundary. Pierre declares
React and React DOM peers itself, so installing the engine is not transitively React-free; the engine
has no direct React dependency and exports no Pierre type.

## Pipeline

```text
unified patch
  -> parsePatch (paths, statuses, modes, hunks, lines, statistics)
  -> changed-line pairing, syntax spans, sanitisation and stable logical identities
  -> planDiff(file, layout, width, visibility, chrome)
       stable wrapping, continuation rows, split padding and measured heights
  -> paintDiff(plan, styles, mounted window, transient decorations)
       selection, focus, hunk and emphasis paint for only the requested rows
```

`planDiff` is the public width-aware engine boundary. Its inputs are limited to stable geometry:
file, explicit split/stack layout, available width, line-number/header visibility, prepared syntax
theme and an adapter-declared chrome request. Every planned line retains file/hunk/side/line
identity, continuation index, sign, first-row gutters and wrapped spans; split cells are already
padded to the same height.

`paintDiff` has no width input and cannot reconstruct wrapping. It applies theme slots, range focus,
pointer selection, selected-hunk backgrounds and optional span emphasis only to a caller-selected
logical-row window. Presentation adapters therefore mount or serialise planned rows without wrapping,
aligning or inventing continuation rows, while TUI navigation can reuse the unchanged plan during
interactive paint updates.

The public barrel intentionally does not export row builders, wrapping functions, width arithmetic,
or visual-height helpers. Unit tests for those internals import their owning modules directly.
Durable identities are source identities, never presentation renderable IDs.

## Parsing and analysis

Git and plain multi-file patches are accepted. CRLF is normalised; file boundaries, trailing patch
line whitespace, `/dev/null` additions/deletions, binary markers, rename paths, statuses, modes and
line arrays are retained. Language inference includes `.env*` fallback.

Changed-line pairing is conservative: equal blocks pair positionally under a similarity gate;
unequal blocks use gated, order-preserving affix similarity. Changed spans are token-level,
end-exclusive code-unit ranges snapped to grapheme boundaries. Long or pathological inputs degrade
by omitting optional emphasis rather than blocking display.

Terminal text is sanitised before planning. Long lines hard-wrap by terminal columns without
splitting graphemes, and style spans survive wrap boundaries. Chrome is always explicit: the
OpenTUI adapter requests its focus, attachment, sign, edge and divider columns; another adapter may
request zero chrome.

## Ownership boundaries

The OpenTUI components, pointer behaviour, React-valued attachments, renderable IDs, measurement and
theme mapping live in [`@revue/diff-opentui`](../diff-opentui/README.md). Prep depends only on this
engine. TUI-owned context expansion, viewport window selection, source links, threads and review
state remain outside both packages.

`@revue/diff-ansi` is an implemented ANSI pager adapter consuming the same plan and paint stages;
it owns ANSI bytes and file envelopes while this engine remains presentation-neutral.

See [ADR 0013](../../docs/adr/0013-separate-patch-engine-from-presentation-adapters.md) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
