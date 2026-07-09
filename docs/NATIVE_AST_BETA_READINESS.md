# Native AST Beta Readiness

This report records the beta gate for `experimental.indexer.nativeAst`. It is a
release-readiness artifact, not a default-switch approval. Rust/Oxc is now the
only bundled first-party static path, and the beta gate checks it against the
Rust-owned golden plus Go host behavior.

## Status

Native AST is beta-ready behind `experimental.indexer.nativeAst` when the gate in
this file is green on the release candidate. It must not become the default
without completing the default-readiness checklist below and getting explicit
approval for that switch.

## Current Evidence

Last Phase 5 verification run: 2026-07-07.

```bash
node scripts/native-ast-parity-gate.mjs
```

Observed gate coverage:

| Surface                         | Evidence                                                                                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust worker build               | `cargo build --package crux-static-index-worker --bin crux-static-index-worker` passed.                                                                                                         |
| Rust tests                      | `cargo test` passed, including `static-compiler` 68 tests, `worker` 19 tests, `syntax-oxc` 8 tests, and doc tests.                                                                              |
| Rust first-party golden         | `rust-first-party-static-golden.test.ts` compares Rust/Oxc output with `contracts/fixtures/rust-first-party-static-golden.json`.                                                                |
| Full indexer suite              | `CRUX_STATIC_INDEX_WORKER=target/debug/crux-static-index-worker pnpm --filter @use-crux/indexer test` passed with 73 files, 330 tests, and 1 skipped env-gated test.                            |
| Go production path              | `go test ./internal/projectindex/... -count=1` passed from `packages/local` with the built Rust worker and embedded local worker bundle.                                                         |
| Local worker embed path         | The gate built `@use-crux/local-workers`, embedded the generated worker assets, and then ran the Go Project Index packages against those assets.                                                  |

`pnpm test:native-ast-parity` is the release command because it builds the
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
- TypeScript extension host coverage remains for third-party extensions with a
  TS-authored extractor, a TS-authored lint rule, and mixed native plus
  extension output.
- Warm cache, incremental source edits, config/lint-profile fallback, static
  cache identity, and the non-skipping CI parity command are covered.

## Cache Identity Review

The static output contract changed during stable-beta hardening, so the static
cache namespace is `static-parse-v53`. Go Static Index cache replay is pinned to
the same namespace through the shared fixture. Semantic facts use
`semantic-facts-v21`, and the Go Project Index snapshot cache lives under
`.crux/cache/index-v2/epoch-27/` so restart warm loads cannot mask renamed or
schema-shifted read-model output.

`nativeAst` is the static AST/source frontend experiment and remains independent
from `experimental.indexer.native`, which selects the semantic backend.

## Release Checklist

Run these before announcing or releasing the beta:

```bash
node scripts/native-ast-parity-gate.mjs
make local
```

The release shortcut is:

```bash
pnpm test:native-ast-parity
make local
```

`make local` must build the local worker bundles and devtools UI, embed them into
`packages/local/internal/assets/{embed,ui-embed}`, build the current-platform
Rust/Oxc indexer worker, and build the current-platform Go binary.

## Benchmark Command

Use the benchmark runner when collecting beta soak or default-promotion
performance evidence:

```bash
pnpm benchmark:native-ast
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
CRUX_INDEXER_BENCH_ROOT=/path/to/project pnpm benchmark:native-ast
CRUX_INDEXER_BENCH_MODES=production-cold,production-warm pnpm benchmark:native-ast
CRUX_INDEXER_BENCH_TIER_A_MS=100 pnpm benchmark:native-ast
CRUX_INDEXER_BENCH_COUNT=5 CRUX_INDEXER_BENCH_BENCHTIME=10s pnpm benchmark:native-ast
```

Archive the raw Go benchmark output and compare runs with `benchstat` when
possible. Default promotion still needs a material end-to-end native win, with
at least a `2x` cold-indexing target on release corpora.

## Known Residual Risks

- The current gate proves correctness parity, not a final performance target.
  Preserve prior benchmark expectations before default promotion: native-only
  cold indexing should show a material end-to-end win, with at least a `2x`
  target on release corpora.
- TypeScript extension compatibility is covered by a production fixture, but
  broader ecosystem coverage should expand during beta soak as real extensions
  appear.
- Fallback or Node-start diagnostics must stay legible. Node may still start for
  config inspection and TypeScript-authored extension work; native-only eligible
  projects should not pay for first-party TypeScript projection.
- Cache incidents should be monitored during beta. Users should not need to
  delete `.crux/cache` after normal cache identity migrations.

## Default-readiness checklist

Do not make native AST the default until all of these are true:

- [ ] The beta gate stays green across multiple CI cycles or releases.
- [ ] `make local` and `pnpm test:native-ast-parity` are required in the release
      checklist for any native AST promotion.
- [ ] Cold and warm benchmarks meet the documented performance thresholds on the
      Crux repo and at least one large synthetic corpus.
- [ ] Telemetry reports bounded fallback and Node-start reasons, including
      config inspection, TypeScript extension extractor work, TypeScript
      extension lint work, and native worker setup failures.
- [ ] Extension ecosystem tests include more than the fixture extension and cover
      package-version/trust diagnostics.
- [ ] Cache identity monitoring confirms stale snapshots do not mask changed
      static Project Index output.
- [ ] User-facing docs describe rollback clearly: set
      `experimental.indexer.nativeAst` to `false` or remove the flag.
