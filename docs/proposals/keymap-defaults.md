# Proposal — redesigned default key mappings

Status: **superseded in part by the coherent keyboard review workflow.** The analysis below is a
historical reasoning record, not the effective default map; `packages/tui/src/keymap.ts` and
`revue keybindings` are authoritative.

The approved workflow that supersedes its conflicting defaults is:

- `[`/`]` previous/next chapter; `J`/`K` and Tab/Shift-Tab previous/next file;
- `j`/`k` previous/next reviewable source line, while Up/Down and their coherent Ctrl aliases retain
  the `line-up`/`line-down` viewport-scroll semantics;
- `v` begins a one-line, one-file/hunk/side selection, `j`/`k` extend it, Escape cancels, and Enter
  opens the exact range's composer;
- `e` opens the cursor or selected range's first additions-side line in `$VISUAL` or `$EDITOR`, and
  deleted-side locations refuse clearly;
- `-`/`+` collapse/expand all files, `f` toggles the file reviewed, and `x` toggles the chapter.

The typed registry, keys surface, status/menu hints, CLI listing, and generated override template all
reflect this effective map. In particular, the old `,`/`.` chapter defaults, `j`/`k` scrolling,
`c`/`e` collapse/expand defaults, and `v` file-review alias described below are no longer effective.

Goal (historical): bind several keys per action so that muscle memory from vim, less/man, git, the diff/review
TUIs, the IDEs and plain arrow-key use all land on the right thing.

Decisions taken by Mike and folded in: revue is **pre-launch**, so breaking changes to action ids and
to muscle memory are acceptable; **search is on the roadmap**, so `/`, `n` and `N` are held back for
it; **the `[c`/`]c` chord is retired** and its machinery deleted; no speculative aliases — every
alias must have an identifiable source; `right`/`l` stay off `toggle-file-diff`; modal work is
limited to `f1`/`f9` symmetry, with a registry-driven `modal` context logged as separate work.

Rebased onto `9869e01` ("feat: add a reload action to the TUI"), which adds the `reload` action
(`ctrl+r`, `global`, section Menus). It is covered below.

Everything below was checked against the real matcher and the real input parser, not assumed.

---

## 1. How matching actually works

Three behaviours here drive the whole design.

| Behaviour | Where | Consequence |
| --- | --- | --- |
| Context set is `context === current \|\| context === "global"` | `keymapActionsForContext` | `global` competes with **both** `page` and `comments`. Two key spaces, not four. |
| Winner is `actions.find(...)` over `KEYMAP` order | `matchKeymapAction` | On a duplicate, the **earlier registry entry wins silently**. Declaration order is load-bearing. |
| `keyCandidates` tries `ctrl+x`/`shift+x` then **falls back to bare `x`** | `matchKeymapAction` | An unbound `Ctrl-X`/`Shift-X` still fires whatever `x` is bound to. Half of revue's apparent Ctrl bindings are this, not real bindings. |
| `keymapHint` returns `keys[0]`; overlay renders `displayKeys ?? keys` | `keymap.ts` | `keys[0]` is the de facto primary — it is what menu hints show. |

Verified fall-throughs on today's registry (page context):

| Keystroke | Resolves to | Real binding? |
| --- | --- | --- |
| `Ctrl-D` / `Ctrl-U` | `half-page-down` / `half-page-up` | No — falls through to `d`/`u`. `docs/guide.md` documents these as if real. |
| `Ctrl-E` | `expand-files` | No — falls through to `e`. |
| `Ctrl-P` | `cycle-path-display` | No — falls through to `p`. |
| `Ctrl-Y` | `copy-selection` | No — falls through to `y`. |
| `Shift-J` / `Shift-K` | `line-down` / `line-up` | No — falls through to `j`/`k`. |

### Bug found while checking this

