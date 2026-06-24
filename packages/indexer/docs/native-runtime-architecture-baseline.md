# Native Runtime Architecture Baseline

This is the Phase 1 baseline for the native runtime architecture refactor. It
records the current ownership and contract inventory before later phases move
files behind a dedicated contract spine.

The executable inventory lives in
`packages/indexer/__tests__/contract-inventory.ts`; this document explains the
same baseline for humans.

## Ownership Map

| Area | Owner | Owns | Must not own |
| --- | --- | --- | --- |
| `packages/core` | TypeScript SDK core | Durable Project Index data types, rule manifest types, provider-agnostic contracts | Provider SDKs, React, Convex, local runtime, indexer implementation |
| `packages/indexer` | TypeScript Project Index Compiler | Public indexer API, extension authoring API, worker schemas, static syntax ABI, semantic evidence contract, TypeScript correctness baseline, cache identity | Go process lifetime, local persistence, devtools quality enrichment, Rust/Oxc internals |
| `packages/local` | Go local runtime | CLI/server/TUI, worker supervision, cancellation, budgets, Project Index store/cache loading, snapshot state, devtools read models, HTTP/WebSocket routes | Public extension API, TypeScript compiler semantics, raw parser/checker APIs |
| `crates/crux-indexer-worker` | Rust native implementation | Oxc static syntax frontend and native static compiler behavior that has parity fixtures | Public SDK contracts, Go orchestration, independent user-facing Project Index semantics |

The durable boundary is Project Index facts, semantic evidence, static syntax
records, and patch/event streams. Raw TypeScript AST nodes, Oxc AST nodes,
checker objects, parser arenas, and process pointers stay inside their owning
runtime.

## Contract Inventory

| Contract group | Current canonical TypeScript area | Current Go mirror | Current Rust mirror | Mirror status |
| --- | --- | --- | --- | --- |
| `worker-events` | `indexer/worker-protocol/*` | `internal/projectindex/worker_protocol*` and artifacts | `static_compiler/finalizer/events.rs` emits event JSON | Partial mirror |
| `static-syntax-records` | `indexer/static/syntax-record/*` | static syntax plan, syntaxrecord collection, syntax stream decoder | `protocol/syntax_record.rs` and `protocol/syntax_worker.rs` | Mirrored |
| `native-static-protocol` | `indexer/worker-protocol/native-static*` | `internal/projectindexer/staticprotocol/*` | `protocol/static_compiler.rs`, `protocol/static_compile.rs` | Mirrored |
| `semantic-evidence` | `indexer/semantic/evidence.ts` and service/native contracts | Semantic host consumes patch events, not semantic evidence structs | None today | TypeScript-only |

## Parity Fixture Gaps

- `worker-events`: No shared worker-event fixture files are consumed by TypeScript, Go, and Rust for success, error, artifact, and out-of-order stream cases.
- `static-syntax-records`: No shared static syntax record fixture directory covers imports, interests, constructor calls, object values, callbacks, diagnostics, and native fact packets across all three languages.
- `native-static-protocol`: TypeScript and Rust have in-memory protocol JSON tests, but there is no shared fixture set decoded by TypeScript, Go, and Rust for every method, telemetry shape, stream event, and error case.
- `semantic-evidence`: Semantic backend parity compares normalized Project Index facts, but no shared semantic evidence fixture files cover definitions, relations, source refs, diagnostics, lint findings, and degraded/unsupported cases.

## Existing Parity Coverage

| Test or helper | Area | Comparison mode | Notes |
| --- | --- | --- | --- |
| `packages/indexer/__tests__/worker-protocol.test.ts` | Worker events | Behavior plus full patch equality | Round-trips in-memory patch facts through TypeScript events; no shared file fixture and no Go/Rust decode in the same test. |
| `packages/indexer/__tests__/native-static-protocol.test.ts` | Native static protocol | Behavior/schema | Validates realistic request/response JSON through Zod and parser helpers. It does not compare Go or Rust mirrors. |
| `crates/crux-indexer-worker/src/static_compiler/protocol/tests.rs` | Native static protocol | Behavior/schema | Rust serde round-trip tests use realistic inline JSON. They are not shared with TypeScript or Go. |
| `packages/indexer/__tests__/static-syntax-record.test.ts` | Static syntax records | Behavior/schema | Checks TypeScript frontend record shape, JSON safety, import interests, and pruned evidence. |
| `packages/indexer/__tests__/rust-oxc-frontend-batch.test.ts` | Static syntax worker protocol | Behavior | Uses a fake worker to prove batch and disk-source protocol behavior from TypeScript host code. |
| `packages/indexer/__tests__/static-provided-record-index.test.ts` | Static syntax to AST patch | Full facts | Normalizes and compares AST patch facts from parser-backed indexing and provided syntax records. |
| `packages/local/internal/projectindexer/parity_test.go` | Native static production path | Full facts | Environment-gated Go test compares normalized TypeScript and native AST static graph facts. |
| `packages/local/internal/projectindexer/staticparity/normalize_test.go` | Static parity normalizer | Behavior | Proves fact ordering is ignored while semantic metadata changes still fail. |
| `packages/indexer/__tests__/semantic-backend-parity.test.ts` | Semantic backends | Full facts plus ID/type/role coverage | Compares normalized TypeScript and native semantic facts and checks fixture coverage ids, relation types, source-ref roles, and lint rule ids. |
| `packages/indexer/__tests__/first-party-extractor-fixtures.test.ts` | First-party static extractors | Behavior plus coverage inventory | Asserts selected definitions/relations and records fixture/native coverage for bundled extractor families. |
| `packages/indexer/__tests__/extension-parity.test.ts` | Static extraction projection | Behavior | Verifies public fixture extraction emits representative definitions, relations, dependencies, and contract metadata. |

The baseline has no Project Index output change. Cache identity changes are not
needed for this phase.
