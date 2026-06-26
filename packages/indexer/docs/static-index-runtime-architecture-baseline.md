# Static Index Runtime Architecture Baseline

This is the current baseline for the Static Index runtime refactor. It records
the ownership and contract inventory after the TypeScript contract spine, Go
host split, and Rust Static Index compiler crate split.

The executable inventory lives in
`packages/indexer/__tests__/contract-inventory.ts`; this document explains the
same baseline for humans.

## Ownership Map

| Area | Owner | Owns | Must not own |
| --- | --- | --- | --- |
| `packages/core` | TypeScript SDK core | Durable Project Index data types, rule manifest types, provider-agnostic contracts | Provider SDKs, React, Convex, local runtime, indexer implementation |
| `packages/indexer` | TypeScript Project Index Compiler | Public indexer API, extension authoring API, worker schemas, static syntax ABI, semantic evidence contract, TypeScript correctness baseline, cache identity | Go process lifetime, local persistence, devtools quality enrichment, Rust/Oxc internals |
| `packages/local` | Go local runtime | CLI/server/TUI, worker supervision, cancellation, budgets, Project Index store/cache loading, snapshot state, devtools read models, HTTP/WebSocket routes | Public extension API, TypeScript compiler semantics, raw parser/checker APIs |
| `crates/protocol` | Rust native protocol mirror | Data-only worker, static syntax, and Static Index JSON ABI shapes | Parsing, fact projection, linting, process I/O |
| `crates/syntax-oxc` | Rust/Oxc syntax frontend | Oxc parsing into backend-neutral static syntax records | Static Index fact projection, linting, worker transport |
| `crates/facts` | Rust native fact model | Normalized Static Index fact structs shared by compiler finalization and lints | Worker transport, parsing, domain extraction |
| `crates/primitives` | Rust first-party primitive projection | Crux domain projection from static syntax evidence into Static Index fact packets | Compiler finalization, worker transport, lint filtering |
| `crates/lints` | Rust first-party lint application logic | Built-in fact-based lint findings and descriptor filtering over normalized facts | Parser/frontend behavior, relation/source finalization, worker transport |
| `crates/static-compiler` | Rust Static Index compiler | Static Index analysis, relation binding, finalization, patch-event projection, and parity fixtures | Process transport, public SDK contracts, Go orchestration, independent user-facing Project Index semantics |
| `crates/worker` | Rust native worker process adapter | JSON-lines process transport and method dispatch for static syntax and Static Index requests | Compiler finalization, primitive projection internals, public SDK contracts, Go orchestration |

The durable boundary is Project Index facts, semantic evidence, static syntax
records, and patch/event streams. Raw TypeScript AST nodes, Oxc AST nodes,
checker objects, parser arenas, and process pointers stay inside their owning
runtime.

## Target Responsibility Paths

The current implementation is already split across the target responsibility
areas below. Later phases may finish renames or add facades, but these paths
are the architecture names that new code should reinforce.

| Runtime | Responsibility paths |
| --- | --- |
| TypeScript Static Index | `packages/indexer/indexer/static-index/config`, `packages/indexer/indexer/static-index/plan`, `packages/indexer/indexer/static-index/protocol`, `packages/indexer/indexer/static-index/syntax`, `packages/indexer/indexer/static-index/extension-host`, `packages/indexer/indexer/static-index/compatibility/syntax-record-bridge` |
| Go Static Index | `packages/local/internal/projectindex/staticindex/session`, `packages/local/internal/projectindex/staticindex/planner`, `packages/local/internal/projectindex/staticindex/sourceprofile`, `packages/local/internal/projectindex/staticindex/cache`, `packages/local/internal/projectindex/staticindex/syntax`, `packages/local/internal/projectindex/staticindex/client`, `packages/local/internal/projectindex/staticindex/protocol`, `packages/local/internal/projectindex/staticindex/run` |
| Rust Static Index | `crates/protocol`, `crates/syntax-oxc`, `crates/facts`, `crates/primitives`, `crates/lints`, `crates/static-compiler`, `crates/worker` |

Go process supervision now lives under `internal/process/workerproc`, and
generated local runtime assets are owned by `packages/local/internal/assets`.
Route and devtools packages should consume Project Index through
`projectindex/service` and `projectindex/readmodel` rather than low-level cache,
host, wire, or Static Index internals.

## Contract Inventory

