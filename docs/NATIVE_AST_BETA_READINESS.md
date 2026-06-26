# Native AST Beta Readiness

This report records the beta gate for `experimental.indexer.nativeAst`. It is a
release-readiness artifact, not a default-switch approval. The TypeScript Static
Index path remains the correctness baseline, and Rust/Oxc earns beta status only
by exact normalized Project Index parity.

## Status

Native AST is beta-ready behind `experimental.indexer.nativeAst` when the gate in
this file is green on the release candidate. It must not become the default
without completing the default-readiness checklist below and getting explicit
approval for that switch.

## Current Evidence

Last Phase 7 verification run: 2026-06-27.

```bash
cargo build --package crux-indexer-worker --bin crux-indexer-worker
cargo test
CRUX_STATIC_INDEX_WORKER="$PWD/target/debug/crux-indexer-worker" pnpm --filter @use-crux/indexer test
CRUX_STATIC_INDEX_WORKER="$PWD/target/debug/crux-indexer-worker" pnpm --filter @use-crux/devtools parity:indexer-static -- --root="$PWD" --concurrency=8 --max-mismatches=20
(cd packages/local && CRUX_INDEXER_PARITY_ROOT="$(git rev-parse --show-toplevel)" CRUX_STATIC_INDEX_WORKER="$(git rev-parse --show-toplevel)/target/debug/crux-indexer-worker" go test ./internal/projectindex/host -run TestWorkerStaticIndexMatchesTypeScriptProductionPath -count=1 -v)
make local
```

Observed gate coverage:

| Surface                         | Evidence                                                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust worker build               | `cargo build --package crux-indexer-worker --bin crux-indexer-worker` passed.                                                                                                               |
| Rust tests                      | `cargo test` passed, including `static-compiler` 62 tests, `worker` 18 tests, `syntax-oxc` 1 test, and doc tests.                                                                           |
| Full indexer suite              | `CRUX_STATIC_INDEX_WORKER=target/debug/crux-indexer-worker pnpm --filter @use-crux/indexer test` passed with 87 files and 467 tests.                                                        |
| Repository static parity corpus | Devtools parity passed with `files=442 matched=442 canonicalMismatches=0 rawMismatches=30 errors=0`. Definitions, relations, and diagnostics matched exactly after canonical normalization. |
| Go production path              | `TestWorkerStaticIndexMatchesTypeScriptProductionPath` passed from `packages/local` with the built Rust worker.                                                                             |
| Local build path                | `make local` passed. It built devtools workers/UI, embedded assets, built the release Rust/Oxc worker, and built the Go `crux` binary.                                                      |
| Public docs                     | `pnpm --filter docs build` passed, including MDX generation, TypeScript, and 433 static pages.                                                                                              |

`pnpm test:native-ast-parity` is the release command because it builds the
current Rust/Oxc worker, points every worker-backed test at that binary, builds
and embeds the TypeScript worker assets for Go host tests, and sets
`CRUX_INDEXER_PARITY_REQUIRED=1` so env-gated parity cannot silently skip in CI.

## Coverage

- 29 built-in lint rules have full descriptor coverage and worker-backed
  TypeScript/Rust finding parity, including default/profile/config behavior,
  active suppressions, unused suppressions, unknown-rule diagnostics, and final
  production lint patch parity.
- 17 first-party extractor families have positive and negative native parity
  evidence across definitions, relations, source refs, diagnostics,
  dependencies, source rows/source graph, runtime metadata, degraded behavior,
  and provided records where present.
- TypeScript extension fallback is covered in the Go production path with a
  TS-authored extractor, a TS-authored lint rule, and mixed native plus
  extension output.
- Warm cache, incremental source edits, config/lint-profile fallback, static
  cache identity, and the non-skipping CI parity command are covered.

## Cache Identity Review

The static output contract changed during parity hardening, so the static cache
namespace is `static-parse-v39`. Go Static Index cache replay is pinned to the
same namespace through the shared fixture. The Go Project Index snapshot cache
epoch was bumped during earlier parity phases when changed read-model behavior
could have been hidden by an existing `.crux/cache/index/index.json`.

No semantic cache epoch change is part of this beta gate. `nativeAst` is the
static AST/source frontend experiment and is independent from
`experimental.indexer.native`.

## Release Checklist

Run these before announcing or releasing the beta:

```bash
cargo build --package crux-indexer-worker --bin crux-indexer-worker
cargo test
CRUX_STATIC_INDEX_WORKER="$PWD/target/debug/crux-indexer-worker" pnpm --filter @use-crux/indexer test
CRUX_STATIC_INDEX_WORKER="$PWD/target/debug/crux-indexer-worker" pnpm --filter @use-crux/devtools parity:indexer-static -- --root="$PWD" --concurrency=8 --max-mismatches=20
(cd packages/local && CRUX_INDEXER_PARITY_ROOT="$(git rev-parse --show-toplevel)" CRUX_STATIC_INDEX_WORKER="$(git rev-parse --show-toplevel)/target/debug/crux-indexer-worker" go test ./internal/projectindex/host -run TestWorkerStaticIndexMatchesTypeScriptProductionPath -count=1 -v)
make local
```

The release shortcut is:

```bash
pnpm test:native-ast-parity
make local
```

`make local` must build the devtools workers/UI, embed them into
`packages/local/internal/assets/{embed,ui-embed}`, build the current-platform
Rust/Oxc indexer worker, and build the current-platform Go binary.

## Benchmark Command

Use the benchmark runner when collecting beta soak or default-promotion
performance evidence:

```bash
pnpm benchmark:native-ast
```

By default it benchmarks this repository with cold and warm TypeScript baseline
runs plus cold and warm native AST runs. It builds the release Rust/Oxc worker,
refreshes the embedded TypeScript worker assets used by the Go host, and invokes
the existing Go Project Index benchmark entrypoints with
`CRUX_INDEXER_BENCH_ROOT` and `CRUX_STATIC_INDEX_WORKER` set.

Useful overrides:

```bash
CRUX_INDEXER_BENCH_ROOT=/path/to/project pnpm benchmark:native-ast
CRUX_INDEXER_BENCH_MODES=native-cold,native-warm pnpm benchmark:native-ast
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
