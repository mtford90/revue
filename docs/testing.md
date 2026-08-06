# Testing

Tests exist to protect behaviour that matters, not to reward activity or maximise a coverage number.
A small suite with clear failure signals is better than a large suite of brittle, repetitive tests.

## The value test

A test earns its place when all of these are true:

1. It protects a plausible regression in user-visible behaviour, a public contract, or a load-bearing invariant.
2. It exercises the behaviour through the narrowest realistic boundary.
3. It would fail for a useful reason if the behaviour broke.
4. It is deterministic, isolated, and cheaper to maintain than repeatedly checking the behaviour by hand.
5. It adds confidence not already provided by another test.

If a test cannot meet this bar, do not add it. Delete tests that no longer provide unique confidence.

## Choose the right level

Prefer the level that gives realistic confidence with the least machinery.

### Unit tests

Use unit tests for pure transformations and state transitions with meaningful branching, such as:

- chapter and review-state transitions;
- hunk, row, line-range, and anchor mapping;
- parsing and validation rules whose failure behaviour matters;
- deterministic formatting.

Do not extract trivial helpers merely to make them unit-testable. Do not test getters, constants, library behaviour, or TypeScript's type system.

### Component integration tests

This is the default level for Revue's TUI. Render the component and interact through the same inputs a reviewer uses: keys, pointer events, resizing, and supplied files. Assert the resulting rendered meaning and state changes.

One integration test may make several assertions when they describe one coherent behaviour. Splitting every assertion into a separate test creates setup noise without adding confidence.

### Process integration and end-to-end tests

Use real processes, pseudo-terminals, and temporary directories only for behaviour that depends on those boundaries, including:

- CLI arguments, output, exit codes, and error handling;
- terminal setup and restoration;
- persisted state across process runs;
- external diff-tool invocation.

Keep this layer small. It is slower and more environment-sensitive than component integration tests.

### Manual checks

Use manual checks for visual judgement, colour quality, terminal compatibility, and exploratory pointer behaviour. Automate a manual check only when it represents a stable contract and has regressed or is likely to regress.

## Test behaviour, not implementation

Assert what a reviewer or caller can observe. Avoid assertions about private state, internal component structure, hook call order, or incidental function calls.

Mock only genuine boundaries, such as clocks, subprocesses, or unavailable external services. Prefer real pure collaborators, real temporary files, and public inputs over mocks of Revue's own modules.

A refactor that preserves behaviour should not require broad test rewrites.

## TUI tests

- Drive OpenTUI through `mockInput`, `mockMouse`, and resize facilities rather than calling component internals.
- Wrap every interaction that can update React state in `act()` and treat `act()` warnings as test failures to fix.
- Assert distinctive text, selection markers, state callbacks, or the absence of an unwanted side effect.
- Derive pointer coordinates from rendered content where possible. Hard-coded coordinates are acceptable only when layout geometry is the contract.
- Avoid full-screen snapshots. A small focused golden output is acceptable when the complete formatted output is itself the contract.
- Test one representative shortcut per shared action. Test aliases only when key routing or terminal encoding gives them distinct failure modes.
- Keep narrow-terminal, split/stack, and panel-boundary tests focused on the layout decision, not every rendered character.

## Diff-renderer tests

When Revue owns renderer behaviour, cover it with a small set of named patch fixtures spanning materially different structures: additions, deletions, multiple hunks, renames, and absent context. Until then, test Revue's adapter and presentation contract with real patches rather than retesting Hunk or Pierre.

- Unit-test owned old/new line mapping, exact inclusive ranges, multi-anchor key changes, and selection normalisation.
- Integration-test visible decorations, focus, scrolling, and multi-line selection against those mappings.
- If Revue vendors bounded Hunk code, maintain parity tests at Revue's public renderer boundary rather than copying Hunk's private tests wholesale.
- When Revue owns language inference, test it by path and fallback behaviour; do not snapshot large ANSI or syntax-token streams.
- Expected values must not reimplement the production algorithm inside the test.

