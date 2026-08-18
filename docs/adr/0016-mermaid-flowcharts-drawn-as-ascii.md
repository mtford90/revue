# ADR 0016 — Mermaid flowcharts are drawn as ASCII, and everything else stays source

- Status: accepted
- Date: 2026-08-08

## Context

A narration can carry figures. The `diagram` field of a prologue, and each `ascii` or `mermaid`
fence in a chapter summary, render as a diagram block beside the diff (see
[ADR 0014](0014-narrative-depth-and-frozen-context.md) for the chrome and the fold of the block). An
`ascii` figure is the drawing itself, thus Revue renders it as written. Mermaid was never the
drawing: Revue showed its own source, dimmed, in a block with the label `diagram · mermaid source`.

That result is bad for the reader. Agents write Mermaid: the skill asks for that notation, and every
other tool draws it. Thus the reviewer got the one figure that they had to decode by hand. A
terminal has no SVG and no canvas, but a terminal has box-drawing characters. A flowchart is exactly
the shape that those characters can carry.

## Decision

**Revue parses a supported Mermaid flowchart and draws it as ASCII art with boxes and arrows. Each
other figure falls back to the source of the author.** The parser and the drawing engine live in
`@revue/diff`, beside the rest of the visual plan that knows the width (ADR 0002). `planDiagram`
decides what a diagram block holds. Every presentation adapter renders that decision, and does not
decide again.

The prologue keeps the box with a border that it already had: one figure, no fold, and its own
title. The prologue calls the same engine with its own interior width. A move of the prologue into a
diagram block is a later decision.

**The subset is `flowchart` and `graph`, and nothing else.** The subset holds:

- nodes in any bracket form. Revue draws them all as boxes, because a diamond in a terminal reads
  worse than a rectangle;
- directed links and undirected links;
- link labels in the `-->|text|` form or the `-- text -->` form;
- node chains;
- `%%` comments;
- `;` statement separators.

If a parse cannot account for a statement, the parse returns nothing. It does not guess.

**The layout is always top to bottom, whatever direction the source declares.** The columns are the
scarce axis in a terminal, and the rows are not. The content column is the part of the terminal that
is left after the sidebar. A reviewer can scroll, but a reviewer cannot make the terminal wider.
Revue thus accepts and records `LR`. But a figure with a sideways layout falls back on width much
more often than it draws.

Revue ranks the nodes by the longest path. A link across more than one layer passes through a
placeholder cell, thus Revue draws nothing across a box. A link that must go sideways, or that
carries a label, gets its own channel row. Thus two links never share one line. Revue draws the
cells as connection masks, not as characters. Thus the corners, the tees, and the crossings resolve
by construction.

**The fallback is a designed path, not a rescue.** These inputs all show the source exactly as
before:

- another diagram type;
- flowchart syntax that the parser does not model;
- a cycle;
- malformed source;
- a figure wider than the `codeWidth` of the block.

Revue gives such a block the label `diagram · mermaid source` and colours it as source. The plan
says which of the two forms it holds (`drawn`). Thus the label and the colour of the body cannot
become different.

## Options considered

| Option | Verdict | Why |
| --- | --- | --- |
| Keep showing Mermaid source (status quo) | Rejected | The reviewer must decode the notation that the agent got the instruction to write. |
| Depend on a Mermaid parser or renderer | Rejected | It brings a dependency with the shape of a browser into a headless engine, for a subset that a small parser covers. |
| Honour `LR` by laying out sideways when it fits | Rejected | It needs two layout engines and it has two failure modes. The same figure also changes shape when the sidebar opens. |
| Wrap or truncate a figure too wide for the block | Rejected | Wrapped ASCII art is not a picture. The source is at least readable. |
| Best-effort drawing of any diagram type | Rejected | A sequence diagram that is drawn in part gives wrong information. A refusal does not. |
| Draw the flowchart subset, fall back for the rest | Chosen | The common case becomes a picture, and each other case keeps exactly the behaviour of today. |

## Consequences

- A Mermaid figure is now a picture, not source. Thus the `drawn` flag of the diagram block drives
  its label and its body colour, and its kind does not.
- The drawn subset is a contract. To make it larger with subgraphs, cycles, or a sideways layout is
  a later decision. If Revue makes it smaller and gives no message, pictures become source again.
- The height of a figure now depends on the layout, not on the number of lines in the source. The
  `show N lines` count of the fold band and the row geometry of the viewport both read that height
  from the plan.
- The Markdown export does not change. It emits the Mermaid fence, because a Markdown reader draws
  it.