`comments-last` is **unreachable**. It is declared `keys: ["G"]` with no `shift+g` alias. Every
terminal reports capital G as `{name: "g", shift: true}` (verified against opentui's parser), so the
candidate list is `["shift+g", "g"]`; `shift+g` is only on `scroll-bottom`, which is `page` context
and out of scope here, so the fallback `g` wins — **Shift-G in Comments selects the *first* thread**.
`scroll-bottom` escapes this only because it lists both forms. The literal `"G"` never matches alone.

---

## 2. Current state

| Action id | Keys | What it does | Context / section |
| --- | --- | --- | --- |
| `open-menu` | `f10` | Open the menu bar | global / Menus |
| `toggle-shortcut-help` | `?` | Show/hide the shortcuts overlay | global / Menus |
| `open-theme-picker` | `t` | Open the theme picker | global / Menus |
| `quit` | `q` | Quit | global / Menus |
| `reload` | `ctrl+r` | Re-prep the same scope and reopen the run | global / Menus |
| `toggle-comments` | `o` | Comments surface | global / Navigation |
| `previous-key-change` | `{`, `shift+[` | Focus previous key change | global / Review |
| `next-key-change` | `}`, `shift+]` | Focus next key change | global / Review |
| `previous-page` | `[c` | Previous page | chord / Navigation |
| `next-page` | `]c` | Next page | chord / Navigation |
| `line-up` | `k`, `up` | Scroll up one line | page / Scrolling |
| `line-down` | `j`, `down` | Scroll down one line | page / Scrolling |
| `half-page-up` | `u` | Scroll up half a page | page / Scrolling |
| `half-page-down` | `d` | Scroll down half a page | page / Scrolling |
| `page-up` | `pageup`, `b`, `ctrl+b` | Scroll up a page | page / Scrolling |
| `page-down` | `pagedown`, `space`, `ctrl+f` | Scroll down a page | page / Scrolling |
| `scroll-top` | `g` | Scroll to top | page / Scrolling |
| `scroll-bottom` | `G`, `shift+g` | Scroll to bottom | page / Scrolling |
| `next-unreviewed` | `a` | Next unreviewed chapter | page / Navigation |
| `toggle-all-files` | `w` | All-files surface | page / Navigation |
| `focus-file` | `tab`, `shift+tab` | Focus next/previous file | page / Files |
| `toggle-file-diff` | `return` | Toggle focused file's diff | page / Files |
| `collapse-files` | `c` | Collapse all files | page / Files |
| `expand-files` | `e` | Expand all files | page / Files |
| `toggle-chapter-review` | `x` | Toggle chapter reviewed | page / Review |
| `toggle-file-review` | `f` | Toggle focused file reviewed | page / Review |
| `toggle-key-change` | `r` | Toggle focused key change | page / Review |
| `copy-selection` | `y` | Copy highlighted selection | page / Copying |
| `toggle-sidebar` | `s` | Show/hide sidebar | page / Views |
| `cycle-path-display` | `p` | Cycle path display | page / Views |
| `comments-select-files` | `w` | Switch to Files surface | comments |
| `comments-previous` | `k`, `up` | Previous thread | comments |
| `comments-next` | `j`, `down` | Next thread | comments |
| `comments-first` | `g` | First thread | comments |
| `comments-last` | `G` | Last thread — **broken, see §1** | comments |
| `jump-to-thread` | `return` | Jump to selected thread | comments |

Outside the registry: `escape`, digits `1`–`9`, raw `[`/`]` chord prefixes, `ctrl+y`/`ctrl+g` in the
thread composer, and each modal's own navigation.

---

## 3. Proposed defaults

New keys in **bold**. `displayKeys` is what the help overlay shows (§7).

The `keys` columns show the **effective** key list, which is what the conflict analysis in §4 runs
against. Once shift-alias expansion moves into the loader (§5, §10), the registry source itself gets
shorter — an author writes `["G"]`, `["Q"]`, `["J"]`, `["{"]` and the loader derives `shift+g`,
`shift+q`, `shift+j`, `shift+[`.

### Global

| Action | Keys | `displayKeys` | Alias serves |
| --- | --- | --- | --- |
| `open-menu` | `f10`, **`f9`** | `f10`, `f9` | f10 Turbo Vision/current · **f9** Midnight Commander's menu key, and a fallback where the terminal eats F10 |
| `toggle-shortcut-help` | `?`, **`f1`** | `?`, `f1` | `?` lazygit, k9s, GitHub — the modern-TUI convention, **not** vim/less/tig (see §4) · **f1** universal help (mc, gitui) |
| `open-theme-picker` | `t` | `t` | unchanged |
| `quit` | `q`, **`Q`** + **`shift+q`** | `q` | `q` universal · **Q** less binds `q`, `Q`, `:q`, `ZZ`; tig uses `q` close-view, `Q` quit-all |
| `reload` | `ctrl+r`, **`f5`** | `ctrl+r`, `f5` | Ctrl-R browser reload, and mc's `Reread` · **F5** the universal refresh key (browsers, Windows, IDEs). `R` (tig's reload) considered and rejected — §9 |
| `toggle-comments` | `o` | `o` | unchanged — no convention to borrow (§6) |
| `previous-key-change` | `{`, `shift+[`, **`shift+f7`** | `{`, `shift+f7` | `{` vim paragraph motion · **Shift-F7** "Previous Difference" in VS Code and JetBrains |
| `next-key-change` | `}`, `shift+]`, **`f7`** | `}`, `f7` | `}` vim · **F7** "Next Difference" in VS Code and JetBrains |
| `previous-page` | **`,`** | `,` | **replaces the `[c` chord** — lazygit binds `,`/`.` to previous/next page |
| `next-page` | **`.`** | `.` | as above |

**The `[c`/`]c` chord is retired**, not kept as an alias. It was the sole reason the chord machinery
exists, and it used a vim diff idiom (`]c` = next change *in a diff*) for a different meaning. What
goes with it: `handleChapterChord`, the `"chord"` variant of `KeymapContext`, the
`Exclude<KeymapContext, "chord">` on `matchKeymapAction`, `RESERVED_CHORD_PREFIXES` and the
`context === "chord"` rejection in `keybindings.ts`, the hardcoded `"["`/`"]"` entries in
`deriveAppKeys`, and the "fixed, not rebindable" note in `keybindingsCli.ts`.

This frees `[` and `]` as ordinary bindable keys — verified free in both contexts. lazygit uses them
for previous/next tab, which may be worth having later.

#### The `]c` side effect

Retiring the chord means `]` becomes an unbound no-op — so typing **`]c` now collapses every file**,
because the `]` does nothing and the `c` reaches `collapse-files`. Same for `[c`. A vim user reaching
for `]c` ("next change in a diff") gets a fully collapsed chapter instead of a shrug.

Severity is real but bounded: it costs UI state, not data — `e` expands everything back, though a
mixed expand/collapse state is lost. Nobody has `]c` muscle memory *for revue* (pre-launch), so the
exposure is purely vim habit.

