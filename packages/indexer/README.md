# @crux/indexer

Project source intelligence for Crux local devtools.

## Install

```sh
pnpm add @crux/indexer @crux/core
```

This package owns TypeScript/AST indexing that needs to run near user source code:

- Project Index discovery
- primitive and composition extraction
- source references and snippets
- index graph relations
- index lint rule evaluation
- index lint rule descriptor metadata
- source resolver worker logic

The Go runtime in `@crux/local` calls this through bounded Node worker bundles embedded by `@crux/devtools`. `@crux/core` owns the public index contracts; this package owns how local projects are indexed into those contracts.

`source-resolver.mjs` is intentionally separate from `project-indexer.mjs`. The project indexer builds ahead-of-time Project Index facts from authored source. The source resolver performs lazy runtime lookup for bundled trace locations, using source maps to resolve original positions and extract readable function source for devtools trace views.

For the package architecture, source graph model, and incremental planner direction, see [ARCHITECTURE.md](./ARCHITECTURE.md). For the durable issue #18 execution checklist, see [docs/incremental-planner-execution-plan.md](./docs/incremental-planner-execution-plan.md).

The static source pass classifies candidate files before AST parsing. It indexes ordinary authored source with Crux signals, ignores universal output/cache directories, skips generated/bundled/base64 artifact files through content signals, and emits a index diagnostic when an oversized authored-looking source file is skipped for safety. This keeps local devtools responsive without relying on project-specific folder-name ignores.

Project index indexing runs through the Project Index Compiler boundary under `indexer/compiler/`. `compileProjectIndex` returns an immutable compiler result value containing index facts, diagnostics, lint findings, rule descriptor metadata, source rows, and graph evidence; pure emitters project that value into the historical `ProjectIndexSnapshot` and AST `IndexPatch` shapes. `createProjectIndexCompiler` builds an instance from a compiler profile so extension runtime state is isolated per compiler. Static source extraction is owned by `createStaticExtraction`, which is the single source of parser call names, rule descriptors, cache inputs, the TypeScript syntax frontend identity, and cached per-file extraction. `indexProject`, `indexProjectAst`, `indexProjectSemantic`, `indexProjectIncremental`, and `resolveProjectModel` delegate to these compiler boundaries instead of a mutable session object.

`resolveProjectModel(...)` is the package-public facade for source-discovery inspection. It returns the JSON-safe `ResolvedProjectModel` contract from `@crux/core/project-index`, including selected root, package name, config status, source roots, ignored conventions, discovered definitions, Quality defaults, and Project Model diagnostics with provenance. Missing config is reported as source-only discovery rather than a warning, while selected lint findings such as missing stable ids and runtime-dependent tool maps become actionable Project Model diagnostics. It is a read model for local tooling, not a setup registry.

`inspectProjectConfig(...)` is the package-public facade for **effective-configuration** inspection (the `crux config inspect` command). Unlike `resolveProjectModel`, it imports the project's `crux.config.ts` in inert `CRUX_INDEX=1` mode and returns a `ProjectConfigInspect` value covering every `CruxConfig` domain — `quality`, `generation`, `indexer`, `observability`, `devtools`, `persistence`, `lint`, `plugins` — with each value paired to an origin (`config`, `default`, `package.json`, `set`, or `none`) so callers can distinguish explicit overrides from applied defaults. Non-serializable bindings (store, tokenizer, middleware, transport) are surfaced as presence flags. A broken config degrades to an all-defaults view with an `import-failed` status rather than throwing.

Relation resolution is centralized behind the root-exported relation model helpers. `resolveRelationModel` is the project/file-scope facade for binding static relation refs, identity-merging static and semantic edges, projecting relation metadata back onto definitions, and preserving unresolved refs in a `RelationResolutionReport`. `relationIdentity` is the single static/semantic/patch key contract, and semantic analyzer aggregation uses that same identity merge so resolved analyzer facts replace provisional static edges instead of coexisting with them. `createRelationPolicyTable` makes policy precedence explicit with validation diagnostics instead of relying on import order.

