# Public Indexer Extension Contract

Status: Superseded
Date: 2026-06-08

Superseded by the implemented package-surface contract: the package root exposes Crux-owned compiler
contracts, while the experimental `@use-crux/indexer/extensions` authoring surface exposes only
extractors and relation declarations. Third-party rules remain reserved.

Crux will expose a small data-first Indexer extension contract instead of a general compiler plugin
API. Extension authors should contribute facts, relation specs, and analyses. The Project Index
Compiler owns traversal, parser internals, graph assembly, cache identity, diagnostics policy,
resolution, suppression, and output projection.

**Decision**

The original proposal described the public authoring surface as:

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

- `@use-crux/indexer`
- `@use-crux/indexer/extensions`
- `@use-crux/indexer/testing`
- `@use-crux/indexer/source-resolver`

Do not expose `@use-crux/indexer/compiler`, `@use-crux/indexer/indexer/*`, or `@use-crux/indexer/ast`.

**Extractor Contract**

Extractors are syntax-local and return immutable results:

```ts
type ExtractResult =
  | { kind: "facts"; facts: ExtractedFacts }
  | { kind: "none"; dependencies?: readonly IndexDependency[] }
  | {
      kind: "degraded";
      diagnostics: readonly IndexDiagnostic[];
      partialFacts?: ExtractedFacts;
      dependencies?: readonly IndexDependency[];
    };
```

Source-level misses and partial extraction should degrade into diagnostics and dependencies when the
compiler can safely continue. Invalid extension declarations fail before indexing starts.

**Rule Contract**

Rules follow an ESLint-style metadata contract:

```ts
interface IndexRule<TOptions = unknown> {
  name: RuleName;
  meta: IndexRuleMeta<TOptions>;
  requires?: readonly AnalysisTier[];
  run(ctx: IndexRuleContext<TOptions>): readonly IndexLintFinding[];
}
```

Metadata includes docs, message ids, option schema, default options, and stability. Rules return
deterministic findings and must not mutate the Project Index, graph, diagnostics arrays, caches, or
source files.

**Consequences**

The implemented public extension support starts with extractors and relation specs. Rules, resolvers,
emitters, parser hooks, custom source providers, and query engines remain reserved until the Project
Index graph model has proven stable.

Third-party names for relations, named diagnostic categories, and future derived views must be
package-prefixed, such as `@acme/crux-indexer/no-missing-description`. Crux owns `@use-crux/*` and any
explicitly reserved core namespace.

The testing harness is part of the public contract. `@use-crux/indexer/testing` provides extractor
fixtures, manifest validation, namespace conflict tests, degraded extraction fixtures, and cache
invalidation fixtures. Rule execution and rule-test authoring remain compiler-owned.
