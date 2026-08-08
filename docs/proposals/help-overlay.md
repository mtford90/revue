# Proposal: a help surface that teaches the keys

> Status: **implemented**, with the divergences recorded in §11. Kept as the reasoning record
> behind `helpSurface.tsx` and the surface API in `keymap.ts`.

Companion to [`keymap-defaults.md`](./keymap-defaults.md). That proposal widens the on-ramp —
several aliases per action so muscle memory from any tool just works. This one is the other
half: making those keys **discoverable**, so a reviewer who arrives on `↓` eventually finds
`Ctrl-D`.

Two surfaces, one mechanism:

| | What | Density |
| --- | --- | --- |
| **Help surface** (`?`) | every action, grouped, filterable | reference you visit |
| **Footer hints** (status bar) | the handful that matter right now | ambient |

Both answer the same question — *which actions apply here, ranked* — so it is written once and
rendered at two densities.

Not proposed: a hardtime.nvim-style "you pressed `↓` twelve times, try `Ctrl-D`" nudge. It fits
revue well (the matcher already knows which alias you used), but it is the one shape that
annoys people when the thresholds are wrong. Separate decision, later.

---

## 1. What is wrong today

The help overlay is `HelpModal` in `app.tsx`, fed by `keymapSections` in `keymap.ts`.

| Problem | Evidence |
| --- | --- |
| **The Comments surface has no documented keys at all** | All six `comments`-context actions have no `section`; `keymapSections` filters `action.section === title`, so they are dropped. Open Comments, press `?`, see only Page keys — none of which fire. |
| Lines are silently cut | Modal is capped at `HELP_MODAL_MAX_WIDTH = 66`; every row is `wrapMode="none" truncate`. |
| Too long to scan | ~48 rows under the new defaults (30 actions + 11 notes + 7 headings) against `terminalHeight - 4`. Roughly 2½ screens at 24 rows. |
| Raw action ids on every row | `keymapSections` emits `` `${keys} ${description} (${action.id})` `` — `k/↑ Scroll up one line (line-up)`. |
| No sense of place | Page and Comments interleave by section with nothing saying which you are in. |
| Thin scrolling | `j`/`k`/arrows/PgUp/PgDn only — no `g`/`G`, no Home/End, no wheel. |

The first row is the one that matters. The others are polish; that one is the overlay telling
you the wrong thing.

---

## 2. Shape: a full-screen surface

`Comments` is already a full-screen surface, and the pattern transfers exactly:

```ts
const page = commentsSurface ? COMMENTS_PAGE : allFiles ? filesPage : pages[current];
```

`commentsSurface` is a boolean that *substitutes* for the page slot — it is not a member of the
`pages` array. So `current` is preserved underneath and page navigation is untouched. A
`helpSurface` flag in front of it inherits all of that: your place in the diff survives, and
`,`/`.` never land on Help.

```
┌ revue ─────────────────────────────────────────────────────────────────────┐
│ Keys                                              filter: ▏                │
│                                                                            │
│ Here — Comments                                                            │
│   Navigation                                                               │
│         j  ↓  Ctrl-n   Select the next thread            comments-next     │
│         k  ↑  Ctrl-p   Select the previous thread        comments-previous │
│         g  Home        Select the first thread           comments-first    │
│         G  End         Select the last thread            comments-last     │
│     Enter  →           Jump to the selected thread       jump-to-thread    │
│         w              Switch to the Files surface       comments-select…  │
│   Menus                                                                    │
│         ?  F1          Show or hide the shortcuts        toggle-shortcut…  │
│         q  Q           Quit                              quit              │
│                                                                            │
│ Elsewhere — Files & diff · press w to get there                            │
│   Scrolling                                                                │
│         j  ↓  Ctrl-n   Scroll down one line              line-down         │
│         …                                                                  │
├────────────────────────────────────────────────────────────────────────────┤
│ revue  Comments   ▰▰▰▰▱▱▱▱ 4/9 files   j/k move · Enter jump   ? help · q  │
└────────────────────────────────────────────────────────────────────────────┘
```

| Element | Behaviour |
| --- | --- |
| Key column | Right-aligned to a computed width so descriptions line up. **Primary key in `theme.text`, aliases in `theme.muted`** — this is where §7 of the defaults proposal lands. |
| Description | Flexes. |
| Action id | Right-aligned, dimmed, shown only when width allows. It is what you need to write `keybindings.json`, so it stays — as a third column rather than as noise inside the sentence. |
| Columns | Two section columns side by side above ~100 cols, one below. |
| Sections | Unchanged grouping (`Scrolling`, `Navigation`, …), nested inside the context split. |