Every relation type that reaches compiler output must be declared in the active policy table. Undeclared static refs and pre-resolved semantic/project relations remain visible as evidence, but `RelationResolutionReport.policyGaps` and `relation.policy_gap` diagnostics make the missing declaration explicit during indexing.

The experimental extension boundary lives behind `@crux/indexer/extensions`. It is currently for first-party indexer internals, not stable third-party plugin loading. Crux Indexer Extensions use role-based compiler slots such as extractors, resolvers, rules, and emitters; normal extractors return immutable extracted facts and unresolved references rather than mutating the index graph directly. Degraded extractor diagnostics and declared source-file dependencies are preserved in compiler output. The built-in index lint pass now runs through the internal rule slot, after definitions and relations are resolved and before lint config/suppression filtering, and index rules must declare metadata before registry construction succeeds. This lets existing static extraction and linting move onto a query-ready compiler shape while preserving the stable `indexProject*` entry points.

The public loading foundation is intentionally explicit and non-magical. `crux.config.ts` carries an
inert `indexer` config bag through `@crux/core`; `@crux/indexer` enforces it at compiler startup.
`loadIndexerExtensionReferences(...)` preflights trust by configured package name before any
`import(...)`, resolves packages from the project root, reads installed package metadata, checks the
requested package version, validates `crux.indexer`/Project Index schema compatibility, and only then
hands manifests to the compiler profile. `resolveIndexerExtensionReferences(...)` remains the pure
manifest-only gate for tooling and tests that already have extension objects. There is no global
registration and no implicit package discovery.

Extension authors can test manifests with `@crux/indexer/testing`. `defineIndexerExtensionFixture` plus `extractFixtureSource` runs the production static extraction engine against in-memory source text with cache disabled, and `assertDeterministicExtraction` double-runs the same fixture to guard stable output and cache identity.

The current extension context includes the shared migration helpers needed by most remaining static extractors: factory argument reads, static object reads, object-literal compatibility matches, schema projection, definition/reference builders, constructor matches, and source-ref builders for properties, callbacks, schemas, template interpolations, and helper functions. Raw TypeScript access remains an unstable first-party adapter while the migration finishes.

First-party compatibility extraction such as Convex agent declarations, `new Agent(...)`, and bare
object-literal tool schemas now runs through internal extension slots. Compiler-owned projections such
as source-reference projection, runtime prepare projection, and prompt/context tree path projection
are explicit in the default compiler profile. They are not public parser plugins.

`crux dev` intentionally starts with a bounded static/AST pass so the local server can publish useful
Project Index data quickly. That first pass may include an `index.static_only` diagnostic as a status
marker. When the worker and project can produce semantic enrichment, the Go service applies the
semantic patch and clears that marker; if semantic enrichment is unavailable or degraded, the marker
is preserved so clients can explain the current fidelity honestly.

`indexProjectIncremental` consumes the graph-backed planner and emits index patches instead of a complete snapshot. In `ast` mode it produces exact-invalidation AST patches for planner-approved source-file and dependency-closure changes through the shared compiler-result AST emitter. In `ast-and-semantic` mode it follows the AST patch with TypeScript semantic enrichment for known index-owning files and semantic source-ref support files in the affected closure. When graph evidence is incomplete, stale, or unsupported, it falls back to the existing full indexing paths.

`@crux/local` applies those incremental patches through the Go-owned index patch state. That applier honors exact file/definition invalidation, preserves unrelated runtime and quality facts, merges diagnostics by id, and unions source-row graph evidence across AST and semantic phases. The local service has an incremental bridge that falls back to full reindex when there is no previous source graph or no incremental-capable worker. During `crux dev`, a Go `fsnotify` watcher debounces source/config changes and feeds changed/deleted file sets into that bridge.

