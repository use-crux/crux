# Analysis Tiers And Semantic Read Model

Status: Accepted
Date: 2026-06-08

Crux needs static extraction, project-level analysis, and optional semantic/type-aware analysis, but
public extension authors should not depend on parser or TypeScript compiler internals. The Indexer
should follow compiler/linter practice: expose stable read models and keep engine-specific details
behind the compiler boundary.

**Decision**

Use explicit analysis tiers:

```ts
type AnalysisTier = 'syntax' | 'index' | 'semantic'
```

- `syntax`: file-local, parser-backed extraction with no project type information.
- `index`: project-level definitions, relations, diagnostics, lint findings, and source evidence.
- `semantic`: optional type/program-aware analysis. It is more expensive and must be requested by
  rules or host compiler policy.

Do not expose raw TypeScript AST or compiler objects as stable public API. Public extension authors
use extract patterns, stable readers, source refs, `IndexReadModel`, and `SemanticReadModel` instead.
Raw `ts.Node`, `ts.Program`, and `ts.TypeChecker` may exist only behind internal or explicitly
unstable first-party hooks.

Semantic analysis is exposed through a Crux-owned read model:

```ts
interface SemanticReadModel {
  resolveSymbol(ref: SourceReference): SemanticSymbol | undefined
  typeOf(ref: SourceReference): SemanticType | undefined
  referencesOf(symbol: SemanticSymbol): readonly SourceReference[]
}
```

Rules opt into semantic cost with `requires: ['semantic']`.

**Consequences**

The compiler can keep using TypeScript internally while preserving room for alternate parsers,
semantic engines, or partial semantic indexes later. Extension authors get semantic power without
freezing TypeScript AST shapes as the compatibility contract.

The compiler may use query-shaped internal passes and caches, but no public query API is exposed yet.
Public extensions declare stable `IndexDependency` values; the compiler owns cache keys,
memoization, invalidation, diagnostics replay, and cycle handling.
