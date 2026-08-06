# ADR 0012 — The TUI owns viewport windowing

- Status: accepted
- Date: 2026-08-05

## Context

Large runs mounted every diff row at once. OpenTUI's `viewportCulling` skips painting but still
runs Yoga layout over every mounted node, so layout cost tracked the diff, not the screen — width
changes and scrolling stuttered on big reviews. OpenTUI offers no real virtualisation and no
scroll events.

## Decision

Revue plans the viewport itself (`packages/tui/src/virtualRows.ts`, `scrollWindow.ts`). Rows are
segments of known height; only segments near the visible window mount, and everything else
collapses into fixed-height gaps so scroll geometry stays exact. Mechanics:

- `scrollTop` is polled (no scroll event exists) and snapped to 40-row steps with 80 rows of
  overscan, so window recomputation happens on step boundaries rather than every scrolled row;
- inline thread heights are measured in place through a renderer attachment-measurement contract
  (`@revue/diff-renderer`'s `attachments`), extending the ADR 0002 boundary;
- `scrollChildIntoView` is replaced by offset-based reveals, because a target inside an unmounted
  gap has no child to scroll to.

Layout cost now tracks the screen, not the diff.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Trust OpenTUI `viewportCulling` | Rejected | Measured: full Yoga layout still runs per width change; culling only skips paint. |
| Paginate the diff | Rejected | Breaks continuous scrolling, selection across boundaries, and jump-to-anchor. |
| Fork OpenTUI to add real virtualisation | Rejected | Carries a fork against ADR 0001's fork-neither stance for a host-solvable problem. |
| TUI-planned segments with fixed-height gaps | Chosen | Exact geometry, bounded mount count, no upstream dependency. |

## Consequences

- Anything that reveals content (jump to anchor, thread open, search) must go through offset-based
  reveals; child-based scrolling silently fails inside gaps.
- Segment heights must be known or measured; a component with unpredictable height needs an
  attachment measurement before it can live in the diff body.
- The 40/80 row constants trade recomputation frequency against overscan memory; they are tuning
  values, not contracts.

## Amendment

ADR 0013 replaces the active package boundary with `@revue/diff` plus `@revue/diff-opentui`; the historical names above describe the implementation at the time of this decision.