No new intrinsic is needed — `box`/`text`/`scrollbox`/`input` cover it. OpenTUI ships a
`TextTableRenderable` but does not expose it as a JSX element, so column alignment is a computed
key-column width and nested `flexDirection="row"` boxes.

---

## 3. Contextual: order and mark, do not hide

The value of filtering by context is sharply asymmetric:

| In | Hiding the other context removes | Worth it? |
| --- | --- | --- |
| Page | ~6 of 48 rows | Negligible |
| Comments | ~20 of 48 rows — **and those 20 do not fire** | The actual win |

So the case is truthfulness, not tidiness. But hiding costs discovery: you would never learn the
Comments keys exist without first being in Comments.

**Proposed:** two groups, both always present.

- `Here — <surface>` first, full brightness.
- `Elsewhere — <surface> · press <key> to get there`, dimmed.

Dimming reads as *not now* rather than *not available*, which is exactly true. The routes
between the two already exist and can be named in the heading: `o` (`toggle-comments`) gets you
to Comments, `w` (`comments-select-files`) gets you back.

`global` actions belong in the `Here` group in both contexts, since that is how
`keymapActionsForContext` actually resolves them.

---

## 4. Filter

An `<input>` in the header, focused on entry.

| | |
| --- | --- |
| Matches against | key labels, description, action id |
| Empty state | full grouped list, as above |
| Non-empty | flat ranked list, groups collapsed to a dim context tag per row |
| `Esc` | clears a non-empty filter; closes the surface when already empty |
| `Enter` | no-op for now — see question **1a** |
| `↑`/`↓`/PgUp/PgDn | scroll the list, not the input |

The last row is the implementation risk. `InputRenderable` extends `TextareaRenderable` and
inherits its keybindings, so vertical keys may be consumed before they reach the list.
`ThreadComposer` already deals with this by intercepting via `onKeyDown`, so there is a
precedent to copy rather than a problem to solve.

**Focus discipline is the crux.** With the filter focused, every printable character must go to
the input, not the matcher — otherwise typing "quit" fires `quit`, `toggle-key-change` and
`toggle-file-review` on the way past. The handler must early-return for the help surface before
`matchKeymapAction` runs, exactly as it already does for `threadDraft`.

---

## 5. Footer hints

The status bar has a `flexGrow={1}` region in its middle that renders **nothing unless there is
a notice**, and it already ends with a hardcoded `? help · q quit`. So contextual hints cost
zero rows, yield to notices for free, and are really just finishing a job the bar already does
badly.

Two changes:

1. Fill the empty middle with the ranked hints for the current context, truncated to fit — count
   determined by available width, not a fixed number.
2. **`statusBar.tsx` takes no keymap prop, so `? help · q quit` is a lie after a rebind.** Derive
   it via `keymapHint` instead. (`app.test.tsx:379` asserts that exact tail; under the new
   defaults `?` and `q` are still first, so the assertion survives the change.)

---

## 6. What the registry needs

| Change | Why |
| --- | --- |
| **Give the six `comments` actions a `section`** | Without one they are invisible. `Navigation` for the four cursor moves and `jump-to-thread`; `Navigation` for `comments-select-files`. |
| **Add `hint?: number` to `KeymapActionDef`** | The footer needs to pick a handful. Lower sorts first; absent means never in the footer. Explicit and curated — not a ranking of all 30. |
| Add `"help"` to `KeymapContext` | So the surface has a context of its own. |
| Fill the `KEY_LABELS` gaps | Already required by the defaults proposal (`home`, `end`, `right`, `insert`, `f1`, `f5`, `f7`, `f9`); without it the surface renders raw names like `home`. |

On sections vs contexts — the temptation is a new `Comments` section. Resist it: a section is
*what kind of thing an action is*, a context is *where it works*. Conflating them is what
produced the current mess. Semantic sections, with the Here/Elsewhere split carrying context.

`hint` is the only genuinely new field, and it lands in `keymap.ts` — so it wants deciding
alongside the defaults rather than bolted on after.

---

## 7. Keys inside the surface

Modal-internal keys stay hardcoded, per the existing rule in `keymap.ts`'s header comment.

