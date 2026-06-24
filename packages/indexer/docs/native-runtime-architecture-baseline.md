# Native Runtime Architecture Baseline

This is the current baseline for the native runtime architecture refactor. It
records the ownership and contract inventory after the TypeScript contract
spine, Go host split, and Rust native-static module split.

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
| `worker-events` | `contracts/worker-events/schema.ts` plus `indexer/worker-protocol/*` implementation files | `internal/projectindexwire/worker_protocol*` and artifacts | `protocol/worker.rs`; `index_compiler/finalizer/events.rs` emits event JSON | Partial mirror |
| `static-syntax-records` | `contracts/static-syntax/schema.ts` plus `indexer/static/syntax-record/*` implementation files | `internal/indexhost/native/staticplan`, `internal/indexhost/native/syntax/record`, and syntax stream decoder | `protocol/static_syntax.rs` | Mirrored |
| `native-static-protocol` | `contracts/native-static/schema.ts` plus `indexer/worker-protocol/native-static*` implementation files | `internal/indexhost/native/protocol/*` | `protocol/native_static.rs` | Mirrored |
| `semantic-evidence` | `contracts/semantic/schema.ts`, `indexer/semantic/evidence/projection.ts`, and service/native contracts | `internal/indexhost/semantic/worker.go` consumes patch events, not semantic evidence structs | None today | TypeScript-only |

## Parity Fixture Gaps

- `worker-events`: Shared success-path worker-event fixtures are consumed by TypeScript, Go, and Rust; remaining gaps are artifact, phase-error, and out-of-order stream fixtures.
- `static-syntax-records`: A shared static syntax record fixture covers imports, call matches, object values, and native fact packets; remaining gaps are constructor matches, callback summaries, and parser diagnostic cases.
- `native-static-protocol`: A shared native static protocol fixture is decoded by TypeScript, Go, and Rust for every method; remaining gaps are explicit protocol-error and invalid-stream fixtures.
- `semantic-evidence`: Semantic backend parity compares normalized Project Index facts, but no shared semantic evidence fixture files cover definitions, relations, source refs, diagnostics, lint findings, and degraded/unsupported cases.

## Existing Parity Coverage

| Test or helper | Area | Comparison mode | Notes |
| --- | --- | --- | --- |
| `packages/indexer/__tests__/worker-protocol.test.ts` | Worker events | Behavior plus full patch equality | Round-trips in-memory patch facts through TypeScript events; no shared file fixture and no Go/Rust decode in the same test. |
| `packages/indexer/__tests__/native-static-protocol.test.ts` | Native static protocol | Behavior/schema | Validates realistic request/response JSON through Zod and parser helpers. It does not compare Go or Rust mirrors. |
| `crates/crux-indexer-worker/src/shared_fixtures_tests.rs` | Native static protocol, static syntax records, relation specs, rule descriptors, and native coverage identities | Behavior/schema plus native-static pipeline finalization | Rust decodes the same fixture JSON consumed by TypeScript and Go. |
| `packages/indexer/__tests__/static-syntax-record.test.ts` | Static syntax records | Behavior/schema | Checks TypeScript frontend record shape, JSON safety, import interests, and pruned evidence. |
| `packages/indexer/__tests__/rust-oxc-frontend-batch.test.ts` | Static syntax protocol | Behavior | Uses a fake Rust/Oxc process to prove batch and disk-source protocol behavior from TypeScript host code. |
| `packages/indexer/__tests__/static-provided-record-index.test.ts` | Static syntax to AST patch | Full facts | Normalizes and compares AST patch facts from parser-backed indexing and provided syntax records. |
| `packages/local/internal/indexhost/parity_test.go` | Native static production path | Full facts | Environment-gated Go test compares normalized TypeScript and native AST static graph facts. |
| `packages/local/internal/indexhost/native/staticcompile/parity/normalize_test.go` | Static parity normalizer | Behavior | Proves fact ordering is ignored while semantic metadata changes still fail. |
| `packages/local/internal/projectindexwire/shared_fixtures_test.go` | Worker events | Schema/behavior | Decodes the shared worker event stream fixture through the Go worker-event collector. |
| `packages/local/internal/indexhost/native/protocol/shared_fixtures_test.go` | Native static protocol | Schema/behavior | Decodes the shared native static request/response fixture through Go protocol mirrors. |
| `packages/local/internal/indexhost/native/syntax/shared_fixtures_test.go` | Static syntax records | Schema/behavior | Decodes the shared static syntax record fixture through Go syntax stream mirrors. |
| `packages/indexer/__tests__/semantic-backend-parity.test.ts` | Semantic backends | Full facts plus ID/type/role coverage | Compares normalized TypeScript and native semantic facts and checks fixture coverage ids, relation types, source-ref roles, and lint rule ids. |
| `packages/indexer/__tests__/first-party-extractor-fixtures.test.ts` | First-party static extractors | Behavior plus coverage inventory | Asserts selected definitions/relations and records fixture/native coverage for bundled extractor families. |
| `packages/indexer/__tests__/extension-parity.test.ts` | Static extraction projection | Behavior | Verifies public fixture extraction emits representative definitions, relations, dependencies, and contract metadata. |

The baseline has no Project Index output change. Cache identity changes are not
needed for this phase.