## Diff golden snapshots

The rendered diff frame is itself a contract: intra-line emphasis, wrapping, gutters, and
column widths are all invisible to a test that only reads characters. `packages/diff-renderer/test/golden.test.tsx`
renders curated patches headless and compares the whole frame against committed goldens in
`packages/diff-renderer/test/__goldens__/`.

What the suite covers:

- one scenario per rendering family — single-character and word edits, multi-edit lines,
  unequal-count blocks, whitespace-only changes, unicode (emoji, CJK, combining marks),
  long-line wrap with an emphasis run crossing the wrap point, wrapped wide characters,
  a moved block, and blank-line handling;
- each scenario in both split and stack layouts at two widths, the wrap scenarios at widths
  narrow enough to force wrapping;
- the fixed `ayu-dark` theme with syntax highlighting deliberately left unprepared, because
  highlighting is asynchronous and grammar-dependent and would make goldens flaky.

A golden holds the character grid with trailing spaces trimmed, then a per-row style map of
column runs as `cols fg=#rrggbb bg=#rrggbb [attributes]`. Style columns are terminal columns,
so a wide glyph spans two. Colours and attributes are part of the snapshot: a background or
bold change fails the suite even when every character is unchanged.

A failure prints an elided unified diff of golden against rendering, where `-` is the
committed golden and `+` is what the code now produces, followed by the re-bless command.

Re-bless only when the new rendering is the intended one, then read the resulting diff as a
review of the change:

```bash
bun run goldens:update
```

Goldens are checked-in fixtures, never generated at test time from a repository or `git`
invocation. Add a scenario to `test/goldens/scenarios.ts` when a new rendering family earns
protection; keep each patch small enough that its frame stays readable in a diff.

## What runs where

`.github/workflows/ci.yml` runs typecheck, lint, and the whole suite on every push to `master`
and every pull request, so the goldens gate a change rather than only a release. The release
workflow repeats them per target platform before it builds an executable.

Screenshots are not part of either. They serve visual judgement, which no assertion replaces, and
they need vhs, ffmpeg, and a macOS-bundled font; the goldens are the automated contract.

## Regression tests

For a bug fix:

1. Add the smallest test that reproduces the reported behaviour.
2. Run it and confirm it fails for the expected reason.
3. Apply the fix.
4. Run it again and confirm it passes.
5. Keep the test only if it protects against a realistic recurrence.

A regression test should describe the broken contract, not the implementation mistake.

## Fixtures, timing, and isolation

- Keep fixtures minimal but structurally realistic. Name them by the scenario they represent.
- Share builders for irrelevant setup, not for the values under assertion.
- Use a fresh temporary directory for filesystem tests and clean it in `finally` or lifecycle teardown.
- Avoid arbitrary sleeps. Prefer observable readiness; where a pseudo-terminal makes a delay unavoidable, keep it bounded and document the boundary in the test name or setup.
- Do not depend on test order, the developer's repository state, network access, or global persisted state.

## Coverage

Coverage is a diagnostic for finding important untested paths, not a quality target. Revue has no required line or branch percentage.

Do not add assertions solely to increase coverage. Review uncovered code by risk: an untested error path that can corrupt review state matters more than a covered presentational branch.

Remember that Bun's coverage report includes only modules loaded by the test run; a high aggregate can omit entire entry points.

## Review checklist

Before accepting a test, ask:

- What specific regression does this catch?
- Is this the most realistic inexpensive boundary?
- Does another test already provide the same confidence?
- Would the failure message identify the broken contract?
- Is the test deterministic and independent?
- Can production internals be refactored without rewriting it?
- Is any mock hiding the integration we actually care about?
- Is the maintenance cost proportionate to the risk?

## Commands

Run all three after changing the codebase:

```bash
bun run typecheck
bun run lint
bun test
```

Use `bun test --coverage` for diagnosis, never as a target to optimise.
