# Changelog

All notable changes to Revue are documented here. Release notes are grouped from the commits between adjacent release tags.

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