It is also not unique to `]`. **Any** unbound key followed by `c` collapses — `h`, `i`, `m`, `z` all
do it today. The underlying property is that `collapse-files` sits on a bare, unqualified `c`; `]c`
is just the two-key sequence most likely to be typed by accident. Options, in the order I'd consider
them:

| Option | Cost | |
| --- | --- | --- |
| **Accept and document**, plus a regression test asserting `[`/`]` stay unbound | A vim user can collapse a chapter once, then learns `,`/`.`. Recoverable with `e`. | **Chosen** |
| Keep a minimal swallow: `[`/`]` consume the next keystroke and show "chapter navigation is now `,` / `.`" | ~6 lines of the machinery we just agreed to delete, and it keeps `[`/`]` out of the free pool. Reads as a migration affordance for a migration nobody needs. | Rejected |
| Move `collapse-files` off `c` | Fixes the general property, not just `]c`. But `c`-for-collapse is the most mnemonic key in the set, and the replacement would be invented. | Rejected |

**Decision: accept and document.** The "unbound key then `c`" property is pre-existing and not made
materially worse by retiring the chord; paying for it with resurrected machinery or a worse
`collapse-files` key is a bad trade. The regression test goes in §10.

### Page

| Action | Keys | `displayKeys` | Alias serves |
| --- | --- | --- | --- |
| `line-up` | `k`, `up`, **`ctrl+p`**, **`ctrl+k`** | `k`, `up` | `k` vim/less/tig/lazygit/gitui · `up` universal · **Ctrl-P** emacs, less, mc, fzf · **Ctrl-K** less, fzf |
| `line-down` | `j`, `down`, **`ctrl+n`**, **`ctrl+e`** | `j`, `down` | `j` vim/less/tig · `down` universal · **Ctrl-N** emacs, less, mc, fzf · **Ctrl-E** vim scroll-down-one-line, less forward-line. Note this **deliberately ends** today's Ctrl-E → `expand-files` fall-through |
| `half-page-up` | `u`, **`ctrl+u`** | `u`, `ctrl+u` | `u` less/tig · **Ctrl-U** vim, less, lazygit, tig — today only a fall-through |
| `half-page-down` | `d`, **`ctrl+d`** | `d`, `ctrl+d` | as above |
| `page-up` | `pageup`, `b`, `ctrl+b` | `b`, `pageup` | keys unchanged; `displayKeys` **order flips** (today `pageup, b`) to match §7's idiomatic-first rule |
| `page-down` | `pagedown`, `space`, `ctrl+f` | `space`, `pagedown` | as above — Space is the man/less default |
| `scroll-top` | `g`, **`home`**, **`<`** | `g`, `home` | `g` vim `gg`/less · **Home** universal, and less's own binding · **`<`** less |
| `scroll-bottom` | `G`, `shift+g`, **`end`**, **`>`** | `G`, `end` | `G` vim/less · **End** universal, less · **`>`** less |
| `next-unreviewed` | `a` | `a` | unchanged — revue-specific (§6) |
| `toggle-all-files` | `w` | `w` | unchanged |
| **`next-file`** | `tab`, **`J`** + **`shift+j`** | `tab`, `J` | **replaces `focus-file`** · Tab universal · **J** GitHub's next-file key |
| **`previous-file`** | `shift+tab`, **`K`** + **`shift+k`** | `shift+tab`, `K` | **replaces `focus-file`** · **K** GitHub's previous-file key |
| `toggle-file-diff` | `return` | `return` | unchanged. `right`/`l` were considered and **rejected**: this is a toggle, so Right would close an already-open file — wrong in every tree UI. `left`/`right`/`h`/`l` stay free so a future expand/collapse-focused-file pair can take all four correctly. |
| `collapse-files` | `c` | `c` | unchanged |
| `expand-files` | `e` | `e` | unchanged |
| `toggle-chapter-review` | `x` | `x` | unchanged — GitHub's mark-as-viewed key, at chapter scope here (§4) |
| `toggle-file-review` | `f`, **`v`** | `f`, `v` | `f` current · **v** GitHub calls this state "Viewed" |
| `toggle-key-change` | `r` | `r` | unchanged (`1`–`9` already give direct access) |
| `copy-selection` | `y`, **`ctrl+insert`** | `y` | `y` vim yank · **Ctrl-Insert** the copy key for people using no TUI; Ctrl-C is unavailable (§5) |
| `toggle-sidebar` | `s` | `s` | unchanged |
| `cycle-path-display` | `p` | `p` | unchanged |

### Comments

| Action | Keys | `displayKeys` | Alias serves |
| --- | --- | --- | --- |
| `comments-select-files` | `w` | `w` | unchanged |
| `comments-previous` | `k`, `up`, **`ctrl+p`**, **`ctrl+k`** | `k`, `up` | mirrors `line-up`; fzf/emacs list movement |
| `comments-next` | `j`, `down`, **`ctrl+n`**, **`ctrl+e`** | `j`, `down` | mirrors `line-down` exactly, so Ctrl-E is not inert here |
| `comments-first` | `g`, **`home`**, **`<`** | `g`, `home` | mirrors `scroll-top` |
| `comments-last` | `G`, **`shift+g`**, **`end`**, **`>`** | `G`, `end` | **`shift+g` is the §1 bug fix** |
| `jump-to-thread` | `return`, **`right`**, **`l`** | `return`, `right` | Enter universal · **Right/l** "open this node". Kept here because jumping is not a toggle, so the asymmetry that ruled it out for `toggle-file-diff` doesn't arise. |

