# Third-party notices

## Hunk

This package selectively adapts palette-derivation concepts from
[Hunk](https://github.com/modem-dev/hunk) v0.17.7.

Upstream concepts were studied in:

- `src/ui/lib/color.ts` (blend, WCAG relative luminance, contrast ratio)
- `src/ui/lib/shikiThemes.ts` (the bundled editor-theme surface, foreground, and diff colours)
- `src/ui/themes.ts` (deriving one complete palette from one editor theme under contrast floors)

Local modifications reduce the palette to the colours Revue actually paints — dropping Hunk's moved
line, note, git file-status, semantic syntax-remap, and line-number-background tokens; add a
`badgeModified` token Hunk computes but exposes only as file-status colours, and a `heading` token
for Revue's shell, which separates headings from focus where one editor theme does not; drop Hunk's
config-defined custom themes and legacy theme aliases; and rely on OpenTUI's own terminal
background detection rather than an OSC 11 prober. Hunk is not a runtime dependency.

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
