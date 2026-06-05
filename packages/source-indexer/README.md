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

The static source pass classifies candidate files before AST parsing. It indexes ordinary authored source with Crux signals, ignores universal output/cache directories, skips generated/bundled/base64 artifact files through content signals, and emits a catalog diagnostic when an oversized authored-looking source file is skipped for safety. This keeps local devtools responsive without relying on project-specific folder-name ignores.

Semantic enrichment is composed from focused analyzers behind a shared result contract. The top-level `semanticCatalogFacts(root, files)` behavior remains the public entry point, while analyzers own narrower responsibilities such as schema metadata/source refs, direct source refs, relation discovery, and definition enrichment. This keeps new semantic capabilities testable at their boundary without changing the patch shape consumed by caches and the Go read model.

## Cache Versioning

Catalog caches are versioned because indexer code changes can alter the catalog for unchanged project source. When that happens, bump the matching cache version in the same change:

- `indexer/static-cache.ts` (`CACHE_VERSION`) for static AST parser/extractor output changes: definitions, relations, metadata, schemas, source refs, diagnostics, source/path ids, file classification, or presentation hints.
- `indexer/semantic-cache.ts` (`CACHE_VERSION`) for semantic TypeScript enrichment changes: compiler-resolved aliases, nested schemas, callbacks, source refs, runtime joins, intelligence metadata, relations, lint facts, or compiler option meaning.
- `@crux/local`'s `packages/local/internal/devtools/catalog_cache.go` (`catalogCacheFormatVersion`) when a stale `.crux/cache/catalog/catalog.json` snapshot could hide a new read-model field or changed cache semantics after restart.

Refactors that only move semantic logic between analyzers without changing emitted facts do not require a cache version bump.

If a feature spans static facts, semantic facts, and the Go-owned catalog snapshot, bump all three. A normal rebuild/restart plus `crux catalog reindex` should pick up the migration; users should not need to delete `.crux/cache` manually.

## Public Entry Points

```ts
import { indexProjectCatalog } from '@crux/source-indexer'
import { SourceResolver } from '@crux/source-indexer/source-resolver'
```

Most applications should not import this package directly. It is primarily an internal dependency of Crux local devtools, documented as a separate package so the architecture boundary is explicit.