### Held back for search

`/`, `n`, `N` are left unbound and verified free in both contexts, including via fall-through. delta
binds `n`/`N` to next/previous diff section, but less, vim, tig and GitHub all read `n` as
search-next; with search on the roadmap the larger constituency wins. `J`/`K` cover file navigation
instead.

---

## 4. Conflict analysis

The proposed table was run through the real `matchKeymapAction` in both contexts. Checks: duplicate
ownership per context; every declared key re-resolved and compared to its own action; every unbound
`ctrl+X`/`shift+X` over every bound bare key; and the three reserved search keys.

**Zero duplicates, zero misroutes, zero reserved-key claims.** 82 declared keys, 101 context/key
resolutions (`global` keys are checked in both contexts). Two variants were also checked clean and
then rejected on judgement, not collisions: `R`/`shift+r` on `reload` (§9), and `A`/`C` replacing
`w`/`o` (§9).

Both figures are now asserted by tests rather than counted by hand — see `keybindings.test.ts`,
"no key is claimed twice within a context" and "every declared key resolves back to the action that
declared it".

Independently re-verified by an external review (grok-4.5), which re-ran the matcher over the
proposed table and reached the same result.

### Against reserved keys

| Reserved | Claimed? |
| --- | --- |
| `escape` | No |
| `1`–`9` | No |
| raw `[`, `]` | **No longer reserved** — the chord is retired. Both verified free in both contexts. `{`/`}` are unaffected: they arrive as the literal characters, not as `[`/`]`. |
| `/`, `n`, `N` (future search) | No — verified free in both contexts |

Retiring the chord also fixes a pre-existing oddity: **`Ctrl-]` parses as `{name: "]", ctrl: true}`**
(0x1d) and today arms the chord prefix. With the chord gone it falls through to `]`, which is
unbound, so it becomes inert.

### Against hardcoded modal bindings

Modals return early from the handler, so they cannot collide with registry keys. The only question is
whether a new default *should* also work inside them:

| Modal | Keys it owns | Gap | In scope? |
| --- | --- | --- | --- |
| Help overlay | `escape` `?` `q` `f10` close; `j`/`down`, `k`/`up`, `pagedown`/`pageup` | `f1` should also close it | **Yes** — §9 |
| Menu bar | `escape` `f10` close; `left`/`right`, `up`/`down`, `return` | `f9` should also close it | **Yes** — §9 |
| Help overlay | as above | `g`/`G`/`home`/`end`/`ctrl+n`/`ctrl+p` won't scroll it | No — deferred to the `modal` context work (§9) |
| Theme picker | `escape` `q`; `up`/`k`, `down`/`j`; `return` | `ctrl+n`/`ctrl+p`, `home`/`end` | No — as above |
| Context menu | `escape` `q`; `up`/`k`, `down`/`j`; `return` | as above | No — as above |
| Confirm-delete | `escape` `n` `q`; `return` `y` | — | — |
| Thread composer | `escape`, `ctrl+return`, `ctrl+y`, `ctrl+g`; rest is text | — | — |

The two in-scope rows are handler edits, listed in §10.

### Genuine cross-tool conflicts, and who wins

| Key | Conflict | Winner | Why |
| --- | --- | --- | --- |
| `J` / `K` | GitHub: next/previous **file** · lazygit: **scroll** main window · **less: scroll one line past EOF/BOF** · `git add -p`: next/previous hunk | **GitHub** | Genuinely split two-all, so this is the closest call in the table. Decided on value rather than headcount: `j`/`k`, `d`/`u`, Space/`b` and PgUp/PgDn already give scrolling six ways, so less's and lazygit's `J`/`K` add nothing revue lacks — whereas next/previous file has only Tab. Splitting `focus-file` into `next-file`/`previous-file` is what makes GitHub's meaning expressible at all. |
| `n` / `N` | delta: next/previous diff section · less, vim, tig, GitHub: **search** | **search** | Held back. See §3. |
| `,` / `.` | lazygit: previous/next page · nothing else claims them | lazygit | Free keys, direct precedent. |
| `f` | less/vim: page forward · revue: toggle file reviewed | **revue** | `f`-for-file matters more in a review tool; Space/PgDn/Ctrl-F already page. |
| `x` | GitHub: mark **file** viewed · revue: toggle **chapter** reviewed | **revue** | Scope mismatch a GitHub user learns in one press; `v` is added as the file-level "Viewed" key. |
| `return` | less: forward one line · revue: toggle focused file's diff | **revue** | Enter-as-activate is the stronger expectation. |
| `h` | less: **help** · vim: cursor left | **neither — leave unbound** | Two large audiences disagree and revue has no horizontal motion. |
| `t` | GitHub: focus file filter · revue: theme picker | **revue** | Status quo, low traffic. |
| `y` | vim: yank · `git add -p`: **accept this hunk** | **vim** | `git add -p`'s verbs have no revue equivalent (§6). |
| `]c` / `[c` | vim: next/previous **change in a diff** · revue: next/previous **page** | **vim — by withdrawal** | revue stops using the idiom rather than fighting over it. The chord is retired and `,`/`.` take over; `[`/`]` return to the free pool. |
| `f10` | Turbo Vision/revue: menu · Midnight Commander: **quit** | **revue** | `f9` gives mc users the menu key they expect. |
| `?` | lazygit, k9s, GitHub: **help** · vim, less, tig: **search backwards** | **help** (status quo) | Flagged because search is on the roadmap. Most modern tools with `/`-search offer no separate backwards key — they use `/` plus `n`/`N` — so search can land without needing `?`. If you ever do want backwards search, help would have to give `?` up and live on `f1`. |
| `,` | lazygit: previous page · tig: **move to parent** (tree/blame views) | **lazygit** | tig's meaning is view-specific and has no revue analogue. |
| `f5` | browsers/Windows/IDEs: **refresh** · Midnight Commander: **Copy** | **refresh** | mc's F-key row is a DOS-era legacy; F5-as-refresh is overwhelmingly the modern association. |

