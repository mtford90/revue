# Changelog

## [0.3.0](https://github.com/mtford90/revue/compare/revuediff-v0.2.0...revuediff-v0.3.0) (2026-08-20)


### Features

* draw mermaid flowcharts as ascii instead of showing their source ([3ed73ed](https://github.com/mtford90/revue/commit/3ed73ed601a75f74ed6628fb2ad99c2f9b44186e))
* rename the Story and Files surfaces to Narrative and Diff ([50f8220](https://github.com/mtford90/revue/commit/50f8220e60da028ee53ce1a65bc528adc26e9723))


### Bug Fixes

* ignore the untracked .scratch planning tree and refresh release route markers ([f34d036](https://github.com/mtford90/revue/commit/f34d036fa423c7fac450383a4c114e4479ccdb86))
* make chapter index height responsive ([e05a2ee](https://github.com/mtford90/revue/commit/e05a2eee9b4bb59a5649a80e5bea8b3789ef3cf5))
* widen the drawn mermaid subset and stop a stale label winning ([2416ad6](https://github.com/mtford90/revue/commit/2416ad6e50074d1fac0476bdbe664809984e5c6e))

## [0.2.0](https://github.com/mtford90/revue/compare/revuediff-v0.1.2...revuediff-v0.2.0) (2026-08-08)


### Features

* add a reload action to the TUI ([9869e01](https://github.com/mtford90/revue/commit/9869e01741e771dabb2fff2e54a96906bfc73b3a))
* carry review marks through a reload, minus the files that moved ([b8500b7](https://github.com/mtford90/revue/commit/b8500b76275681fa507e4972a21ed4f06083a05c))
* carry review marks through a reload, minus the files that moved ([5521260](https://github.com/mtford90/revue/commit/55212603cc43c4fa17bcd2251a075d3e162f1ab5))
* choose a light theme and a dark theme, and follow the terminal ([e95fb0b](https://github.com/mtford90/revue/commit/e95fb0be9249ed86352028162ef33cdc64d89d85))
* **diff:** colour quoted excerpt lines ([5fcd0b2](https://github.com/mtford90/revue/commit/5fcd0b23bfcc1a500d476a3ef83d17320bc58ad4))
* **diff:** make excerpt gutters live like a diff line's ([518b17a](https://github.com/mtford90/revue/commit/518b17a3d98b73f34cf5d4193f50d248383ce0dc))
* **diff:** plan and render context excerpt blocks ([a8f73ad](https://github.com/mtford90/revue/commit/a8f73adf9a751eeb26ed98cfdff1a42baaf5a85b))
* **diff:** plan and render diagram blocks ([a7f179e](https://github.com/mtford90/revue/commit/a7f179e954d925c275061a0f3420c9caf8f70bb6))
* narrative depth, context excerpts, and interludes ([40adb25](https://github.com/mtford90/revue/commit/40adb2500ef2d3dd8952c3a0ae5af838192ad69c))
* widen the default keymap and replace the shortcut overlay with a keys surface ([a401e1e](https://github.com/mtford90/revue/commit/a401e1ede87b43c310ee2cd03feb322e26bf2063))


### Bug Fixes

* **diff:** reserve the sign slot for excerpt and diagram blocks ([96c732f](https://github.com/mtford90/revue/commit/96c732f9f6d58a927741ada6e10f9f934f31f12e))

## [0.1.2](https://github.com/mtford90/revue/compare/revuediff-v0.1.1...revuediff-v0.1.2) (2026-08-07)


### Bug Fixes

* unblock release builds after version bumps ([6d1d599](https://github.com/mtford90/revue/commit/6d1d59980a2ba1877a8e5e8180bcf369fef983b4))

## [0.1.1](https://github.com/mtford90/revue/compare/revuediff-v0.1.0...revuediff-v0.1.1) (2026-08-07)


### Bug Fixes

* avoid pager signal-test race during stdin write ([3d9c55b](https://github.com/mtford90/revue/commit/3d9c55bbb46435e54f97c80ed99e1d3b7d4cc2c8))
* build native highlighter before CI tests ([f50eb60](https://github.com/mtford90/revue/commit/f50eb60afc2934f02e8527eb745738148171cecc))
* install pager signal traps before readiness ([0e2318a](https://github.com/mtford90/revue/commit/0e2318a5f438e17a141c523ff2ddd06df072974d))
* keep pager signal traps on the spawned shell ([5c535f1](https://github.com/mtford90/revue/commit/5c535f1e59585943e7b13fdf3faa575d108b3e0f))
* prefer ignored paths in release routing ([cf9304d](https://github.com/mtford90/revue/commit/cf9304d6a39d33b30ccb7ba5f26607628e94f4dc))
* stop pinning release versions in route tests ([24b5180](https://github.com/mtford90/revue/commit/24b5180e5d6f9920db2f76b2fc239ee1907e6d77))

## 0.1.0 (2026-08-07)


### Features

* add local revuediff demo harness ([461fbe7](https://github.com/mtford90/revue/commit/461fbe7a797023e5df5fdbc57fca6a3c05815725))
* add native Syntect syntax highlighting ([11edb4e](https://github.com/mtford90/revue/commit/11edb4e6909ac930657c1edf152a336466c9670b))
* add Revuediff performance benchmark harness ([4538fb8](https://github.com/mtford90/revue/commit/4538fb8828d6e97b16dc8a472353f360d48a4fa8))
* configure diff chrome and revuediff ([a5e6f71](https://github.com/mtford90/revue/commit/a5e6f71c0e35c1138ebb795dfe807436adb28c78))
* separate revuediff as a standalone product ([b6f49e9](https://github.com/mtford90/revue/commit/b6f49e9cf4ac22084c182aaf959bbcdee7e59a26))


### Bug Fixes

* correct Revuediff performance harness ([5d00447](https://github.com/mtford90/revue/commit/5d00447a0bbf04dd85a931ea79a9234f01280cbe))
* enforce revuediff report status semantics ([9ab1d99](https://github.com/mtford90/revue/commit/9ab1d99cc2f357c7b20c34893f177d1ecb2ce052))
* isolate native highlighter addon lookup ([94f8744](https://github.com/mtford90/revue/commit/94f87448f0193bda3bbda618e6c1c81bc921d4fe))
* preserve native syntax fallback rendering ([a7bbda3](https://github.com/mtford90/revue/commit/a7bbda3d5d008ad66766a25fd5acf4a3746729f9))
* separate stacked ANSI line-number gutters ([6223cbf](https://github.com/mtford90/revue/commit/6223cbf20944cc60eafd790d1752dc869cb800e8))
* tighten performance report schema ([adeeef2](https://github.com/mtford90/revue/commit/adeeef2dc67959f91322018594b256ce4d53dc1e))
* type revuediff schema test reports ([f4f7a8a](https://github.com/mtford90/revue/commit/f4f7a8ad4bcc423234d5b2ac12d926ac698c7eae))


### Performance Improvements

* defer Revuediff Shiki fallback ([5dc46df](https://github.com/mtford90/revue/commit/5dc46df70a07a644ed7df324f6534354eb06ded3))
* narrow Revuediff theme startup ([15a2fdc](https://github.com/mtford90/revue/commit/15a2fdce8c7cefd3bf3b8813908933991e72f234))