| Key | Action |
| --- | --- |
| `?` `F1` `q` `F10` | Close (as today) |
| `Esc` | Clear filter, else close |
| `↑` `↓` `PgUp` `PgDn` `Home` `End` | Scroll the list |
| anything printable | Goes to the filter |

Note `j`/`k` are **not** listed. They scroll the current modal, but with a focused filter they
have to type. This is a real loss for vim users and the reason `Home`/`End`/arrows get added.

---

## 8. Sequencing and risk

The defaults land first. The surface's whole layout budget — key column width, whether two
columns fit — depends on how long the key lists get, and §7 of that proposal defines the primary
key that this one renders bright.

| Risk | Note |
| --- | --- |
| `?` stops being a modal | Esc now clears the filter before closing. Small muscle-memory change; pre-launch. |
| `app.test.tsx:882` asserts the modal's `Keyboard shortcuts` title | Needs rewriting for the surface. |
| Filter swallows global single-letter actions | By design, but it is the bug most likely to ship — needs a test that types `quit` into the filter and asserts the app is still running. |
| Footer competes with notices | Notice already owns that box; hints must yield, not stack. |

---

## 9. Decisions taken

| | |
| --- | --- |
| Shape | Full-screen surface, not a modal. Follows the `commentsSurface` substitution pattern. |
| Filter | In scope, focused on entry. |
| Contextual | Order and mark (`Here` / `Elsewhere` dimmed), never hide. |
| Footer hints | In scope, in the status bar's existing empty middle region. |
| Action ids | Kept, as a dimmed right-hand column rather than inline. |
| hardtime-style nudges | Out of scope. |

---

## 10. Open questions

**1a. Should `Enter` on a filtered row run the action?** It would turn help into a command
palette, which is a genuinely better product. But every action is currently an inline `case` in
the keyboard handler's `switch` — running one from elsewhere means extracting all thirty into a
dispatch map first. That is a real refactor with real regression risk, and it is separable.
Recommend **no for now**, with the surface designed so it can be added without rework.

**1b. Which actions get a `hint` rank, and how many show?** Suggest a curated ~6 per context
(Page: `j/k`, `Enter`, `x`, `o`, `?`; Comments: `j/k`, `Enter`, `w`) with the count trimmed to
the available width. Wants your eye more than my judgement.

**1c. Does the footer respect a preference?** Some people will want the bar quiet. There is a
`preferences.ts` already; adding a toggle is cheap but it is scope. Recommend shipping it always
on and adding the toggle only if it grates.

---

## 11. What shipped differently

| Proposed | Shipped | Why |
| --- | --- | --- |
| §2 a `helpSurface` flag substituting for the page slot | An absolutely positioned full-bleed panel between the menu bar and the status bar | Same two properties §2 wanted — your place in the diff survives, `,`/`.` never land on Help — but the review tree underneath is never unmounted, so no scroll position is rebuilt on close. |
| §2 two section columns above ~100 cols | One column always | A full row is keys (11) + description (up to 61) + id (22) ≈ 98 columns. Two columns would need a 200-column terminal before the ids stopped being shaved to nothing, and §9 keeps the ids. |
| §4 an `<input>` in the header, focused on entry | Filter state in `app.tsx`, rendered as text with a block cursor | §4 named the focus fight as the crux: `InputRenderable` inherits Textarea's keybindings, so a focused input would contest the arrow keys and add a second thing that can swallow a global action. The handler already sees every key. |
| §6 `hint?: number` on `KeymapActionDef` | A curated `FOOTER_HINTS` table beside the registry | The bar renders `j/k move` — two actions in one slot — and no action description fits a status bar. A rank field expresses neither, and 30 entries would grow a field 8 of them use. |
| §6 add `"help"` to `KeymapContext` | Not added | Nothing reads it: the surface's own keys are hardcoded per §7, and Here/Elsewhere is keyed on the surface underneath. |
| §7 `q` and `F10` close the surface | `?`, `F1`, `F9`, `F10` and `Esc` close; `q` types | `q` closing while you type `quit` into the filter is the same class of bug as §8's first risk. |
| §5 status-bar hints truncate to fit | Hints shed whole from the right against a computed budget | Half a hint teaches nothing, and the budget is exactly computable from the segments already rendered. |

Notes gained a `context` alongside actions, for the same reason actions have one: a note about the
line-number gutter is a lie on a surface with no gutter. `revue keybindings` now groups the
Comments actions by context rather than by the absence of a section, so its headings survive those
six actions gaining one.
