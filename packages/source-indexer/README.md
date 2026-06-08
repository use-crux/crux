# @crux/source-indexer

Project source intelligence for Crux local devtools.

This package owns TypeScript/AST indexing that needs to run near user source code:

- Project Catalog discovery
- primitive and composition extraction
- source references and snippets
- catalog graph relations
- catalog lint rule evaluation
- source resolver worker logic

The Go runtime in `@crux/local` calls this through bounded Node worker bundles embedded by `@crux/devtools`. `@crux/core` owns the public catalog contracts; this package owns how local projects are indexed into those contracts.

`source-resolver.mjs` is intentionally separate from `project-indexer.mjs`. The project indexer builds ahead-of-time Project Catalog facts from authored source. The source resolver performs lazy runtime lookup for bundled trace locations, using source maps to resolve original positions and extract readable function source for devtools trace views.

For the package architecture, source graph model, and incremental planner direction, see [ARCHITECTURE.md](./ARCHITECTURE.md). For the durable issue #18 execution checklist, see [docs/incremental-planner-execution-plan.md](./docs/incremental-planner-execution-plan.md).

The static source pass classifies candidate files before AST parsing. It indexes ordinary authored source with Crux signals, ignores universal output/cache directories, skips generated/bundled/base64 artifact files through content signals, and emits a catalog diagnostic when an oversized authored-looking source file is skipped for safety. This keeps local devtools responsive without relying on project-specific folder-name ignores.

Project catalog indexing runs through the Project Catalog Compiler boundary under `indexer/compiler/`. `compileProjectCatalog` returns an immutable compiler result value containing catalog facts, diagnostics, lint findings, source rows, and graph evidence; pure emitters project that value into the historical `ProjectCatalogSnapshot` and AST `CatalogPatch` shapes. `createProjectCatalogCompiler` builds an instance from a compiler profile so extension runtime state is isolated per compiler. `indexProject`, `indexProjectAst`, `indexProjectSemantic`, and `indexProjectIncremental` delegate to the compiler boundary instead of a mutable session object.

The experimental extension boundary lives behind `@crux/source-indexer/extensions`. It is currently for first-party source-indexer internals, not stable third-party plugin loading. Source Indexer Extensions use role-based compiler slots such as extractors, resolvers, rules, and emitters; normal extractors return immutable extracted facts and unresolved references rather than mutating the catalog graph directly. Degraded extractor diagnostics and declared source-file dependencies are preserved in compiler output. The built-in catalog lint pass now runs through the internal rule slot, after definitions and relations are resolved and before lint config/suppression filtering, and catalog rules must declare metadata before registry construction succeeds. This lets existing static extraction and linting move onto a query-ready compiler shape while preserving the stable `indexProject*` entry points.

The current extension context includes the shared migration helpers needed by most remaining static extractors: factory argument reads, static object reads, schema projection, definition/reference builders, and source-ref builders for properties, callbacks, schemas, template interpolations, and helper functions. Raw TypeScript access remains an unstable first-party adapter while the migration finishes.

Compiler-owned intrinsics such as Convex agent extraction, constructor compatibility, runtime prepare projection, and prompt/context tree path projection are explicit in the default compiler profile. They are not public parser plugins.

`indexProjectIncremental` consumes the graph-backed planner and emits catalog patches instead of a complete snapshot. In `ast` mode it produces exact-invalidation AST patches for planner-approved source-file and dependency-closure changes through the shared compiler-result AST emitter. In `ast-and-semantic` mode it follows the AST patch with TypeScript semantic enrichment for known catalog-owning files and semantic source-ref support files in the affected closure. When graph evidence is incomplete, stale, or unsupported, it falls back to the existing full indexing paths.

`@crux/local` applies those incremental patches through the Go-owned catalog patch state. That applier honors exact file/definition invalidation, preserves unrelated runtime and quality facts, merges diagnostics by id, and unions source-row graph evidence across AST and semantic phases. The local service has an incremental bridge that falls back to full reindex when there is no previous source graph or no incremental-capable worker. During `crux dev`, a Go `fsnotify` watcher debounces source/config changes and feeds changed/deleted file sets into that bridge.

Semantic enrichment is composed from focused analyzers behind a shared result contract. The top-level `semanticCatalogFacts(root, files)` behavior remains the public entry point, while analyzers own narrower responsibilities such as schema metadata/source refs, direct source refs, relation discovery, and definition enrichment. Shared semantic plumbing lives under `indexer/semantic/`: `program.ts` owns TypeScript program setup, `discovery.ts` owns candidate discovery, `schema-candidates.ts` and `source-ref-candidates.ts` select analyzer inputs, `registry.ts` wires analyzers, and `runner.ts` merges analyzer outputs. This keeps new semantic capabilities testable at their boundary without changing the patch shape consumed by caches and the Go read model.

Source resolver logic is organized under `source-resolver/` with a stable root re-export at `source-resolver.ts`. The facade keeps the compatibility API, while the internals are split into focused functional modules:

- `discovery.ts` discovers sidecar, relative URL, and inline source maps through an injected filesystem boundary.
- `trace-map.ts` parses source maps and resolves generated positions into original positions.
- `original-source.ts` loads original source from `sourcesContent` first, then falls back to disk.
- `extraction.ts` extracts function-like source previews from original source text.
- `cache.ts` documents and applies location cache key and eviction policy.
- `protocol.ts` narrows JSON-line worker requests with type guards and serializes stdout-safe responses.

New source resolver modules should keep exported functions documented with JSDoc, prefer readonly data contracts, and return typed outcomes instead of using thrown errors for expected misses.

## Cache Versioning

Catalog caches are versioned because indexer code changes can alter the catalog for unchanged project source. When that happens, bump the matching cache version in the same change:

- `indexer/static-cache.ts` (`CACHE_VERSION`) for static AST parser/extractor output changes: definitions, relations, metadata, schemas, source refs, diagnostics, source/path ids, file classification, or presentation hints.
- `indexer/semantic-cache.ts` (`CACHE_VERSION`) for semantic TypeScript enrichment changes: compiler-resolved aliases, nested schemas, callbacks, source refs, runtime joins, intelligence metadata, relations, lint facts, or compiler option meaning.
- `@crux/local`'s `packages/local/internal/devtools/catalog_cache.go` (`catalogCacheFormatVersion`) when a stale `.crux/cache/catalog/catalog.json` snapshot could hide a new read-model field or changed cache semantics after restart.

Refactors that only move semantic logic between analyzers without changing emitted facts do not require a cache version bump.

If a feature spans static facts, semantic facts, and the Go-owned catalog snapshot, bump all three. A normal rebuild/restart plus `crux catalog reindex` should pick up the migration; users should not need to delete `.crux/cache` manually.

## Public Entry Points

```ts
import { compileProjectCatalog, indexProject, indexProjectIncremental } from '@crux/source-indexer'
import type { SourceIndexerExtension } from '@crux/source-indexer/extensions'
import { SourceResolver } from '@crux/source-indexer/source-resolver'
```

Most applications should not import this package directly. It is primarily an internal dependency of Crux local devtools, documented as a separate package so the architecture boundary is explicit. The `extensions` subpath is experimental and exists to migrate first-party internals before third-party plugin support is stabilized. Internal `indexer/*` modules are not package exports.
