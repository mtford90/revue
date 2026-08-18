# Changelog

All notable changes to Revue are documented here. Release notes are grouped from the commits between adjacent release tags.

## [0.8.1](https://github.com/mtford90/revue/compare/v0.8.0...v0.8.1) (2026-08-18)


### Bug Fixes

* ignore the untracked .scratch planning tree and refresh release route markers ([f34d036](https://github.com/mtford90/revue/commit/f34d036fa423c7fac450383a4c114e4479ccdb86))
* make chapter index height responsive ([e05a2ee](https://github.com/mtford90/revue/commit/e05a2eee9b4bb59a5649a80e5bea8b3789ef3cf5))

## [0.8.0](https://github.com/mtford90/revue/compare/v0.7.0...v0.8.0) (2026-08-09)


### Features

* draw mermaid flowcharts as ascii instead of showing their source ([3ed73ed](https://github.com/mtford90/revue/commit/3ed73ed601a75f74ed6628fb2ad99c2f9b44186e))
* rename the Story and Files surfaces to Narrative and Diff ([50f8220](https://github.com/mtford90/revue/commit/50f8220e60da028ee53ce1a65bc528adc26e9723))


### Bug Fixes

* remove redundant sidebar labels ([9cbe8b8](https://github.com/mtford90/revue/commit/9cbe8b8a7c5b9ee9e27e3021b9a8bcdc5b2ea48c))
* widen the drawn mermaid subset and stop a stale label winning ([2416ad6](https://github.com/mtford90/revue/commit/2416ad6e50074d1fac0476bdbe664809984e5c6e))

## [0.7.0](https://github.com/mtford90/revue/compare/v0.6.1...v0.7.0) (2026-08-08)


### Features

* add a reload action to the TUI ([9869e01](https://github.com/mtford90/revue/commit/9869e01741e771dabb2fff2e54a96906bfc73b3a))
* carry review marks through a reload, minus the files that moved ([b8500b7](https://github.com/mtford90/revue/commit/b8500b76275681fa507e4972a21ed4f06083a05c))
* carry review marks through a reload, minus the files that moved ([5521260](https://github.com/mtford90/revue/commit/55212603cc43c4fa17bcd2251a075d3e162f1ab5))
* choose a light theme and a dark theme, and follow the terminal ([e95fb0b](https://github.com/mtford90/revue/commit/e95fb0be9249ed86352028162ef33cdc64d89d85))
* comment on excerpt lines with their own anchor kind ([1f9a55f](https://github.com/mtford90/revue/commit/1f9a55f4a2daf91744055bf872a6608d50f6c074))
* **diff:** colour quoted excerpt lines ([5fcd0b2](https://github.com/mtford90/revue/commit/5fcd0b23bfcc1a500d476a3ef83d17320bc58ad4))
* **diff:** make excerpt gutters live like a diff line's ([518b17a](https://github.com/mtford90/revue/commit/518b17a3d98b73f34cf5d4193f50d248383ce0dc))
* **diff:** plan and render context excerpt blocks ([a8f73ad](https://github.com/mtford90/revue/commit/a8f73adf9a751eeb26ed98cfdff1a42baaf5a85b))
* **diff:** plan and render diagram blocks ([a7f179e](https://github.com/mtford90/revue/commit/a7f179e954d925c275061a0f3420c9caf8f70bb6))
* **markdown-export:** state coverage in a partial export ([830d1ad](https://github.com/mtford90/revue/commit/830d1ade06f935618d61543b63a9655fd18a84f3))
* narrative depth, context excerpts, and interludes ([40adb25](https://github.com/mtford90/revue/commit/40adb2500ef2d3dd8952c3a0ae5af838192ad69c))
* **prep,tui:** freeze cited code off disk with revue context freeze ([7bc0c39](https://github.com/mtford90/revue/commit/7bc0c391dccf2e09ca1a7235f8bf3827818fe2ce))
* **tui:** render interlude pages in the story sequence ([c1aad54](https://github.com/mtford90/revue/commit/c1aad54f0dfe3fb0569c587bc913a9f4509b3a58))
* **tui:** render narration fences as code and diagrams ([9bc588e](https://github.com/mtford90/revue/commit/9bc588e29ce970f27c486f22ba647f0ec90ed0d4))
* **tui:** select, copy and link excerpt lines ([9bfb024](https://github.com/mtford90/revue/commit/9bfb0246938ec0a36b3d5875fca29dfc29016f31))
* **tui:** show cited excerpts in the chapter stream ([d1669de](https://github.com/mtford90/revue/commit/d1669dec3537c67c1224bd8dfa47c640efe114e6))
* **tui:** state coverage for a zoomed-out narrative ([11ff53b](https://github.com/mtford90/revue/commit/11ff53b49606f35ce41674253819ce7eb220e8c1))
* **tui:** yank chapter narration, with or without its reference ([f75b96a](https://github.com/mtford90/revue/commit/f75b96a252d4672f2a8389e30fe9d29c31bccd54))
* **types,prep:** key coverage strictness on declared narrative depth ([43bd99e](https://github.com/mtford90/revue/commit/43bd99e6450d9ce8505d2735d420186c4c015bbc))
* **types:** let a chapter cite ranges of unchanged code ([f8ef31a](https://github.com/mtford90/revue/commit/f8ef31aec0e4f58fb9c111e97851bb6d4039ba53))
* widen the default keymap and replace the shortcut overlay with a keys surface ([a401e1e](https://github.com/mtford90/revue/commit/a401e1ede87b43c310ee2cd03feb322e26bf2063))


### Bug Fixes

* close defects the adversarial review found in narrative depth ([840ffd8](https://github.com/mtford90/revue/commit/840ffd814a06b55dcd59eb5e808b13c66939b651))
* **diff:** reserve the sign slot for excerpt and diagram blocks ([96c732f](https://github.com/mtford90/revue/commit/96c732f9f6d58a927741ada6e10f9f934f31f12e))
* **tui:** draw figures and say what prep left out ([292a37e](https://github.com/mtford90/revue/commit/292a37e6b09db6759baafabfd56aba4741aba55c))
* **tui:** name skill drift on unrecognised chapters fields ([942ccde](https://github.com/mtford90/revue/commit/942ccde6f03aecb0fd5b1c69f6e60429bee75cf5))

## [0.6.1](https://github.com/mtford90/revue/compare/v0.6.0...v0.6.1) (2026-08-07)


### Bug Fixes

* unblock release builds after version bumps ([6d1d599](https://github.com/mtford90/revue/commit/6d1d59980a2ba1877a8e5e8180bcf369fef983b4))

## [0.6.0](https://github.com/mtford90/revue/compare/v0.5.0...v0.6.0) (2026-08-07)


### Features

* add local revuediff demo harness ([461fbe7](https://github.com/mtford90/revue/commit/461fbe7a797023e5df5fdbc57fca6a3c05815725))
* add native Syntect syntax highlighting ([11edb4e](https://github.com/mtford90/revue/commit/11edb4e6909ac930657c1edf152a336466c9670b))
* add Revuediff performance benchmark harness ([4538fb8](https://github.com/mtford90/revue/commit/4538fb8828d6e97b16dc8a472353f360d48a4fa8))
* configure diff chrome and revuediff ([a5e6f71](https://github.com/mtford90/revue/commit/a5e6f71c0e35c1138ebb795dfe807436adb28c78))
* separate revuediff as a standalone product ([b6f49e9](https://github.com/mtford90/revue/commit/b6f49e9cf4ac22084c182aaf959bbcdee7e59a26))


### Bug Fixes

* build native highlighter before CI tests ([f50eb60](https://github.com/mtford90/revue/commit/f50eb60afc2934f02e8527eb745738148171cecc))
* correct Revuediff performance harness ([5d00447](https://github.com/mtford90/revue/commit/5d00447a0bbf04dd85a931ea79a9234f01280cbe))
* isolate native highlighter addon lookup ([94f8744](https://github.com/mtford90/revue/commit/94f87448f0193bda3bbda618e6c1c81bc921d4fe))
* prefer ignored paths in release routing ([cf9304d](https://github.com/mtford90/revue/commit/cf9304d6a39d33b30ccb7ba5f26607628e94f4dc))
* preserve native syntax fallback rendering ([a7bbda3](https://github.com/mtford90/revue/commit/a7bbda3d5d008ad66766a25fd5acf4a3746729f9))
* start narrating on bare revue skill invocation ([c22f137](https://github.com/mtford90/revue/commit/c22f137851d281c68007a431a680ea453605f517))
* tighten performance report schema ([adeeef2](https://github.com/mtford90/revue/commit/adeeef2dc67959f91322018594b256ce4d53dc1e))


### Performance Improvements

* defer Revuediff Shiki fallback ([5dc46df](https://github.com/mtford90/revue/commit/5dc46df70a07a644ed7df324f6534354eb06ded3))
* narrow Revuediff theme startup ([15a2fdc](https://github.com/mtford90/revue/commit/15a2fdce8c7cefd3bf3b8813908933991e72f234))

## [0.5.0](https://github.com/mtford90/revue/compare/v0.4.0...v0.5.0) (2026-08-06)


### Features

* **diff-model:** add intra-line pairing and span computation ([b2eba15](https://github.com/mtford90/revue/commit/b2eba1570bbd530662be833c65d0dd296d6da5f6))
* **diff-renderer:** add a column-aware wrap layout for diff rows ([d0009c4](https://github.com/mtford90/revue/commit/d0009c43a1ecf8d253bedfcaa721d75f16fac211))
* **diff-renderer:** render intra-line emphasis in the patch view ([556c12f](https://github.com/mtford90/revue/commit/556c12f478023ae84843cf67c9aff5db6a78d285))
* **diff-renderer:** soft-wrap long diff lines with room to breathe ([062f941](https://github.com/mtford90/revue/commit/062f941f6499a0e3c67f2e47597f8eeb39355bcf))
* **prep:** honour standard Git exclusions ([012afab](https://github.com/mtford90/revue/commit/012afabd3533496313bf3e5110f158ba9433c3b3))
* refactor patch engine into core and OpenTUI adapter ([a1a97fc](https://github.com/mtford90/revue/commit/a1a97fcef70224f41f2333db415136b1b49a8e50))
* **theme:** add diff emphasis background slots ([3162ddd](https://github.com/mtford90/revue/commit/3162ddd0e30fa15af8ed34f183a58e66df251dd0))


### Bug Fixes

* close diff planning review gaps ([b008e2d](https://github.com/mtford90/revue/commit/b008e2de7e3ecfce49341a2e97e6bc640c491bff))
* **diff-model:** gate equal-count pairs by similarity ([85cd34b](https://github.com/mtford90/revue/commit/85cd34be4df9aab60f919e33ad522db92aa4d483))
* **diff-model:** snap emphasis ranges to grapheme boundaries ([ec19569](https://github.com/mtford90/revue/commit/ec19569245a592ced38124bd2f4d528bdc12bdb2))
* **diff-model:** stop pairing blank and trivially alike lines ([582ab9c](https://github.com/mtford90/revue/commit/582ab9ca6ae3be3b4f03d09971e987bde162863d))
* **diff-renderer:** stop continuation gutters accepting clicks ([4554d2e](https://github.com/mtford90/revue/commit/4554d2eefb77072bec706ab3d8ef9556dbbaa94d))
* keep resize planning viewport-bounded ([0905bae](https://github.com/mtford90/revue/commit/0905baed86b6929da24efbc5871a6c71354c777a))
* restore bounded diff planning ([8be48cf](https://github.com/mtford90/revue/commit/8be48cf8a7cb9173f3048e1d186a702df4d54c67))
* **screenshots:** draw every shot again unless resuming is asked for ([f47be10](https://github.com/mtford90/revue/commit/f47be10e97e100c52e3e23d8717bba384c038f43))


### Performance Improvements

* **diff-model,diff-renderer:** cap and memoise intra-line pairing ([9a73d21](https://github.com/mtford90/revue/commit/9a73d21c89da5d550968e5bf63d34bd21d2c5860))
* **diff-model:** raise the pairing cap now memoisation absorbs the cost ([402d73f](https://github.com/mtford90/revue/commit/402d73ff6fe938a844575a21ee614ecacffdcfee))

## [0.4.0](https://github.com/mtford90/revue/compare/v0.3.0...v0.4.0) (2026-08-05)


### Features

* **tui:** add revue themes CLI subcommand ([7ee0d61](https://github.com/mtford90/revue/commit/7ee0d61e5dafb44c7254334a75e512a0caa5734c))
* **tui:** load custom themes from ~/.revue/themes ([43fd727](https://github.com/mtford90/revue/commit/43fd727fff9c93269e4718b376b34503f96d368f))


### Bug Fixes

* **theme,tui:** harden custom theme validation and surfacing ([65398cd](https://github.com/mtford90/revue/commit/65398cd1933824fac77e43c3fe40983969513217))

## [0.3.0](https://github.com/mtford90/revue/compare/v0.2.3...v0.3.0) (2026-08-05)


### Features

* add revue keybindings CLI subcommand ([8583f9c](https://github.com/mtford90/revue/commit/8583f9c3521aa1af8866a0e0e4fd658dd6987c77))
* load and apply ~/.revue/keybindings.json overrides ([7912920](https://github.com/mtford90/revue/commit/7912920cfbb52455a41bd470f87a2a1d34bf7c23))


### Bug Fixes

* anchor initial release changelog ([d768999](https://github.com/mtford90/revue/commit/d7689998adc5d7e6679caa388da8be9fee7c064e))
* correct keybinding-override merge conflicts, shift-key matching, and reserved keys ([b3cf1d8](https://github.com/mtford90/revue/commit/b3cf1d8736b3d1ac7af95c43225dee2168a1c36f))
* correct keybindings CLI round-trip fidelity and overridden flagging ([8dc4b82](https://github.com/mtford90/revue/commit/8dc4b8254328400b53d073b9ef0c6f9415a1ad8b))
* correct keybindings doc example and digit gloss ([e6ab041](https://github.com/mtford90/revue/commit/e6ab04170eca1148b9f6ce0ccf5ac9ed2d721b13))
* restore escape-quits and unfreeze the keymap registry ([95eee56](https://github.com/mtford90/revue/commit/95eee564ff07aef89ce73fb214a6f812991a1470))

## [0.2.3] - 2026-08-04

- Added a `curl | sh` installer with checksum verification for prebuilt binaries.
- Improved the narrated-review onboarding and made surface tabs stay centred or degrade cleanly in narrow terminals.

[Full changelog](https://github.com/mtford90/revue/compare/v0.2.2...v0.2.3)

## [0.2.2] - 2026-08-04

- Documented the common branch, pull-request, staged, unstaged, and working-tree review scopes.

[Full changelog](https://github.com/mtford90/revue/compare/v0.2.1...v0.2.2)

## [0.2.1] - 2026-08-04

- Updated the guide and bundled skill for flat diffs, ignore rules, themes, context expansion, review threads, and path display modes.

[Full changelog](https://github.com/mtford90/revue/compare/v0.2.0...v0.2.1)

## [0.2.0] - 2026-08-04

- Added an all-review Comments surface with open-thread counts and direct navigation.
- Added persistent Ayu themes, focused-file display, and flat file-by-file reviews when chapters are absent.
- Added expandable unchanged context, semantic-view selection and copy support, and richer inline review threads.
- Improved the responsive review shell, navigation hints, status bar, and smart, tree, and full path display modes.

[Full changelog](https://github.com/mtford90/revue/compare/v0.1.1...v0.2.0)

## [0.1.1] - 2026-08-03

- Renamed the bundled skill to `revue` and added direct GitHub pull-request review support.
- Made Homebrew the primary installation path in the documentation.

[Full changelog](https://github.com/mtford90/revue/compare/v0.1.0...v0.1.1)

## [0.1.0] - 2026-08-03

- Introduced terminal-native narrated code review with chapters, review progress, and responsive diff navigation.
- Added immutable prepared review runs, Git scope selection, ignore rules, Markdown export, and a semantic diff view.
- Added authored inline review threads, selection and copy actions, selectable contrast-aware themes, and agent skill installation.
- Added precompiled macOS and Linux release binaries with smoke tests and bundled licence notices.

[Release commits](https://github.com/mtford90/revue/commits/v0.1.0)
