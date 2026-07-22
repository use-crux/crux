# Static Index Readiness

This report records the release gate for the required Rust/Oxc Static Index
path. Rust/Oxc is the only bundled first-party static compiler, and the gate
checks it against the Rust-owned golden plus Go host behavior.

## Status

Static Index is release-ready when the gate in this file is green on the release
candidate. A missing or incompatible worker is a setup failure; Crux must not
publish an apparently healthy empty Project Index.

## Current Evidence

Last release-gate verification run: 2026-07-21.

```bash
node scripts/static-index-parity-gate.mjs
```

Observed gate coverage:

| Surface                 | Evidence                                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust worker build       | `cargo build --package crux-static-index-worker --bin crux-static-index-worker` passed.                                                                     |
| Rust tests              | `cargo test` passed, including `static-compiler` 73 tests, `worker` 20 tests, `syntax-oxc` 8 tests, and doc tests.                                          |
| Rust first-party golden | `rust-first-party-static-golden.test.ts` compares Rust/Oxc output with `contracts/fixtures/rust-first-party-static-golden.json`.                            |
| Full indexer suite      | `CRUX_STATIC_INDEX_WORKER=target/debug/crux-static-index-worker pnpm --filter @use-crux/indexer test` passed with 105 files, 494 tests, and 1 skipped test. |
| Go production path      | `go test ./internal/projectindex/... -count=1` passed from `packages/local` with the built Rust worker and embedded local worker bundle.                    |
| Local worker embed path | The gate built `@use-crux/local-workers`, embedded the generated worker assets, and then ran the Go Project Index packages against those assets.            |

`pnpm test:static-index-parity` is the release command because it builds the
current Rust/Oxc worker, points every worker-backed test at that binary, compares
Rust output with the Rust-owned golden, builds and embeds the TypeScript worker
assets that remain for extension/config/semantic host work, and runs the Go host
packages with required gate environment.

## Coverage

- Built-in lint rules are described from the Rust-owned descriptor fixture and
  evaluated by the Rust `crates/lints` implementation. TypeScript no longer
  contains a bundled first-party lint evaluator.
- First-party extractor families are Rust-only in the binary and verified
  against the Rust-owned static golden across definitions, relations, source
  refs, diagnostics, dependencies, source rows/source graph, runtime metadata,
  degraded behavior, and provided records where present.
- TypeScript extension host coverage remains for an experimental third-party
  extractor and mixed Rust plus extension output. Internal rule-slot fixtures
  do not constitute a public third-party rule promise.
- Warm cache, incremental source edits, config/lint-profile fallback, static
  cache identity, and the non-skipping CI parity command are covered.

## Cache Identity Review

The current static cache namespace is `static-parse-v75`; semantic facts use
`semantic-facts-v32`; and the Go Project Index snapshot cache lives under
`.crux/cache/index-v2/epoch-45/`. These identities include unconditional
Rust/Oxc scheduling, retained lint suppression evidence, Workspace snapshot
usage relations, root-stable fingerprints, backend state, and durable all-kind
extractor provenance, so restart warm loads cannot mask changed Catalog
evidence.

Static Index always uses Rust/Oxc and remains independent from
`experimental.indexer.native`, which selects the semantic backend.

## Release Checklist

Run these before releasing:

```bash
node scripts/static-index-parity-gate.mjs
make local
```

The release shortcut is:

```bash
pnpm test:static-index-parity
make local
```

`make local` must build the local worker bundles and devtools UI, embed them into
`packages/local/internal/assets/{embed,ui-embed}`, build the current-platform
Rust/Oxc indexer worker, and build the current-platform Go binary.

## Benchmark Command

Use the benchmark runner when collecting performance evidence:

```bash
pnpm benchmark:static-index
```

By default it benchmarks this repository through the production Go to Rust/Oxc
Static Index path with cold and warm runs. It builds the release Rust/Oxc
worker, refreshes the embedded TypeScript worker assets used by the Go host,
and invokes the production Go Project Index benchmark entrypoints with
`CRUX_INDEXER_BENCH_ROOT` and `CRUX_STATIC_INDEX_WORKER` set. The default
benchmark set includes the full AST patch path, the full graph pipeline, and
the Tier-A watch leaf path, which fails when p95 exceeds `100ms` unless
`CRUX_INDEXER_BENCH_SKIP_TIER_A_GATE=1` is set.

Useful overrides:

```bash
CRUX_INDEXER_BENCH_ROOT=/path/to/project pnpm benchmark:static-index
CRUX_INDEXER_BENCH_MODES=production-cold,production-warm pnpm benchmark:static-index
CRUX_INDEXER_BENCH_TIER_A_MS=100 pnpm benchmark:static-index
CRUX_INDEXER_BENCH_COUNT=5 CRUX_INDEXER_BENCH_BENCHTIME=10s pnpm benchmark:static-index
```

Archive the raw Go benchmark output and compare runs with `benchstat` when
possible. Default promotion still needs a material end-to-end native win, with
at least a `2x` cold-indexing target on release corpora.

### Phase 9 one-shot baselines

Recorded 2026-07-15 on Linux/amd64 with an Intel i7-1360P, the release
Rust/Oxc worker, the production one-shot Go service, and exactly two iterations
per fixture. These are non-gating end-to-end context; the 100 ms Tier-A leaf
budget measures a different watch path.

| Fixture                | TypeScript files |     Cold |     Warm | Peak process-tree RSS |
| ---------------------- | ---------------: | -------: | -------: | --------------------: |
| Small manifest fixture |                3 | 435.8 ms | 85.49 ms |             184.3 MiB |
| Indexer package        |              430 |  1.701 s | 340.7 ms |             477.8 MiB |
| Crux repository        |            2,579 | 23.484 s |  6.036 s |             3,752 MiB |

Reproduce the same measurement shape with
`BenchmarkOneShotProjectIndexBaselines`, setting
`CRUX_INDEXER_BENCH_ROOT_SMALL`, `_MEDIUM`, and `_LARGE`, plus
`CRUX_STATIC_INDEX_WORKER`. Fixture contents and machine identity must accompany
future comparisons; these numbers are a baseline, not a cross-machine gate.

## Known Residual Risks

- The current gate proves correctness and integration, not a final performance
  target. Cold indexing should retain a material end-to-end win, with at least a
  `2x` target on release corpora.
- TypeScript extension compatibility is covered by a production fixture, but
  broader ecosystem coverage should expand as real extensions appear.
- Worker-setup and Node-start diagnostics must stay legible. Node may still start for
  config inspection and TypeScript-authored extension work; native-only eligible
  projects should not pay for first-party TypeScript projection.
- Cache incidents should be monitored. Users should not need to
  delete `.crux/cache` after normal cache identity migrations.
