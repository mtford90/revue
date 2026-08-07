# Third-party notices

## Pierre

This package uses the public parsing and syntax-highlighting APIs of
[`@pierre/diffs`](https://github.com/pierrecomputer/diffs), version 1.2.2. Pierre remains a runtime
dependency and its dependency licence is also included in release `BUNDLED_LICENSES.md`.

## Native Syntect highlighter

The optional adjacent N-API addon under `native/` uses Bat's integrated syntax assets, Syntect,
Oniguruma, and napi-rs. Their complete dependency licence texts are collected into each release
archive after the native build; the addon remains outside the Bun executable so either product can
ship and update its matching companion independently.

## Hunk

This package selectively adapts row-model, line-geometry, syntax-highlighting, and terminal-text
sanitisation concepts from [Hunk](https://github.com/modem-dev/hunk). The renderer concepts use
v0.15.3, commit `3a2ba1c4c0580f0056bf67b031fb25f2186f35a3`; terminal safety uses commit
`b0839f9400977e59457f2529b505db7006df3bd2`. Studied sources include
`src/opentui/model.ts`, `src/ui/diff/pierre.ts`, `codeColumns.ts`, `rowStyle.ts`,
`useHighlightedDiff.ts`, and `src/lib/terminalText.ts`.

Local modifications use Revue-owned structural types and public Pierre APIs; add side-aware ranges,
source identities, split/stack planning, width-aware wrapping and terminal sanitisation; and omit
Hunk's application, controller, comments, menu, CLI, loader, watch mode and session model.

Hunk is distributed under the MIT License:

> MIT License
>
> Copyright (c) Ben Vinegar
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.
