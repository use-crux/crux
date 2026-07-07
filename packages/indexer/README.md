# @use-crux/indexer

Project source intelligence for Crux local devtools.

## Install

```sh
pnpm add @use-crux/indexer @use-crux/core
```

This package is the Project Index extension-authoring SDK and contract package.
Bundled first-party extraction and lint evaluation are owned by the Crux Local
binary through the Rust/Oxc Static Index pipeline.

The Go runtime in `@use-crux/local` calls this through bounded Node worker bundles built by the private `@use-crux/local-workers` package. `@use-crux/core` owns the public index contracts; this package owns how local projects are indexed into those contracts.

`source-resolver.mjs` is intentionally separate from `project-indexer.mjs`. The Crux Indexer worker builds ahead-of-time Project Index facts from authored source. The source resolver performs lazy runtime lookup for bundled trace locations, using source maps to resolve original positions and extract readable function source for devtools trace views.

For the package architecture, source graph model, and incremental planner direction, see [ARCHITECTURE.md](./ARCHITECTURE.md) and [ADR-0001](./docs/adr/0001-incremental-planner-before-partial-execution.md).

The static source pass classifies candidate files before AST parsing. It indexes ordinary authored source with Crux signals, ignores universal output/cache directories, skips generated/bundled/base64 artifact files through content signals, and emits an index diagnostic when an oversized authored-looking source file is skipped for safety. This keeps local devtools responsive without relying on project-specific folder-name ignores.

Crux-owned host work runs through explicit `host/*` subpaths. `compileProjectIndex`
and `createStaticExtraction` are host facades for projecting caller-provided
syntax records, third-party extension output, graph evidence, and patch facts.
There is no implicit TypeScript bundled frontend and no root package API that
spawns or substitutes for the native binary.

`resolveProjectModel(...)` is a Crux-owned host facade for config/read-model inspection. It returns the JSON-safe `ResolvedProjectModel` contract from `@use-crux/core/project-index`, including selected root, package name, config status, source roots, ignored conventions, config-derived definitions, Quality defaults, and Project Model diagnostics with provenance. Authored source discovery comes from the native Project Index pipeline.

`inspectProjectConfig(...)` is the package-public facade for **effective-configuration** inspection (the `crux config inspect` command). Unlike `resolveProjectModel`, it imports the project's `crux.config.ts` in inert `CRUX_INDEX=1` mode and returns a `ProjectConfigInspect` value covering every `CruxConfig` domain — `quality`, `generation`, `indexer`, `experimental`, `observability`, `devtools`, `persistence`, `lint`, `plugins` — with each value paired to an origin (`config`, `default`, `package.json`, `set`, or `none`) so callers can distinguish explicit overrides from applied defaults. Non-serializable bindings (store, tokenizer, middleware, transport) are surfaced as presence flags. A broken config degrades to an all-defaults view with an `import-failed` status rather than throwing.

Relation resolution is centralized behind the root-exported relation model helpers. `resolveRelationModel` is the project/file-scope facade for binding static relation refs, identity-merging static and semantic edges, projecting relation metadata back onto definitions, and preserving unresolved refs in a `RelationResolutionReport`. `relationIdentity` is the single static/semantic/patch key contract, and semantic analyzer aggregation uses that same identity merge so resolved analyzer facts replace provisional static edges instead of coexisting with them. `createRelationPolicyTable` makes policy precedence explicit with validation diagnostics instead of relying on import order.

Every relation type that reaches compiler output must be declared in the active policy table. Undeclared static refs and pre-resolved semantic/project relations remain visible as evidence, but `RelationResolutionReport.policyGaps` and `relation.policy_gap` diagnostics make the missing declaration explicit during indexing.

The extension boundary lives behind `@use-crux/indexer/extensions`. Third-party Indexer Extensions use role-based compiler slots such as extractors, resolvers, rules, and emitters; normal extractors return immutable extracted facts and unresolved references rather than mutating the index graph directly. Bundled first-party extractors and lints are not implemented through TypeScript extension slots.

The public loading foundation is intentionally explicit and non-magical. `crux.config.ts` carries an
inert `indexer` config bag through `@use-crux/core`; `@use-crux/indexer` enforces it at compiler startup.
`loadIndexerExtensionReferences(...)` preflights trust by configured package name before any
`import(...)`, resolves packages from the project root, reads installed package metadata, checks the
requested package version, validates `crux.indexer`/Project Index schema compatibility, and only then
hands manifests to the compiler profile. `resolveIndexerExtensionReferences(...)` remains the pure
manifest-only gate for tooling and tests that already have extension objects. There is no global
registration and no implicit package discovery.

