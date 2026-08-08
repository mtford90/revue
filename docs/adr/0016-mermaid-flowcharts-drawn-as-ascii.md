# ADR 0016 — Mermaid flowcharts are drawn as ASCII, and everything else stays source

- Status: accepted
- Date: 2026-08-08

## Context

Narration can carry figures: a prologue's `diagram` field and any `ascii` or `mermaid` fence in a
chapter summary render as a diagram block beside the diff (see [ADR 0014](0014-narrative-depth-and-frozen-context.md)
for the block's chrome and fold). An `ascii` figure is the drawing itself, so it renders as written.
Mermaid never was: it was shown as its own source, dimmed, in a block labelled
`diagram · mermaid source`.

That is a poor deal for the reader. Mermaid is what agents actually write — it is the notation the
skill asks for, and the notation every other tool renders — so the reviewer was handed the one
figure they had to decode by hand. A terminal has no SVG or canvas, but it does have box-drawing
characters, and a flowchart is exactly the shape they can carry.

## Decision

**A supported Mermaid flowchart is parsed and drawn as box-and-arrow ASCII art; everything else
falls back to the author's source.** The parser and the drawing engine live in `@revue/diff`
beside the rest of the width-aware visual plan (ADR 0002), so `planDiagram` decides what a block
holds and every presentation adapter renders the result the same way.

**The subset is `flowchart`/`graph` and nothing else.** Nodes in any bracket form (all drawn as
boxes, since a terminal diamond reads worse than a rectangle), directed and undirected links, link
labels in either `-->|text|` or `-- text -->` form, node chains, `%%` comments, and `;` statement
separators. A parse that cannot account for a statement returns nothing rather than guessing.

**Layout is always top to bottom, whatever direction the source declares.** Columns are the scarce
axis in a terminal and rows are not: the content column is what is left of the terminal after the
sidebar, and a reviewer scrolls but cannot widen. `LR` is therefore accepted and recorded, but a
figure laid out sideways would fall back on width far more often than it would draw.

Nodes rank by longest path, links spanning more than one layer pass through a placeholder cell so
nothing is drawn across a box, and each link that has to travel sideways or carry a label gets a
channel row of its own, so two links never share one line. Cells are drawn as connection masks
rather than characters, so corners, tees and crossings resolve by construction.

**The fallback is a designed path, not a rescue.** Another diagram type, unmodelled flowchart
syntax, a cycle, malformed source, or a figure wider than the block's own `codeWidth` all show the
source exactly as before, labelled `diagram · mermaid source` and coloured as source. The plan says
which of the two it holds (`drawn`), so the label and the body colour cannot drift apart.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Keep showing Mermaid source (status quo) | Rejected | Leaves the reviewer decoding the notation the agent was asked to write. |
| Depend on a Mermaid parser or renderer | Rejected | Pulls a browser-shaped dependency into a headless engine for a subset a small parser covers. |
| Honour `LR` by laying out sideways when it fits | Rejected | Two layout engines and two failure modes, and the same figure would change shape as the sidebar opens. |
| Wrap or truncate a figure too wide for the block | Rejected | Wrapped ASCII art is not a picture; the source is at least readable. |
| Best-effort drawing of any diagram type | Rejected | A half-drawn sequence diagram misinforms; a refusal does not. |
| Draw the flowchart subset, fall back for the rest | Chosen | The common case becomes a picture, and everything else keeps exactly today's behaviour. |

## Consequences

- Mermaid figures are pictures rather than source, so the diagram block's `drawn` flag is now what
  drives its label and body colour rather than its kind.
- The drawn subset is a contract: growing it (subgraphs, cycles, sideways layout) is a later
  decision, and shrinking it silently would turn pictures back into source.
- A figure's height now depends on layout rather than on the source's own line count, which the
  fold band's `show N lines` count and the viewport's row geometry both read from the plan.
- Markdown export is unaffected: it emits the Mermaid fence, because a Markdown reader draws it.
