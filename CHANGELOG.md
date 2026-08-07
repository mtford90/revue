# Changelog

All notable changes to Revue are documented here. Release notes are grouped from the commits between adjacent release tags.

## [0.5.1](https://github.com/mtford90/revue/compare/v0.5.0...v0.5.1) (2026-08-07)


### Bug Fixes

* **tui:** reach the Comments surface without a narrative ([98f4861](https://github.com/mtford90/revue/commit/98f48614159610b61cb0078317762d24c92da329))

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