---

## 5. Terminal reality

All statements produced by running opentui's own `parseKeypress` over raw byte sequences.

### The renderer's actual input configuration

`createCliRenderer({ exitOnCtrlC: true })` passes no `useKittyKeyboard`. In opentui that resolves to
`{}`, which means the **kitty keyboard protocol is requested by default at flags 1|4** (disambiguate
+ report-alternate-keys), and the stdin parser runs with `useKittyKeyboard: true`. Terminals without
support ignore the request and keep sending legacy bytes. So revue runs on **two input encodings**
and every default must work under both.

### Cannot be detected — never propose these

| Intended | What arrives (legacy terminals) | Verdict |
| --- | --- | --- |
| `ctrl+i` | `name: "tab"` | Unusable. Distinguishable only on kitty-protocol terminals. |
| `ctrl+m` | `name: "return"` | Unusable, same caveat. |
| `ctrl+[` | `name: "escape"` | Unusable, same caveat. |
| `ctrl+h` | `name: "backspace"` | Unusable, same caveat. |
| `ctrl+j` | `name: "linefeed"` | Unusable — `linefeed` isn't in `NAMED_KEYS`, so it cannot be bound at all. Ctrl-J scrolls down on kitty terminals only, by fall-through to `j`. |
| `ctrl+c` | Consumed by the renderer (`exitOnCtrlC: true`) | Unusable. Hence `ctrl+insert` for copy. |
| `ctrl+s`, `ctrl+q` | May be swallowed by terminal flow control (IXON) | Never bind. Today's fall-through already makes Ctrl-S toggle the sidebar and Ctrl-Q quit where IXON is off. |
| any `alt+`/`meta+` | No alt form in the grammar. `ESC j` parses as `{name: "j", meta: true}` and `keyCandidates` ignores `meta`, so **Alt-J is indistinguishable from `j`**. | Unusable without a grammar change. Rules out JetBrains' Alt-Left/Right and VS Code's Alt-F5. |

### The shifted-key rule

Every terminal reports a shifted **letter** as lowercase + `shift: true`. A literal uppercase default
such as `"G"` never matches on its own.

> **Every shifted-letter default must carry both forms** — `["G", "shift+g"]`, `["Q", "shift+q"]`,
> `["J", "shift+j"]`, `["K", "shift+k"]` — with `displayKeys` carrying the literal so the overlay
> shows it once.

This proposal makes that a **mechanism rather than a convention**: `expandShiftAliases` runs over the
default registry at load, exactly as it already does for user overrides, so an author writes
`["G"]` and the loader derives `shift+g`. `comments-last` is what happens when a convention like this
is left to authors to remember. See §10 for the mechanics.

Shifted **punctuation** differs: `{`, `}`, `<`, `>`, `?` are text-producing, and kitty's disambiguate
flag leaves text-producing keys as plain text. They arrive as the literal character under both
encodings, so binding the literal alone is correct. The existing `shift+[`/`shift+]` aliases are
unreachable at current renderer flags but harmless — keep them, and do **not** add matching
`shift+,`/`shift+.` for `<`/`>`.

To be precise about that last point, since it is easy to half-check: the *parser* does handle
`\x1b[91;2u` as `{name: "[", shift: true}`, so `shift+[` would match if such a sequence arrived. The
claim is about **emission**, not parsing — at flags 1|4 kitty leaves text-producing keys as text, so
`{` arrives as `{`, and the sequence is never sent. Flag 8 (report all keys as escapes) would change
that, and opentui does not set it.

### Deliberately not proposed

