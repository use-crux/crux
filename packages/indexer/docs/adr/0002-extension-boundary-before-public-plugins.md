# Extension Boundary Before Public Plugins

`@use-crux/indexer` will introduce a pure functional extension boundary for first-party index extraction before adding public plugin loading. Crux Indexer Extensions will be shaped around compiler slots such as sources, parsers, extractors, resolvers, rules, and emitters; extensions will emit immutable extracted facts and relation specs, while Crux keeps parser internals, validation, merge order, source graph projection, cache keys, and index patching inside the Project Index Compiler.

**Considered Options**

- Publish the current extractor registry shape as the plugin API.
- Build a full query compiler and external plugin loader immediately.
- Add a query-ready extension boundary now, migrate first-party internals through it, and defer public loading until the boundary is proven.

The query-ready extension boundary is the chosen trade-off because it avoids freezing TypeScript AST internals as public API, keeps issue #9 implementable, and preserves the foundation needed to later model source discovery, parsing, extraction, resolution, index rules, graph projection, and patch emission as deterministic compiler queries without another architectural refactor.

**Consequences**

The extension boundary has an explicit Extension Runtime before public plugin loading. The runtime is the compiler-owned functional executor for Crux Indexer Extension contributions: it normalizes manifests, validates relation specs, records deterministic contribution identity, runs compiler slot contributions, and returns immutable runtime results. It is not a mutable plugin manager, process-wide registry, or loader-coupled service.

Normal extractors must return facts instead of mutating graph, cache, diagnostics, or index state. Any imperative shell should stay at the Project Index Compiler, filesystem, cache, or future loader boundary.

Extractors should stay source-local where possible: they emit definitions and unresolved references, while resolver slots link those references into validated Project Index relations. This preserves the compiler-style split between extraction and binding and keeps file-local extraction cacheable for incremental indexing.

The extension vocabulary will use role-based compiler slots rather than internal execution/cache phase names. The durable slot model is:

- `sources`: discover or provide source candidates.
- `parsers`: turn source content into compiler-owned source views.
- `extractors`: emit intermediate definitions, unresolved references, local source refs, and diagnostics.
- `resolvers`: link unresolved references into validated relations and cross-file/source refs.
- `rules`: produce index diagnostics and lint findings over resolved facts.
- `emitters`: produce snapshots, patches, source graph rows, reports, or other artifacts.

V1 should make extractor, resolver, rule, relation-spec, dependency, and intermediate-fact foundations real enough that current first-party internals can move onto them. Custom source providers, custom parsers, public resolver authoring, and custom emitters may remain internal or reserved until the boundary is proven.

Extension output should use intermediate types, not final serialized index read-model types. The Project Index Compiler normalizes intermediate facts into `ProjectDefinition`, `ProjectRelation`, `ProjectSourceRef`, diagnostics, lint findings, source rows, snapshots, and patches. This keeps extension authoring stable while index serialization evolves.

Traversal is not the stable extension model. Crux may keep internal, unstable traversal helpers for first-party migrations that need complex AST walks, such as flows or routing, but the extension boundary should stay fact-oriented and parser-neutral. Public traversal would freeze parser details too early and make TypeScript AST shape part of the plugin contract.

Extension ordering should be derived from compiler slots and declared dependencies. V1 should avoid user-controlled before/after ordering; within a slot, execution should be deterministic by extension and contribution identity unless a later ADR records a stronger dependency model.

Failure handling should distinguish setup from source-level diagnostics: invalid first-party extension declarations fail registry construction, while source-local extraction or resolution failures should degrade to diagnostics when the compiler can safely continue. Unsafe or incomplete dependency evidence should still force the existing full reindex fallback.

The first runtime implementation is behavior-preserving and scoped to static extraction plus internal compatibility boundaries. Registry normalization, static extractor dispatch, TypeScript-to-context adaptation, result/degraded diagnostics policy, compatibility projection, runtime cache identity, built-in static reference resolution, and internal index rule execution live behind the runtime before query, loader, or public plugin behavior is expanded.

The first implementation should keep any exported extension authoring surface experimental. Old and new extractors may coexist during migration, with deterministic dedupe preserving current index behavior. Introducing extension identity/version into static cache keys should bump the static cache version. Public docs may describe the experimental boundary, but must not promise stable third-party plugin support until first-party migration proves the API.
