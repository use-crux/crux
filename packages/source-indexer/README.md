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

## Public Entry Points

```ts
import { indexProjectCatalog } from '@crux/source-indexer'
import { SourceResolver } from '@crux/source-indexer/source-resolver'
```

Most applications should not import this package directly. It is primarily an internal dependency of Crux local devtools, documented as a separate package so the architecture boundary is explicit.
