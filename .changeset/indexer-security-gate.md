---
"@use-crux/core": patch
"@use-crux/indexer": minor
"@use-crux/local": patch
---

Harden indexer untrusted-input handling: source-only static syntax planning no longer imports project config, extension loading verifies resolved package identity and containment before import, and source-map disk reads are contained to the project root.

Preserve semantic source-profile completeness across worker streams so incomplete profiles are not reused through the semantic facts cache, and split Project Index worker transport limits so multi-line fact/artifact streams can exceed the per-line cap without failing.

Harden Project Index correctness and determinism across patch merging, native/static syntax parity, record-lane extraction, stale provided-record handling, extension diagnostics, and rejected cache reads so cached, incremental, and native-backed runs preserve the same read-model facts.

Improve Project Index watch latency and live updates with lower save-path debounce windows, exported-interface source hashes that stop body-only edits from cascading to dependents, per-file WebSocket index deltas, cancellable background semantic waves, and watch-run fallback/status telemetry in local devtools. Source rows now include source and interface hash evidence so incremental planning can safely preserve single-file leaf edits across restarts.

Freeze the indexer stable-beta public surface: `ExtractContext` and extension manifest authoring types now have type-level guards, root syntax-record projection options no longer expose host-only worker controls, host static-index helpers carry those controls through explicit `ForHost` APIs, runtime `use` target matching is data-driven, and docs now mark root/testing/source-resolver/contracts as stable-beta surfaces while keeping extensions experimental and host subpaths Crux-owned.

Finish stable-beta indexer housekeeping: bump the static, semantic, and Go Project Index cache epochs, store Go snapshot fact caches under epoch-specific directories, align Crux Indexer and Project Index terminology/config docs, and promote the documented stable-beta Index Lint rule set while keeping the remaining rules preview.

Improve the Rust/Oxc static syntax frontend with `oxc_semantic`-backed scope visibility so match-local initializer resolution respects declaration order and nested shadowing instead of leaking later same-scope bindings. Import-qualified call interests now also resolve through Oxc symbol references so local shadowing cannot be misclassified as a first-party import call. Function return records now resolve direct identifier returns through Oxc binding evidence at record-production time, and the static parse cache epoch is bumped to `static-parse-v53` for the output change.

Add first-party static golden checks so Rust/Oxc output is compared against the captured TypeScript baseline before the Rust-default cutover, and scale the local Rust/Oxc static-index worker pool default to `GOMAXPROCS` while preserving `CRUX_STATIC_INDEX_WORKER_POOL_SIZE` as the explicit tuning override.

Retire the legacy TypeScript AST first-party static parser internals now that the production extraction engine runs through syntax records; the TypeScript syntax-record frontend and bridge remain available for host, test, and extension compatibility.

Make root/host `createStaticExtraction()` require an explicit syntax frontend, while keeping the TypeScript syntax-record producer as the documented `/testing` fixture default. Fixture traces now report the syntax producer identity used for the run.

Ship Crux Local platform packages with an enforced Rust/Oxc static-index worker sibling: staged release validation now rejects platform tarballs that omit `bin/crux-static-index-worker` or carry mismatched `os`/`cpu` metadata.

Run semantic enrichment as shard-local work when the Project Index source graph proves complete shard and dependency evidence. Crux Local now fans semantic requests across a lazy worker pool and merges shard semantic patches without invalidating AST/source facts.

Move Crux Local incremental watch reindexing onto the production Go to Rust/Oxc Static Index compiler path, with the TypeScript incremental worker retained only as fallback. The production watch benchmark now enforces the Tier-A leaf p95 budget on the shipping path.

Keep source/interface hash evidence consistent across TypeScript and Rust/Oxc static records, including constructor signatures, and bump the static parse cache epoch to refresh stale source-row cache entries.

Tighten Project Index transport contracts by keeping WebSocket index messages and Rust source snippets on typed payload shapes instead of untyped JSON values.

Prefer the packaged Rust/Oxc static-index worker for `/testing` fixture extraction when the matching platform package is resolvable, while retaining the TypeScript syntax-record producer as the documented compatibility fallback.
