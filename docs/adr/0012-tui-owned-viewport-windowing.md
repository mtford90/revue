# ADR 0012 — The TUI owns viewport windowing

- Status: accepted
- Date: 2026-08-05

## Context

A large run mounted every diff row at one time. The `viewportCulling` option of OpenTUI does not
paint a hidden node, but Yoga still lays out every mounted node. Thus the layout cost followed the
size of the diff, not the size of the screen. A width change or a scroll then became slow on a large
review. OpenTUI has no true virtualisation and no scroll event.

## Decision

Revue plans the viewport itself (`packages/tui/src/virtualRows.ts`, `scrollWindow.ts`). The rows are
segments of known height. Only the segments near the visible window mount. Each other segment
becomes a gap of fixed height, thus the scroll geometry stays exact. The mechanics are:

- Revue polls `scrollTop`, because OpenTUI has no scroll event. Revue snaps the value to steps of 40
  rows and keeps 80 rows of overscan. Thus Revue computes the window again at a step boundary, not
  at each scrolled row;
- Revue measures the height of an inline thread in place. The measurement contract for the
  attachments of the renderer (`attachments` in `@revue/diff-renderer`) does this, and it extends
  the boundary of ADR 0002;
- reveals by offset replace `scrollChildIntoView`, because a target inside an unmounted gap has no
  child to scroll to.

The layout cost now follows the size of the screen, not the size of the diff.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Trust OpenTUI `viewportCulling` | Rejected | A measurement showed that Yoga still lays out all nodes at each width change. The culling only omits the paint. |
| Paginate the diff | Rejected | It breaks the continuous scroll, the selection across a boundary, and the jump to an anchor. |
| Fork OpenTUI to add real virtualisation | Rejected | It needs a fork, but ADR 0001 refuses a fork. The host can solve this problem. |
| TUI-planned segments with fixed-height gaps | Chosen | The geometry is exact, the number of mounted nodes has a limit, and there is no upstream dependency. |

## Consequences

- Each function that reveals content must use a reveal by offset. These functions are the jump to an
  anchor, the open of a thread, and the search. A scroll to a child fails inside a gap and gives no
  message.
- You must know or measure the height of each segment. A component of unknown height needs an
  attachment measurement before it can go in the diff body.
- The constants of 40 rows and 80 rows balance the frequency of the computation against the memory
  of the overscan. They are tuning values, not contracts.

## Amendment

ADR 0013 replaces the active package boundary with `@revue/diff` and `@revue/diff-opentui`. The older names above describe the implementation at the date of this decision.
