# Public Indexer Extension Contract

Status: Accepted
Date: 2026-06-08

Crux will expose a small data-first Indexer extension contract instead of a general compiler plugin
API. Extension authors should contribute facts, relation specs, and analyses. The Project Index
Compiler owns traversal, parser internals, graph assembly, cache identity, diagnostics policy,
resolution, suppression, and output projection.

**Decision**

The stable public authoring surface is limited to:

- `IndexerExtension`
- `IndexExtractor`
- `IndexRule`
- `IndexRuleMeta`
- `RelationSpec`
- `IndexDiagnostic`
- `IndexDependency`
- `IndexReadModel`
- `SemanticReadModel`

Compiler profiles, compiler-owned projections, parser construction, graph builders, resolver internals,
emitter internals, cache internals, raw TypeScript AST nodes, `Program`, and `TypeChecker` remain
host-only or internal.

The public package surface after the rename is:

- `@crux/indexer`
- `@crux/indexer/extensions`
- `@crux/indexer/testing`
- `@crux/indexer/source-resolver`

Do not expose `@crux/indexer/compiler`, `@crux/indexer/indexer/*`, or `@crux/indexer/ast`.

**Extractor Contract**

Extractors are syntax-local and return immutable results:

```ts
type ExtractResult =
  | { kind: 'facts'; facts: ExtractedFacts }
  | { kind: 'none'; dependencies?: readonly IndexDependency[] }
  | {
      kind: 'degraded'
      diagnostics: readonly IndexDiagnostic[]
      partialFacts?: ExtractedFacts
      dependencies?: readonly IndexDependency[]
    }
```

Source-level misses and partial extraction should degrade into diagnostics and dependencies when the
compiler can safely continue. Invalid extension declarations fail before indexing starts.

**Rule Contract**

Rules follow an ESLint-style metadata contract:

```ts
interface IndexRule<TOptions = unknown> {
  name: RuleName
  meta: IndexRuleMeta<TOptions>
  requires?: readonly AnalysisTier[]
  run(ctx: IndexRuleContext<TOptions>): readonly IndexLintFinding[]
}
```

Metadata includes docs, message ids, option schema, default options, and stability. Rules return
deterministic findings and must not mutate the Project Index, graph, diagnostics arrays, caches, or
source files.

**Consequences**

Public extension support starts with extractors, rules, and relation specs. Public resolvers,
emitters, parser hooks, custom source providers, and query engines remain reserved until the Project
Index graph model has proven stable.

Third-party names for rules, relations, named diagnostic categories, and future derived views must be
package-prefixed, such as `@acme/crux-indexer/no-missing-description`. Crux owns `@crux/*` and any
explicitly reserved core namespace.

The testing harness is part of the public contract. `@crux/indexer/testing` should provide extractor
fixtures, rule tests, manifest validation, namespace conflict tests, degraded extraction fixtures,
and cache invalidation fixtures.
