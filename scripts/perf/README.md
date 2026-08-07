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

## Methodology and interpretation

Scenarios are deterministic generated unified patches: help/startup, unsupported sanitised
passthrough, a small LazyGit-like TypeScript diff, ten-file medium mixed input, fifty-file large
mixed input, and narrow stacked/wide split variants. Inputs and the compiled binary live in a unique
temporary directory and are removed afterwards. `cat` on the medium input is included to expose host
and process-startup noise.

TTFB is the elapsed time until stdout's first byte; total is process duration. Revuediff deliberately
buffers complete input and complete formatted output to safely classify input, prepare syntax, and
fail open, so its TTFB should closely track total latency. The collector drains stdout as it runs,
which avoids pipe deadlocks with the large scenario. Results include nearest-rank p50/p95, output
bytes, throughput, failure/timeout counts, and environment versions. JSON has `schemaVersion: 1`;
compare reports by matching scenario ids, executable/platform, repetition count, and p50/p95 rather
than treating a single noisy run as a regression.

`--stages` is diagnostic only. It times classification, syntax preparation, and ANSI planning/
formatting through the existing public workspace boundaries; production code has no benchmark
instrumentation. First syntax preparation can include Shiki setup, so read it separately from
end-to-end process numbers.

`--compare` detects optional tools without failing when absent. Delta receives the same stdin pager
fixtures (with paging disabled). Difftastic is measured through a deterministic temporary Git repo
and `git diff --ext-diff`/`GIT_EXTERNAL_DIFF=difft`; that is its real external-diff contract, not an
equivalent stdin pager comparison.

Targets are aspirational and non-gating: tiny TTFB p50 <=75 ms, tiny p95 <=100 ms, medium p50 <=200
ms, and no >20% large regression after a baseline is recorded. Do not use this harness to alter
renderer buffering or optimise production behaviour without a separate change.
