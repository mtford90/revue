# Third-party notices

## Hunk

This package selectively adapts diff body, row-model, line geometry, and syntax-highlighting concepts
from [Hunk](https://github.com/modem-dev/hunk) v0.15.3, commit
`3a2ba1c4c0580f0056bf67b031fb25f2186f35a3`.

Upstream concepts were studied in:

- `src/opentui/HunkDiffBody.tsx` and `src/opentui/model.ts`
- `src/ui/diff/pierre.ts`, `codeColumns.ts`, `rowStyle.ts`, and `useHighlightedDiff.ts`
- `src/ui/components/panes/DiffFileHeaderRow.tsx`

Local modifications replace Hunk's app/session model with Revue-owned public types; use only public
`@pierre/diffs` APIs; add side-aware exact range decoration and focus anchors; limit rendering to
split/stack patch rows and compact headers; and omit Hunk's app, controller, comments, notes, menu,
CLI, loader, watch mode, session broker, review plans, and private package paths. This is a bounded
selective adaptation, not a copy of Hunk's `renderRows.tsx` or application.

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
