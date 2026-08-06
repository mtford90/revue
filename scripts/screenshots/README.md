# Screenshot harness

Captures PNG screenshots of revue's patch view across the diff shapes that usually break diff
renderers — single-character edits, unequal blocks, whitespace-only changes, unicode, very long
lines, moved blocks, and a 300-line deletion — at four terminal widths, both diff layouts, and the
light and dark default themes.

```sh
bun run screenshots
```

Everything lands in `scripts/screenshots/out/` (gitignored):

- `out/shots/<scenario>--w<cols>--<split|stack>--<theme>.png` — the captures
- `out/manifest.json` — one record per capture, plus any failures
- `out/work/` — throwaway fixture repositories, isolated `HOME`s, and the generated tapes

The sweep is 160 vhs runs (the huge-hunk scenario also shoots a second frame after paging down) and
takes around an hour with four scenarios in flight. Every run draws every shot again, because a PNG
on disk carries no record of the code that produced it: reusing one would let a renderer change be
declared good without ever being rendered. Pass `--resume` to keep what an interrupted sweep already
wrote, and only when the code has not moved since.

## How it works

Each scenario is a throwaway git repository under `out/work/fixtures/`: one base commit plus an
uncommitted edit, which `revue diff --ref work` then renders. Every capture runs under its own
`HOME`, whose `.revue/preferences.json` pins the diff layout, so the sweep neither reads nor
disturbs your own preferences, themes, or keybindings.

vhs sizes its terminal in pixels, so the harness measures one cell per font size and solves for the
pixel size that yields exactly 80, 120, 180 and 240 columns at 50 rows before capturing anything.
vhs cannot convert frames much wider than 2150 pixels, so 240 columns are drawn in a smaller face;
each capture's font size is recorded in the manifest.

## Requirements

- `vhs`, `ttyd` and `ffmpeg` on `PATH` (`brew install vhs ttyd ffmpeg`)
- The `Menlo` font, which ships with macOS. vhs defaults to JetBrains Mono; without it installed
  every glyph renders as a tofu box, so the harness names a font that is always present. Change
  `FONT_FAMILY` in `vhs.ts` if you prefer another monospace face.
- vhs drives a headless Chrome, whose own sandbox cannot start inside some confined processes, so
  the harness sets `VHS_NO_SANDBOX`. The browser only ever loads the local ttyd terminal.