Extension authors can test manifests with `@use-crux/indexer/testing`. `defineIndexerExtensionFixture` plus `extractFixtureSource` runs the production static extraction engine against in-memory source text with cache disabled, using the in-process TypeScript syntax-record producer as the fixture default and reporting the producer in `trace.syntaxFrontend`. `assertDeterministicExtraction` double-runs the same fixture to guard stable output and cache identity.

The public extension context is frozen as a reader/builder object: `extension`, `extractor`, `match`, `source`, `args`, `config`, `define`, `ref`, and `sourceRef`. It exposes factory argument reads, static object reads, schema projection, definition/reference builders, constructor matches, and source-ref builders for properties, callbacks, schemas, template interpolations, and helper functions. Raw TypeScript access remains an unstable first-party adapter on internal module paths only.

Semantic backends are backend-neutral. The JavaScript TypeScript backend is the correctness baseline,
and the experimental native backend must emit the same projected semantic facts. Native projectors
are optional optimizations: where a first-party primitive shape can be represented as data, keep the
native fast path behind an internal primitive projection manifest instead of hardcoded primitive
branches. Manifest-known shapes that are not native-projectable must route through the native shared
semantic analyzer so native indexing never drops extension or first-party facts.

When `experimental.indexer.native` selects the TypeScript-Go backend, the worker resolves the
`@typescript/native-preview-<platform>-<arch>` executable from the indexed project root before
constructing native-preview. This keeps embedded workers extracted under `~/.cache/crux` compatible
with pnpm workspaces and monorepos. Set `experimental.indexer.native.tsserverPath` or
`CRUX_INDEX_NATIVE_TSSERVER_PATH` only when the workspace package resolution path should be bypassed.
In that mode TypeScript-Go owns semantic project setup, checker calls, declaration lookup, and AST
traversal. Unsupported direct-projector shapes continue through the tsgo-backed shared analyzer path;
they do not fall back to the JavaScript TypeScript semantic backend.

First-party compatibility extraction such as Convex agent declarations, `new Agent(...)`, and bare
object-literal tool schemas now runs through internal extension slots. Compiler-owned projections such
as source-reference projection, runtime prepare projection, and prompt/context tree path projection
are explicit in the default compiler profile. They are not public parser extension points.

`crux dev` intentionally starts with a bounded static/AST pass so the local server can publish useful
Project Index data quickly. That first pass may include an `index.source_only` diagnostic as a status
marker. When the worker and project can produce semantic enrichment, the Go service applies the
semantic patch and clears that marker; if semantic enrichment is unavailable or degraded, the marker
is preserved so clients can explain the current fidelity honestly.

Crux Local incremental indexing is Go/Rust-owned. It consumes graph evidence and emits AST/semantic patches from the native Static Index path, falling back to full native reindex when incremental prerequisites are unavailable.

Relation read-model projection accepts optional runtime-use target rules. Product-specific runtime aliases, such as a local app's tool-context id, belong in that data instead of in SDK resolver code. The built-in defaults cover generic Crux runtime resources (`tools`, `*.memory`, `*.retriever`, and `blackboard`).

`@use-crux/local` applies those incremental patches through the Go-owned index patch state. That applier honors exact file/definition invalidation, preserves unrelated runtime and quality facts, merges diagnostics by id, and unions source-row graph evidence across AST and semantic phases. The local service has an incremental bridge that falls back to full reindex when there is no previous source graph or no incremental-capable worker. During `crux dev`, a Go `fsnotify` watcher debounces source/config changes, assigns a monotonic watch run id, coalesces changed/deleted file sets, and feeds a single-flight incremental bridge. Background semantic patches are generation-checked before commit so a slow semantic result cannot overwrite a newer AST generation. The latest bounded watch report is available from the local read model at `GET /api/project/index/watch`.

Use `go test ./internal/devtools -run '^$' -bench BenchmarkReindexProjectIncrementalWatchCommit` from `packages/local` to isolate the Go-side patch commit, status, and read-model projection cost.