| Key | Why not |
| --- | --- |
| `shift+up`/`shift+down` (vim's `<S-Up>`/`<S-Down>` = page) | Only some terminals send modified arrows. The same keystroke would page in kitty and line-scroll in Terminal.app. Leaving them unbound is *better*: fall-through makes Shift-Arrow behave exactly like Arrow everywhere. |
| `shift+pageup`/`shift+pagedown` | Widely intercepted for scrollback. |
| `f11` | Fullscreen in many terminals. |
| `gg` | There is no multi-key machinery left once the `[c`/`]c` chord is retired, so `gg` would mean building it back. `g` alone already goes to the top, as it does in less. |

### Verified-good but secondary

`f1`, `f5`, `f7`, `f9`, `f10`, `shift+f7`, `home`, `end`, `insert`, `ctrl+insert` (both xterm
`CSI 2;5~` and rxvt `CSI 2^`) all parse correctly. But macOS maps F-keys to system functions unless the user
opts in, and GNOME Terminal claims F10 — so **F-keys are always secondary aliases, never an action's
only binding**. Every F-key above sits beside a letter or symbol.

---

## 6. Coverage gaps

Listed, not built.

### Single-bound because no convention fits

`toggle-comments` (`o`), `next-unreviewed` (`a`), `toggle-all-files` (`w`), `collapse-files` (`c`),
`expand-files` (`e`), `toggle-sidebar` (`s`), `cycle-path-display` (`p`), `open-theme-picker` (`t`).
All revue-specific; vim's collapse/expand equivalents (`zM`/`zR`) are chords.

### Missing actions a user of tool X would expect

| Missing | Expected by | Notes |
| --- | --- | --- |
| **Search** (`/`, `n`, `N`) | less, man, vim, tig, GitHub, delta | On the roadmap; keys reserved and verified free. Note `?` (backwards search in vim/less/tig) is **not** available — it is the help key. |
| **Expand / collapse the focused file** as a directional pair | tree UIs, lazygit (`left`/`right` for hunks) | `left`, `right`, `h`, `l` all deliberately left free in the page context so this pair can take all four at once. `return` remains the toggle. |
| **Hunk-level navigation** | VS Code/JetBrains F7, vim `]c`, tig `@` | Key changes are the nearest thing and now carry F7/Shift-F7. |
| **Horizontal scrolling** | vim `h`/`l`, less arrows, tig `Left`/`Right` (one column) | Nothing to bind — which is why `h` can stay unbound at no cost. Mild tension with `right`/`l` on `jump-to-thread`, but the Comments list is not a diff, so there is no column to scroll. |
| **`git add -p` verbs** (`y`/`n`/`s`/`e`) | anyone reviewing with `git add -p` | revue's model is mark-as-reviewed, not accept/reject. |
| **Centre current line** (`zz`) | vim | Minor. |

Resolved by this proposal: next/previous file as distinct actions, and single-key chapter navigation.

---

## 7. Primary keys, help overlay and menu hints

Two implicit notions of "primary" already exist and disagree: `keymapHint` returns `keys[0]` (used by
menu items and the right-click menu), and `displayKeys` is a separate "what to show". This proposal
names them rather than adding a field:

- **`keys[0]` is the primary, contractually.** Not a new field — `mergeKeymap` replaces `keys`
  wholesale on override, so `keys[0]` is already the user's own first key after a rebind. A separate
  `primary` field would have to be derived from it anyway, and would go stale if it weren't.
- **`displayKeys` = the idiomatic key plus the universal key.** Ctrl aliases and third options stay
  out of the overlay and live in `revue keybindings`.

The vim-key-versus-arrow-key question turns out not to need resolving: **none of the contested
scrolling actions appear in a menu**, so nothing ever forces one key for them. The overlay shows
`k/↑`, `j/↓`, `g/Home`, `G/End`, `b/PgUp`, `Space/PgDn` — both, always. Actions with no universal
counterpart show their single key.

Two supporting changes:

- The overlay gains one line — "every alias: `revue keybindings`" — so hidden aliases are
  discoverable. A one-line addition to `KEYMAP_SECTION_NOTES`.
- The `displayKeys` doc comment currently says the field exists to hide terminal-reporting duplicates
  (`G` vs `shift+g`). It now also hides secondary-audience aliases; the comment needs updating.

---

## 8. Risk

Pre-launch, so override-file and muscle-memory breakage is not a concern. Two mechanical notes:

- New defaults **beat** existing user overrides — `resolveConflicts` sees one untouched owner and
  drops the override with a footer warning. The fixed point copes if the user also moves the
  conflicting default; order is irrelevant. Confirmed by running `mergeKeymap`, not inferred.
- Renaming `focus-file` to `next-file`/`previous-file` makes `"focus-file"` an **unknown action** in
  any existing override file — dropped with a warning, per `readCandidate`. Pre-launch, so this is a
  release-note line rather than a migration.
- `docs/guide.md` lines 312–320 and its "Remapping shortcuts" section describe the current set and
  need rewriting. **Its worked example must be fixed as part of that**: it shows
  `{"half-page-down": "ctrl+d", "half-page-up": "ctrl+u"}` two paragraphs after stating that an entry
  *replaces* the full default key list — so a reader following it silently loses bare `d`/`u`. The
  example should list every key it wants to keep (`["d", "ctrl+d"]`), and is worth re-picking too,
  since Ctrl-D/Ctrl-U are defaults under this proposal and no longer need an override to demonstrate.
- **ADR 0009 needs amending** in three places, since chords no longer exist: the Decision section's
  context list (`global`, `chord`, `page`, …), the "Reserved" bullet (drop the raw `[`/`]` clause and
  "chord actions cannot be rebound" — escape and digits remain reserved), and the options-table row
  "Make digits and chords rebindable | Rejected". Digit jumps are still structural; the chord
  rationale no longer applies. Its "Shifted letters expand automatically" bullet also needs widening
  — that now covers the defaults, not just overrides.

`ctrl+y` is deliberately **not** added to `line-up`, despite vim and less both binding it there, so
Ctrl-Y keeps one meaning (copy the open thread's location) across the app. It continues to fall
through to `copy-selection` in the page context, which is consistent.

---

## 9. Decisions

All settled. Nothing in this proposal is blocked on a further call.

| | Decision |
| --- | --- |
| `J`/`K` | Split `focus-file` into `next-file`/`previous-file`; GitHub's meaning wins over lazygit's scroll. |
| `n`/`N` | Held back for search, along with `/`. delta loses; less/vim/tig/GitHub win. |
| `,`/`.` | Take over page navigation. |
| `[c`/`]c` | **Retired**, with all the chord machinery. `[`/`]` return to the free pool. |
| `]c` → collapse | Accepted and documented (§3), guarded by a regression test. Not worth resurrecting machinery or moving `collapse-files`. |
| Shift aliases | Expanded by the loader over the defaults, not hand-listed per action — the structural fix for the §1 bug. In scope. |
| Guide remap example | Fixed as part of the `docs/guide.md` rewrite, not left as a known trap. In scope. |
| Ctrl fall-through | Kept — it is what makes Shift-Arrow safe to leave unbound. |
| Primary key | `keys[0]`, no new field; `displayKeys` shows idiomatic + universal. |
| Speculative aliases | None. Every alias needs an identifiable source. |
| `right`/`l` | Off `toggle-file-diff` (it's a toggle); kept on `jump-to-thread` (it isn't). |
| Modals | `f1` closes help, `f9` closes the menu. Nothing else. |
| `reload` | Keeps `ctrl+r`, gains `f5`. **Not** `R` — see below. |
| `w` / `o` / `a` | Kept as they are — see below. |

**No `R` for `reload`.** tig binds `R` to "reload and refresh the current view", so the provenance is
good and it checks clean (83 keys, 104 resolutions). Rejected because `r` is `toggle-key-change`, so
`R` sits one missed shift from a re-prep. Reload is mostly safe — content-addressed, so an unchanged
scope is a true no-op preserving threads, progress and position — but changed content opens a new
chapterless run, which is a surprising thing to trigger by fat finger. `ctrl+r` and `f5` carry it,
and neither is adjacent to a frequently pressed key.

**`w`, `o` and `a` stay.** They are the only three defaults that are neither idiomatic nor mnemonic
(everything else is either — `c`ollapse, `e`xpand, `f`ile, `p`ath, `s`idebar, `t`heme, or `y`/`g`/`G`/
`j`/`k`/`x`). The systematic alternative was capital letters for surface switching — `A` + `shift+a`
for all-files and `C` + `shift+c` for comments, which checks clean at 86 keys / 108 resolutions, with
`a` and `c` still reaching their own actions because the shifted form is found first. Rejected on
three grounds: it trades an unshifted key for a shifted one on frequently used actions; the menu and
help overlay already teach these, which is most of what a mnemonic buys; and it is an invented system,
which is the same objection that ruled out speculative aliases. Discoverability here is a docs
problem, not a keymap problem.

### Logged as separate work, not part of this change

- **Registry-driven modal navigation.** A `modal` context with shared `list-next` / `list-previous` /
  `list-first` / `list-last` / `activate` / `dismiss` actions that the theme picker, context menu,
  confirm-delete and help overlay all derive from. Today each modal hardcodes its own keys in
  `app.tsx`, which is the same triple-declaration drift ADR 0009 was written to stop. Adding
  `ctrl+n`/`ctrl+p`/`home`/`end` to each modal by hand would deepen it, so those are not proposed.

---

## 10. Implementation notes for later

**Handler dispatch — the trap.** `previous-page`/`next-page` become `global`, so
`matchKeymapAction("comments", …)` will now return them. But the comments branch is a `switch` with
explicit cases and `default: break` — a matched action with no case is a **silent no-op**. Today page
navigation works on the Comments surface only because `handleChapterChord` ran *before* the context
split. So `,`/`.` must either be hoisted above the split (as `previous-key-change`/`next-key-change`
and `open-menu` already are) or given cases in **both** switches. The `reload` commit is the
precedent: being `global` was not enough — it needed a case in each branch. Hoisting is cleaner.
Tests must exercise `,`/`.` from the Comments surface, not just a chapter page.

**Retiring the chord** touches more than the registry:

| File | Change |
| --- | --- |
| `packages/tui/src/keymap.ts` | Drop `"chord"` from `KeymapContext`; drop the `Exclude<KeymapContext, "chord">` on `matchKeymapAction` and `keymapActionsForContext`; drop the hardcoded `"["`/`"]"` from `deriveAppKeys` and its comment |
| `packages/tui/src/keybindings.ts` | Drop `RESERVED_CHORD_PREFIXES` and its use in `isBareKey`; drop the `context === "chord"` rejection in `readCandidate` |
| `packages/tui/src/keybindingsCli.ts` | Drop `chordNote`, the `context !== "chord"` filter in the template, and the reserved-keys comment's `[`/`]` clause |
| `packages/tui/src/app.tsx` | Delete `handleChapterChord`, `chapterNavigationPrefix` and its two resets; add `previous-page`/`next-page` cases to the switch |
| `packages/tui/src/keybindings.test.ts` | `isValidUserKey("[c")` now false for a different reason (two chars, not reserved); "a chord action cannot be rebound" test goes |
| `packages/tui/src/keybindingsCli.test.ts` | Three tests filter on `context === "chord"` and one asserts `chordActions.length > 0` — all need rewriting |
| `packages/tui/src/app.test.tsx` | **Also affected** — `"[c walks back into the prologue instead of stopping at chapter one"` (line 448), `"opening a menu cancels an incomplete chapter chord"` (line 810), and a `]c` assertion at line 873 |
| `docs/adr/0009-…md`, `docs/guide.md` | See §8 |

**Display plumbing.** §7's overlay examples (`g/Home`, `G/End`, `?/F1`, `Ctrl-r/F5`) need
`KEY_LABELS` in `keymap.ts` extended — it currently covers only `up`, `down`, `pageup`, `pagedown`,
`return`, `space`, `escape`, `tab`, `f10`. Without additions for `home`, `end`, `right`, `insert`,
`f1`, `f5`, `f7` and `f9`, the overlay renders `g/home` and `Ctrl-r/f5` instead.

**Modal symmetry** (§4): `f1` joins the help overlay's close keys, `f9` joins the menu bar's. Both
are one-line additions to the hardcoded lists in the `useKeyboard` handler.

**Shift-alias expansion on the defaults** (in scope — it is the structural fix for the §1 bug):

| Step | Detail |
| --- | --- |
| Move `expandShiftAliases` from `keybindings.ts` into `keymap.ts` | **Required, not cosmetic.** `keybindings.ts` already imports `KEYMAP` from `keymap.ts`, so importing the other way would be a cycle. It is a key-grammar concern, so `keymap.ts` is its natural home anyway. |
| Update the two importers | `keybindingsCli.ts` and `keybindingsCli.test.ts` import it by path only |
| Expand at module definition, not in `loadEffectiveKeymap` | `matchKeymapAction`, `keymapSections` and `keymapHint` all default to the bare `KEYMAP`, and `menu.tsx` imports it directly. Expanding only inside the loader would leave those paths unexpanded and reintroduce the same bug by a different route. |
| Derive `displayKeys` from the pre-expansion list | Exactly what `resolveConflicts`'s `buildEffective` already does for overrides: `displayKeys: keys.length > raw.length ? raw : undefined`. Without it the overlay renders `G/Shift-g`. |
| Drop the now-redundant hand-written aliases | `scroll-bottom`, `previous-key-change`, `next-key-change`, `quit`, `next-file`, `previous-file`, `comments-last` all stop needing their second form spelled out |

Unaffected: `<`, `>`, `?` — `shiftAliasFor` only maps `A`–`Z` and `{`/`}`, which is correct, since
those arrive as literal characters under both encodings (§5).

**Everything else:**

- The handler's `focus-file` case derives direction from `key.shift`. The split into `next-file` /
  `previous-file` replaces that with two cases; `requestFileFocus()` is called by both.
- `previous-page`/`next-page` become `global`, keeping them reachable from the Comments surface as
  they are today (`handleChapterChord` ran before the context split).
- `deriveAppKeys` strips modifiers, so the new keys widen the `preventDefault` gate as expected.
- Registry **order** matters (§1). New entries must not be inserted ahead of an existing action that
  shares a key.
- Tests worth adding, all cheap:
  - no key is claimed twice per context — would have caught the `comments-last` bug;
  - `/`, `n`, `N` stay unbound, so the search keys are not quietly spent;
  - `[` and `]` stay unbound, guarding the §3 decision;
  - `,` and `.` navigate pages **from the Comments surface**, guarding the dispatch trap above.

---

## 11. Sources

- less — GNU `less(1)`: <https://man7.org/linux/man-pages/man1/less.1.html>
- vim scrolling — <https://vimhelp.org/scroll.txt.html>
- vim motions — <https://vimhelp.org/motion.txt.html>
- vim diff `]c`/`[c` — <https://vimhelp.org/diff.txt.html>
- `git add -p` prompt keys — <https://git-scm.com/docs/git-add>
- delta `navigate` (`n`/`N`) — <https://github.com/dandavison/delta#navigation-keybindings-for-large-diffs>
- tig defaults — <https://github.com/jonas/tig/blob/master/doc/manual.adoc> (the authoritative key
  tables; `tig(1)` and `tigrc(5)` don't list defaults). Confirms `k`/`j`, `PgUp`/`-`, `PgDown`/`Space`,
  `Home`/`End` for first/last line, `R` reload, `q` close-view / `Q` quit, `/` search with `n`/`N`,
  and `?` as **search backwards**
- lazygit keybindings — <https://github.com/jesseduffield/lazygit/blob/master/docs/keybindings/Keybindings_en.md>
- gitui — <https://github.com/gitui-org/gitui/blob/master/vim_style_key_config.ron> (this is the optional
  *vim-style* config, not gitui's defaults)
- fzf defaults — <https://raw.githubusercontent.com/junegunn/fzf/master/man/man1/fzf.1>
- GitHub keyboard shortcuts — <https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts>
  (does **not** list `J`/`K`)
- GitHub `J`/`K` for next/previous file — <https://github.blog/changelog/2025-09-25-pull-request-files-changed-public-preview-now-supports-commenting-on-unchanged-lines/>
  (changelog for a public-preview feature; corroborated by refined-github below)
- refined-github `j`/`k`/`x` in diffs — <https://github.com/refined-github/refined-github/blob/main/source/features/keyboard-navigation.tsx>
- VS Code F7 / Shift-F7 — <https://code.visualstudio.com/docs/editing/tips-and-tricks>
- JetBrains F7 / Shift-F7, Alt-Left/Right — <https://www.jetbrains.com/help/idea/differences-viewer.html>
- emacs motion — <https://www.gnu.org/software/emacs/manual/html_node/emacs/Moving-Point.html>
- Midnight Commander F9 menu / F1 help / Ctrl-N/P — <https://source.midnight-commander.org/man/mc.html>
  and <https://github.com/MidnightCommander/mc/blob/master/misc/mc.default.keymap>
- kitty keyboard protocol — <https://sw.kovidgoyal.net/kitty/keyboard-protocol/>
- opentui input layer — `@opentui/core` `src/lib/parse.keypress.ts`, `parse.keypress-kitty.ts`, and
  `createCliRenderer`'s `useKittyKeyboard ?? {}` default (read from the installed 0.1.x build)