Semantic enrichment is composed from focused analyzers behind a shared result contract. The top-level `semanticIndexFacts(root, files)` behavior remains the public entry point, while analyzers own narrower responsibilities such as schema metadata/source refs, direct source refs, relation discovery, and definition enrichment. Shared semantic plumbing lives under `indexer/semantic/`: `program.ts` owns TypeScript program setup, `discovery.ts` owns candidate discovery, `schema-candidates.ts` and `source-ref-candidates.ts` select analyzer inputs, `registry.ts` wires analyzers, and `runner.ts` merges analyzer outputs. This keeps new semantic capabilities testable at their boundary without changing the patch shape consumed by caches and the Go read model.

Source resolver logic is organized under `source-resolver/` with a stable root re-export at `source-resolver.ts`. The facade keeps the compatibility API, while the internals are split into focused functional modules:

- `discovery.ts` discovers sidecar, relative URL, and inline source maps through an injected filesystem boundary.
- `trace-map.ts` parses source maps and resolves generated positions into original positions.
- `original-source.ts` loads original source from `sourcesContent` first, then falls back to disk.
- `extraction.ts` extracts function-like source previews from original source text.
- `cache.ts` documents and applies location cache key and eviction policy.
- `protocol.ts` narrows JSON-line worker requests with type guards and serializes stdout-safe responses.

New source resolver modules should keep exported functions documented with JSDoc, prefer readonly data contracts, and return typed outcomes instead of using thrown errors for expected misses.

## Cache Versioning

Index caches are keyed by structured cache identity because indexer code changes can alter the index for unchanged project source. Static cache identity includes source hashes, direct import dependency hashes, config boundary hashes, extension/extractor/rule identity, and compiler profile/intrinsic identity. Semantic cache identity includes the analyzed source closure, config boundary hashes, TypeScript version, and the semantic compiler-options identity.

The epoch constants live in one place:

- `indexer/cache-identity.ts` (`STATIC_PARSE_CACHE_EPOCH`) for static AST parser/extractor output changes: definitions, relations, metadata, schemas, source refs, diagnostics, source/path ids, file classification, or presentation hints.
- `indexer/cache-identity.ts` (`SEMANTIC_FACTS_CACHE_EPOCH`) for semantic TypeScript enrichment changes: compiler-resolved aliases, nested schemas, callbacks, source refs, runtime joins, intelligence metadata, relations, lint facts, or compiler option meaning.
- `@crux/local`'s `packages/local/internal/devtools/index_cache_identity.go` (`projectIndexSnapshotCacheEpoch`) when a stale `.crux/cache/index/index.json` snapshot could hide a new read-model field or changed cache semantics after restart.

Refactors that only move semantic logic between analyzers without changing emitted facts do not require a cache version bump.

If a feature spans static facts, semantic facts, and the Go-owned index snapshot, bump all three. A normal rebuild/restart plus `crux index reindex` should pick up the migration; users should not need to delete `.crux/cache` manually.

## Public Entry Points

```ts
import {
  compileProjectIndex,
  createStaticExtraction,
  indexProject,
  indexProjectIncremental,
  inspectProjectConfig,
  resolveProjectModel,
} from '@crux/indexer'
import type { IndexerExtension } from '@crux/indexer/extensions'
import { SourceResolver } from '@crux/indexer/source-resolver'
import { defineIndexerExtensionFixture, extractFixtureSource } from '@crux/indexer/testing'
```

Most applications should not import this package directly. It is primarily an internal dependency of Crux local devtools, documented as a separate package so the architecture boundary is explicit. `createStaticExtraction` is the supported compiler-owned static extraction boundary for tools that need source-file facts, and `@crux/indexer/testing` is the supported source-text fixture surface for extension tests. The `extensions` subpath is experimental and exists to migrate first-party internals before third-party plugin support is stabilized. Internal `indexer/*` modules are not package exports.