| Contract group | Current canonical TypeScript area | Current Go mirror | Current Rust mirror | Mirror status |
| --- | --- | --- | --- | --- |
| `worker-events` | `contracts/worker-events/schema.ts` plus `indexer/worker-protocol/*` implementation files | `internal/projectindex/wire/worker_protocol*` and artifacts | `crates/protocol/src/worker.rs`; `crates/static-compiler/src/finalizer/events.rs` emits event JSON | Partial mirror |
| `static-syntax-records` | `contracts/static-syntax/schema.ts`, `indexer/static-index/syntax/*`, and the current `indexer/static-index/syntax/record/*` record model | `internal/projectindex/staticindex/planner`, `internal/projectindex/staticindex/syntax/record`, and syntax stream decoder | `crates/protocol/src/static_syntax.rs`; `crates/syntax-oxc/src/syntax/frontend.rs` | Mirrored |
| `static-index` | `contracts/static-index/schema.ts` plus `indexer/static-index/{config,plan,protocol,extension-host,compatibility}/*` implementation files | `internal/projectindex/staticindex/{cache,client,protocol,run,sourceprofile,syntax,planner}` | `crates/protocol/src/static_index.rs`; `crates/static-compiler/src/pipeline.rs` | Mirrored |
| `semantic-evidence` | `contracts/semantic/schema.ts`, `indexer/semantic/evidence/projection.ts`, and service/native contracts | `internal/projectindex/host/semantic/worker.go` consumes patch events, not semantic evidence structs | None today | TypeScript-only |

## Parity Fixture Gaps

- `worker-events`: Shared worker-event fixtures are consumed by TypeScript, Go, and Rust for success, artifact, phase-error, and out-of-order stream cases.
- `static-syntax-records`: Shared static syntax fixtures cover imports, call matches, object values, native fact packets, constructor matches, callback summaries, and parser diagnostics across TypeScript, Go, and Rust.
- `static-index`: Shared Static Index protocol and identity fixtures are decoded by TypeScript, Go, and Rust for every method, cache-sensitive identity owner, worker-error, and invalid-stream case.
- `semantic-evidence`: A TS-only semantic evidence fixture covers definitions, relations, source refs, diagnostics, lint findings, and degraded/unsupported cases; Go hosts consume Project Index patch events today and Rust has no semantic evidence mirror.

## Existing Parity Coverage

| Test or helper | Area | Comparison mode | Notes |
| --- | --- | --- | --- |
| `packages/indexer/__tests__/worker-protocol.test.ts` | Worker events | Behavior plus full patch equality | Round-trips in-memory patch facts through TypeScript events and loads shared success/error/artifact stream fixtures. |
| `packages/indexer/__tests__/static-index-protocol.test.ts` | Static Index protocol | Behavior/schema | Validates realistic request/response JSON and protocol edge-case fixtures through Zod and parser helpers. |
| `crates/static-compiler/src/shared_fixtures_tests.rs` | Static Index protocol, static syntax records, relation specs, rule descriptors, and native coverage identities | Behavior/schema plus static-index pipeline finalization | Rust decodes the same fixture JSON consumed by TypeScript and Go. |
| `packages/indexer/__tests__/static-syntax-record.test.ts` | Static syntax records | Behavior/schema | Checks TypeScript frontend record shape, JSON safety, import interests, pruned evidence, and shared constructor/callback/diagnostic cases. |
| `packages/indexer/__tests__/rust-oxc-frontend-batch.test.ts` | Static syntax protocol | Behavior | Uses a fake Rust/Oxc process to prove batch and disk-source protocol behavior from TypeScript host code. |
| `packages/indexer/__tests__/static-provided-record-index.test.ts` | Static syntax to AST patch | Full facts | Normalizes and compares AST patch facts from parser-backed indexing and provided syntax records. |
| `packages/local/internal/projectindex/host/parity_test.go` | Static Index production path | Full facts | Environment-gated Go test compares normalized TypeScript and native AST static graph facts. |
| `packages/local/internal/projectindex/staticindex/run/parity/normalize_test.go` | Static parity normalizer | Behavior | Proves fact ordering is ignored while semantic metadata changes still fail. |
| `packages/local/internal/projectindex/wire/shared_fixtures_test.go` | Worker events | Schema/behavior | Decodes the shared worker event stream fixture through the Go worker-event collector. |
| `packages/local/internal/projectindex/staticindex/protocol/shared_fixtures_test.go` | Static Index protocol | Schema/behavior | Decodes the shared Static Index request/response fixture through Go protocol mirrors. |
| `packages/local/internal/projectindex/staticindex/syntax/shared_fixtures_test.go` | Static syntax records | Schema/behavior | Decodes the shared static syntax record fixture through Go syntax stream mirrors. |
| `packages/indexer/__tests__/contract-spine.test.ts` | Semantic evidence | Behavior/schema | Projects the TS-only shared semantic evidence fixture through the backend-neutral semantic evidence contract. |
| `packages/indexer/__tests__/semantic-backend-parity.test.ts` | Semantic backends | Full facts plus ID/type/role coverage | Compares normalized TypeScript and native semantic facts and checks fixture coverage ids, relation types, source-ref roles, and lint rule ids. |
| `packages/indexer/__tests__/first-party-extractor-fixtures.test.ts` | First-party static extractors | Behavior plus coverage inventory | Asserts selected definitions/relations and records fixture/native coverage for bundled extractor families. |
| `packages/indexer/__tests__/extension-parity.test.ts` | Static extraction projection | Behavior | Verifies public fixture extraction emits representative definitions, relations, dependencies, and contract metadata. |

The baseline has no Project Index output change. Cache identity changes are not
needed for this phase.