Semantic enrichment is composed from focused analyzers behind a shared result contract. The top-level `semanticIndexFacts(root, files)` behavior remains the public entry point, while analyzers own narrower responsibilities such as schema metadata/source refs, direct source refs, relation discovery, and definition enrichment. Shared semantic plumbing lives under `indexer/semantic/`: compiler/backend services own project setup, `discovery.ts` owns candidate discovery, `schema-candidates.ts` and `source-ref-candidates.ts` select analyzer inputs, `registry.ts` wires analyzers, and `runner.ts` merges analyzer outputs. This keeps new semantic capabilities testable at their boundary without changing the patch shape consumed by caches and the Go read model.

Source resolver logic is organized under `source-resolver/` with a stable root re-export at `source-resolver.ts`. The facade keeps the compatibility API, while the internals are split into focused functional modules:

- `discovery.ts` discovers sidecar, relative URL, and inline source maps through an injected filesystem boundary.
- `trace-map.ts` parses source maps and resolves generated positions into original positions.
- `original-source.ts` loads original source from `sourcesContent` first, then falls back to disk.
- `extraction.ts` extracts function-like source previews from original source text.
- `cache.ts` documents and applies location cache key and eviction policy.
- `protocol.ts` narrows JSON-line worker requests with type guards and serializes stdout-safe responses.

New source resolver modules should keep exported functions documented with JSDoc, prefer readonly data contracts, and return typed outcomes instead of using thrown errors for expected misses.

## Cache Versioning

Index caches are keyed by structured cache identity because indexer code changes can alter the index for unchanged project source. Static cache identity includes source hashes, direct import dependency hashes, config boundary hashes, extension/extractor/rule identity, and compiler profile/intrinsic identity. Semantic cache identity includes the analyzed source closure, config boundary hashes, selected compiler runtime identity, and the semantic compiler-options identity.

The epoch constants live in one place:

- `indexer/cache-identity.ts` (`STATIC_PARSE_CACHE_EPOCH`) for static AST parser/extractor output changes: definitions, relations, metadata, schemas, source refs, diagnostics, source/path ids, file classification, or presentation hints.
- `indexer/cache-identity.ts` (`SEMANTIC_FACTS_CACHE_EPOCH`) for semantic enrichment changes: compiler-resolved aliases, nested schemas, callbacks, source refs, runtime joins, intelligence metadata, relations, lint facts, compiler runtime identity, or compiler option meaning.
- `@use-crux/local`'s `packages/local/internal/projectindex/cache/identity.go` (`ProjectIndexSnapshotCacheEpoch`) when a stale `.crux/cache/index-v2/epoch-*` snapshot could hide a new read-model field or changed cache semantics after restart.

Refactors that only move semantic logic between analyzers without changing emitted facts do not require a cache version bump.

If a feature spans static facts, semantic facts, and the Go-owned index snapshot, bump all three. A normal rebuild/restart plus `crux index reindex` should pick up the migration; users should not need to delete `.crux/cache` manually.

## Public Entry Points

Stable beta root APIs are the package root, `testing`, `source-resolver`, and the JSON-safe
`contracts/*` subpaths. Breaking shape changes are not planned for those surfaces after the
pre-launch rename phase. `@use-crux/indexer/extensions` remains experimental until third-party
loading, trust UX, rule execution, and fixture package contracts are ready. `host/*` subpaths are
Crux-owned worker bridges, not general SDK APIs.

```ts
import type { IndexerExtension } from "@use-crux/indexer/extensions";
import { SourceResolver } from "@use-crux/indexer/source-resolver";
import {
  defineIndexerExtensionFixture,
  extractFixtureSource,
} from "@use-crux/indexer/testing";
```

Crux-owned worker hosts can use private host subpaths while the package remains private:

```ts
import {
  compileProjectIndex,
  createStaticExtraction,
  indexProjectAstFromSyntaxRecordsForHost,
} from "@use-crux/indexer/host/static-index";
import { indexPatchFromWorkerEvents } from "@use-crux/indexer/contracts/worker-events";
```

Most applications should not import this package directly. It is primarily an internal dependency of Crux local devtools, documented as a separate package so the architecture boundary is explicit. `createStaticExtraction` and `indexProjectAstFromSyntaxRecordsForHost` are Crux-owned host boundaries for bundled tools and workers that need source-file facts, explicit syntax frontends, validated native cache hits, or native projection controls. `@use-crux/indexer/testing` is the supported source-text fixture surface for extension tests. The `extensions` subpath is experimental and exists to migrate first-party internals before third-party extension support is stabilized. Internal `indexer/*` modules are not package exports; `host/*` subpaths are Crux-owned worker bridges, and `contracts/*` subpaths are JSON-safe cross-runtime contracts rather than general SDK entry points.
