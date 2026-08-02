# Third-party notices

## Hunk

This package selectively adapts menu-bar, dropdown geometry, keyboard traversal, and menu-controller
concepts from [Hunk](https://github.com/modem-dev/hunk) v0.15.3, commit
`3a2ba1c4c0580f0056bf67b031fb25f2186f35a3`.

Upstream concepts were studied in:

- `src/ui/components/chrome/menu.ts`
- `src/ui/components/chrome/MenuBar.tsx`
- `src/ui/components/chrome/MenuDropdown.tsx`
- `src/ui/hooks/useMenuController.ts`
- `src/ui/lib/appMenus.ts`

Local modifications reduce the menu model to Revue’s File/View chrome; add disabled items; drop Hunk’s
app, controller, theme, agent, editor, filter, and session actions; route every action to Revue-owned
handlers; preserve narrow-terminal labels by omitting shortcut hints first; and isolate open menus
from the chapter and diff surfaces beneath them. Hunk is not a runtime dependency.

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
