# Revuediff performance harness

Run the first-party benchmark from a checkout:

```bash
bun run perf:revuediff
bun run perf:revuediff -- --compare
bun run perf:revuediff -- --stages
bun run perf:revuediff -- --json artifacts/revuediff-perf.json
```

The default uses 15 measured repetitions and three warmups; every run is a fresh process. It first
compiles `packages/revuediff/src/main.ts` with `bun build --compile`, then measures that executable,
not `bun run` or an internal formatter. Use `-n 3 --warmups 1` for a quick local smoke run.
Aspirational timing targets are printed but never gate the command. Harness integrity failures,
failed output validation, failed samples, and timeouts do gate it.

## Scenario integrity and validation

Formatted scenarios begin as deterministic pre/post source trees. The generator derives complete
unified patches from those contents: one TypeScript file for tiny, ten mixed TypeScript/Python/JSON/
CSS files for medium, and fifty mixed long-line files for large. Every formatted fixture contains
real additions and deletions. Narrow (60-column stack), normal (100/120-column split and wrapping),
and wide (160-column split) variants exercise changed rows, syntax highlighting, wrapping, and both
geometries.

Before compiling timings are accepted, each patch must:

1. pass `git apply --check` against its exact pre-image in a temporary Git repository;
2. apply to produce the exact declared post-image; and
3. pass Revuediff's classifier/parser with the expected non-zero changed-row stats and file count.

The compiled executable is then run once per scenario before warmups. `Scenario.expect` verifies
exit zero and the observable contract: formatted cases contain ANSI formatting, file identities, and
changed-row semantics rather than passthrough; unsupported input is exactly sanitised without ANSI;
and help contains the expected usage. Only scenarios that pass this validation are timed.

## Collection and failures

TTFB is elapsed time until stdout's first byte; total is process duration. Revuediff deliberately
buffers complete input and formatted output, so TTFB should closely track total latency. The collector
writes stdin while draining stdout and stderr, preventing full-pipe deadlocks. At the hard deadline it
signals the detached POSIX process group with SIGTERM, waits a bounded grace period, then sends
SIGKILL and returns after a second bound. This covers descendants on macOS and Linux; a timeout stays
a failed sample even if the process handles SIGTERM by exiting zero.

Every sample records its own stdin bytes. `inputThroughputBytesPerSecondP50` is the nearest-rank p50
of `input bytes / sample duration`; `outputThroughputBytesPerSecondP50` is explicitly named and
calculated separately. Warmup and measured sample failures both make the harness exit nonzero.
Infrastructure and output-contract failures do too. Timing target misses remain informational.

## Stage diagnostics

`--stages` is diagnostic only and uses public workspace boundaries without production
instrumentation. Stages run serially in this documented order, never under `Promise.all`:
classification, first syntax preparation, freshly parsed warmed syntax preparation, then formatting.
The first syntax pass is labelled `cold-shiki-startup`; later first passes are labelled
`warmed-shiki-runtime`, and every scenario also reports a warmed pass. Formatting uses each
scenario's requested width and production layout selection. Setup between measured stages is not
included, so stage values are independent diagnostics rather than an additive wall-clock budget.

## Comparators

`--compare` detects optional tools without failing when absent and captures their versions.

- **Delta** receives the exact same deterministic patch over stdin with paging/user Git config and
  configured features disabled, at the same requested width. Delta's own syntax engine and default
  theme remain enabled. The report explicitly labels that highlighting and presentation work as
  different rather than implying visual equivalence.
- **Difftastic** receives no patch-in-a-file surrogate. For every formatted scenario, the harness
  commits its exact pre-image file tree, writes the exact post-image tree, and invokes
  `GIT_EXTERNAL_DIFF=difft git diff --ext-diff --no-renames`. This is Difftastic's real Git
  external-diff contract. Its process stdin is zero bytes and its structural output is not a pager
  throughput equivalent; the report labels those differences.

`cat` over the medium stdin is only a process/copy baseline and is likewise not a formatter.

## JSON reports

Reports use stable `schemaVersion: 2`; the maintained schema is
[`revuediff-report.schema.json`](revuediff-report.schema.json). A normal report includes:

- scenario arguments, expectations, timeout, repetitions, and warmups;
- input byte count and SHA-256 plus source-tree file count, changed-row stats, paths, size, and digest;
- source Git revision and dirty state;
- compiled binary SHA-256 and reported Revuediff version, without its random temporary path;
- OS/platform/architecture, Bun and Git versions, and comparator versions or explicit skips;
- output validation results, raw measured/warmup samples, distributions, and distinct input/output
  throughput;
- comparator contracts/feature differences and serial stage geometry/cache labels when requested.

Compare reports by schema version, source/binary identity, scenario input hash and arguments,
platform/tool versions, timeout, repetition count, and distributions. Do not treat one noisy sample
as a regression. When `--json` is requested the harness writes a failed report for correctness/sample
failures and, when possible, for earlier infrastructure failures so CI can upload useful diagnostics.
Temporary repository and executable paths are deliberately excluded.

Targets are aspirational and non-gating: tiny TTFB p50 <=75 ms, tiny p95 <=100 ms, medium p50 <=200
ms, and no >20% large regression after a baseline is recorded. Do not use this harness to alter
renderer buffering or optimise production behaviour without a separate change.
