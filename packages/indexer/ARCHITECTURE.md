# @crux/indexer Architecture

`@crux/indexer` turns authored project source into the Project Index facts served by
`@crux/local`. It owns static source discovery, semantic enrichment, source references, index
relations, index lint facts, and the source graph read model used to explain authored Crux systems.

The package should stay correctness-first: when source graph evidence is incomplete, stale, or
ambiguous, indexing must fall back to a full project reindex instead of publishing a partial index
that might omit affected facts.

## Accepted Target Architecture

The accepted pre-launch direction is to rename this package and its public model from **Source
Indexer / Project Index** to **Crux Indexer / Project Index**. The current code still uses
`@crux/indexer` and `ProjectIndex*` names until the rename implementation lands, but new
architecture decisions should use the target language:

- Public system name: **Crux Indexer**.
- Target package name: `@crux/indexer`.
- Output/read model: **Project Index**.
- Internal engine: **Project Index Compiler**.
- Extension ecosystem: **Indexer Extensions**.

The Indexer is a compiler-style project intelligence system, not an AST plugin framework. The public
extension contract should expose facts, relation specs, diagnostics, rules, and read models. The
compiler owns parser traversal, TypeScript internals, graph assembly, cache identity, diagnostics
policy, resolver/emitter internals, and output projection.

Static source extraction is composed behind `createStaticExtraction`. The engine owns the extension
runtime manifest, compiler-profile projection, parser call names, rule descriptors, source reader,
per-run parse memo, cache store, and deterministic cache identity. Cache identity includes extension
and extractor identities, compiler profile/projections, and the syntax frontend identity
`{ kind: 'syntax-frontend', name: 'typescript', version: ts.version }`, so TypeScript upgrades
invalidate static extraction structurally instead of relying only on manual epoch bumps.

Accepted public package surfaces after the rename:

- `@crux/indexer`
- `@crux/indexer/extensions`
- `@crux/indexer/testing`
- `@crux/indexer/source-resolver`

`@crux/indexer/testing` exposes source-text fixtures for extension authors. Fixtures use the same
static extraction engine as production with an in-memory `SourceReader` and `cache: 'none'`, which
keeps extension tests on the public source-text-to-facts path rather than hand-building parser-native
contexts.

Accepted non-public surfaces:

- compiler profiles and compiler-owned projections
- parser construction and AST internals
- graph builders
- resolver and emitter internals
- cache internals
- raw TypeScript `Program`, `TypeChecker`, and AST nodes

The accepted analysis tiers are:

```ts
type AnalysisTier = 'syntax' | 'index' | 'semantic'
```

`syntax` is file-local and parser-backed, `index` is project-level Project Index analysis, and
`semantic` is optional type/program-aware analysis exposed through a stable `SemanticReadModel`.
Rules opt into semantic cost with `requires: ['semantic']`; extension authors do not receive stable
raw TypeScript compiler objects.

See ADRs 0004-0007 for the accepted terminology, public extension contract, analysis tier, and
loading/trust decisions.

## Current Pipeline

```mermaid
flowchart TD
  A["Project root"] --> B["Project Index Compiler"]
  B --> C["Compiler Profile"]
  C --> D["Extension Runtime"]
  B --> E["Load compiler inputs"]
  E --> F["Select static source files"]
  F --> G["Discover compiler facts"]
  D --> G
  G --> H["Merge definitions and relations"]
  H --> I["Run index rules"]
  D --> I
  I --> J["Apply lint config and suppressions"]
  J --> K["Project source graph rows"]
  K --> L["Compiler result"]
  L --> M["ProjectIndexSnapshot"]
  L --> N["IndexPatch"]
```

The public package entry points are intentionally small:

- `indexProject(...)` creates a complete index snapshot.
- `indexProjectAst(...)` produces AST patch facts.
- `indexProjectSemantic(...)` produces semantic patch facts.
- `indexProjectIncremental(...)` consumes the incremental planner and produces ordered AST/semantic
  index patches, falling back to full indexing when graph evidence is unsafe.
- `compileProjectIndex(...)` exposes the compiler-owned result boundary for tests and worker
  orchestration.

Internally, `createProjectIndexCompiler(...)` creates an instance from a Compiler Profile. The
default `cruxCoreCompilerProfile` owns the first-party Crux extension manifest plus explicit
compiler-owned projections such as source-reference projection, runtime prepare projection, and
prompt/context tree path projection. Profiles keep extension execution instance-local; there is no
process-wide public extension registration.

The current foundation is intentionally not described as a pure compiler shell yet. Most first-party
syntax extraction runs through the Extension Runtime, including Convex agent compatibility,
constructor compatibility, and bare object-literal tool schema compatibility. The remaining
compiler-owned projections are parser/resolver responsibilities: source-reference helper projection,
runtime prepare projection, and prompt/context tree-path projection. These behaviors remain explicit
`CompilerOwnedProjection` values with cache identity until they either become internal extension/runtime
slots or are deliberately retained as compiler-owned parser responsibilities.

Semantic analysis remains compiler-owned internal analyzer code. Public extension authors should see
semantic capability through `SemanticReadModel` and `requires: ['semantic']`, not through raw
TypeScript `Program`, `TypeChecker`, or AST nodes. Static relation resolution is likewise
compiler-owned for now, exposed internally through a functional boundary while public resolver
authoring remains reserved.

Internal package code is organized around compiler responsibilities instead of keeping every engine
module in the `indexer/` root:

- `indexer/compiler/`: full-index compiler orchestration and compiler profiles.
- `indexer/static/`: source-local parsing, static fact extraction, static cache, static discovery, and
  compiler-owned static projections such as runtime prepare/use facts.
- `indexer/semantic/`: semantic fact orchestration, analyzer registry, semantic candidates, expression
  resolution, source refs, and data-access relation discovery.
- `indexer/lints/`: built-in index rule descriptors, lint finding generation, rule profiles, config,
  suppressions, and the first-party lint extension.
- `indexer/relations/`: relation policy types, grouped policy catalogs, relation lookup, and relation
  id/build helpers.
- `indexer/extensions/`, `indexer/extractors/`, `indexer/incremental/`, `indexer/graph/`, and
  `indexer/ast/`: existing compiler subdomains.

The root `indexer/` folder should stay reserved for small package-level orchestration and shared
compiler utilities such as config loading, project paths, source rows, patch contracts, merge helpers,
and public package entry shims. New static, semantic, lint, relation, graph, extension, or incremental
implementation code should land in the matching folder rather than creating another large root file.
Within each folder, keep orchestration files small and extract reusable projection, builder, evidence,
policy, or source-ref helpers once a file starts owning more than one compiler responsibility.

## Local Read-Model Boundary

The Project Index Compiler emits raw Project Index snapshots and patches. It does not own devtools
quality annotations. `@crux/local` stores those raw snapshots in `store.Store`; `Store.GetIndex()`
returns the raw value for cache writes, runtime snapshot merging, suite discovery, and other callers
that must not observe derived fields.

The devtools-facing read model is produced by `@crux/local/internal/indexread`. Its `Model.Index()`
is the single owner of derived `definition.quality` data and local metadata enrichment. The
`.crux/quality` filesystem contract is owned separately by `@crux/local/internal/qualityfs`; indexread
loads a `qualityfs.Snapshot` instead of parsing those files itself. The pipeline order is fixed:

1. Join in-memory eval, RAG eval, and flow runs from an atomic `Store.Snapshot()`.
2. Join file-backed quality records, cassettes, feedback, baselines, comparisons, drift, and lint
   policy from a `qualityfs.Snapshot`.
3. Add source mtime metadata and safety `appliesTo` metadata for local UI consumption.

This split keeps `@crux/indexer` responsible for authored source facts while `@crux/local` owns the
runtime/file-system read model consumed by HTTP, websocket snapshots, and the React devtools UI. New
`.crux/quality` parsing, overlay, or normalization rules belong in `internal/qualityfs`; new
`IndexQuality` aggregation rules belong in `internal/indexread`, not in `store`, `quality.Service`,
or devtools call sites.

Quality workbench insights are another local boundary: `quality.Service` loads a `qualityfs.Snapshot`
and observability-derived runs, then calls pure `deriveInsights` logic with an explicit clock. That
derivation must not move into `@crux/indexer` or `qualityfs`, because it combines runtime telemetry
with local quality snapshot state.

## Experimental Extension Boundary

The Project Index Compiler has an experimental Crux Indexer Extension boundary. The boundary uses
role-based compiler slots instead of exposing internal execution/cache phase names as API:

```mermaid
flowchart LR
  A["sources"] --> B["parsers"]
  B --> C["extractors"]
  C --> D["resolvers"]
  D --> E["rules"]
  E --> F["emitters"]
```

V1 wires current first-party static extractors through the extension registry while preserving the
stable `indexProject*` entry points. Normal extractors should emit immutable intermediate facts,
unresolved references, source refs, diagnostics, and dependency declarations. Resolver slots link
unresolved references into validated Project Index relations after definitions are known. Rules run
over resolved index facts. Emitters remain compiler-internal and produce snapshots, patches, source
rows, and reports.

The boundary is intentionally pure-functional at the slot level: extensions return values, and the
compiler owns validation, merge order, source graph projection, cache keys, patch invalidation, and
full reindex fallback. The executable boundary for this model should be an Extension Runtime: a
compiler-owned functional module that normalizes Crux Indexer Extension manifests, records
deterministic contribution identity, runs compiler slot contributions, and returns immutable result
objects. The runtime must not be a mutable plugin manager or global registry service.

First-party static extractors now emit immutable `ExtractedFacts` through the extension runtime, and
the parser projects those facts into the current index snapshot/patch contracts. Degraded extractor
diagnostics and declared source-file dependencies travel with the extracted facts so compiler output
and source rows can explain partial extraction. Production linting also executes through the internal
`rules` slot: `cruxCoreExtension` contributes the built-in index lint rule, and full plus
AST-partial indexing ask the Extension Runtime to run rules over resolved definitions and relations
before applying lint config and suppression policy. Project Index snapshots and AST patches also
carry `ruleDescriptors`, a metadata list for built-in rules and extension-provided rules whether or not
they fired findings. Index rules must declare metadata with docs, schema, and message ids before
registry construction succeeds. Some first-party helpers still use an unstable compiler-owned native
context for traversal-heavy TypeScript inspection. Raw TypeScript nodes are not a stable extension
API.

The stable static extractor context now has enough shared preparation for current first-party static
compiler work: `ctx.args` for factory arguments, `ctx.config` for object-literal/static JSON/schema
projection, and `ctx.sourceRef` for property, callback, schema, template interpolation, and helper
source refs. Prompt, context, tool, agent, composition, memory, routing, eval, flow, RAG, safety,
workspace, and scorer discovery are registered through `cruxCoreExtension`. Traversal-heavy modules
use internal unstable helpers that complement the extension boundary without becoming a public visitor
API.

The `@crux/indexer/extensions` subpath is experimental. It is documented so first-party
internals and tests can use the same shape that future external extension loading may adopt, but it
does not yet promise stable third-party plugin support.

Third-party loading is config-driven and allowlisted. `@crux/core` stores inert
`config({ indexer: { extensions, trust, rules } })` data for local tooling, and `@crux/indexer`
enforces that data when constructing a compiler runtime. The effectful loader preflights trust by
configured package name before import, resolves packages from the project root, reads the installed
package version from package metadata, imports the selected package export, and then delegates to the
pure resolver for manifest-name trust, requested package-version checks, manifest validation, and
`crux.indexer`/Project Index schema compatibility. There is no global registration, implicit package
discovery, or background side-effect hook.

`resolveIndexerExtensionReferences(...)` remains the pure manifest-only gate for tests and tooling
that already have extension objects. `loadIndexerExtensionReferences(...)` is the only public helper
that performs package resolution/import, and it should stay explicit about trust because importing a
Node package is code execution, not a sandbox.

The package export map intentionally exposes only `@crux/indexer`,
`@crux/indexer/extensions`, and `@crux/indexer/source-resolver`. Internal compiler and
indexer modules are reached by relative imports inside the package so they do not accidentally become
third-party API.

### Extension Runtime

The Extension Runtime is the functional execution boundary for Crux Indexer Extensions. It lives
behind internal compiler imports and keeps the public experimental extension authoring barrel focused
on authoring helpers rather than runtime control.

The runtime is functional and value-oriented:

- Inputs are readonly compiler views, extension manifests, and fact packets.
- Outputs are discriminated runtime results, diagnostics, dependency declarations, and immutable
  facts.
- Runtime manifests expose deterministic extension/extractor/rule identities and cache inputs.
- Static cache keys combine source hashes, import dependency hashes, config boundary hashes,
  extension runtime identity, compiler profile identity, and compiler-owned projection identity. The
  remaining manual invalidation levers are explicit epochs in `indexer/cache-identity.ts`.
- Semantic cache keys combine the analyzed source closure, config boundary hashes, TypeScript
  version, and semantic compiler-options identity. Semantic fact-format changes use
  `SEMANTIC_FACTS_CACHE_EPOCH`; Go-owned persisted snapshots use `projectIndexSnapshotCacheEpoch`
  in `@crux/local`.
- No extension code receives graph builders, cache handles, mutable diagnostics arrays, or stable raw
  TypeScript AST APIs.
- Existing compatibility helpers delegate to the runtime during migration, but the runtime is the
  architectural boundary for slot execution.
- Runtime construction happens from a Compiler Profile, so tests and future loaders can create
  isolated compiler instances without mutating global registry state.

The first runtime implementation is behavior-preserving and scoped to static extraction plus
runtime-adjacent compatibility helpers:

- `extractStatic(...)` runs static extractor contributions and returns `no-match`, `none`, `matched`,
  or `degraded` results.
- `staticFoundDefinitionFromStaticExtractionResult(...)` projects runtime facts into the current
  static parser compatibility shape.
- Relation binding is owned by `resolveRelationModel(...)` in `indexer/relations/`, so static
  extractor references, project-scope relation facts, policy validation, diagnostics, and read-model
  enrichment pass through one compiler-owned facade instead of extension-runtime compatibility
  helpers.
- `checkRules(...)` runs internal index rule contributions in deterministic extension/rule order and
  returns `IndexLintFinding` values for downstream config/suppression filtering.
- Rule metadata is validated at registry construction time. Malformed rules fail before source
  discovery starts.
- Rule identities are included in runtime cache inputs as `{ kind: "rule", extension, name }` so future
  query/incremental caches can invalidate rule output when first-party rule behavior changes.

The runtime does not pull semantic enrichment, incremental execution, or source resolver behavior into
extension code. Public loading constructs additional compiler runtimes from allowlisted package
manifests, but semantic analyzers, parser traversal, resolver internals, emitters, cache writes, and
snapshot projection remain compiler-owned.

## Source Resolver Boundary

The source resolver is part of this package because it needs to run near local project artifacts, but
it is not part of Project Index indexing. It supports runtime trace and span inspection in
devtools:

```mermaid
flowchart TD
  A["Devtools trace source"] --> B["Go /api/resolve-source"]
  A --> C["Go /api/resolve-fn-source"]
  B --> D["source-resolver.mjs"]
  C --> D
  D --> E["SourceResolver facade"]
  E --> F["source map discovery"]
  E --> G["trace-map lookup"]
  E --> H["original source loading"]
  E --> I["function extraction"]
```

This boundary should stay distinct from `project-indexer.mjs`:

- Project indexing is ahead-of-time index construction over authored project files.
- Source resolution is lazy runtime lookup from bundled file, line, and column positions.
- Index source refs can enrich project intelligence, but they do not replace source-map lookup for
  bundled runtime frames.

The stable import remains `@crux/indexer/source-resolver`. Internally, the implementation is
organized as a small stateful facade over pure functional modules:

- `source-resolver/filesystem.ts`: injected filesystem effects.
- `source-resolver/discovery.ts`: source-map discovery and path normalization.
- `source-resolver/trace-map.ts`: trace-map parsing and original position lookup.
- `source-resolver/original-source.ts`: `sourcesContent` and disk fallback loading.
- `source-resolver/extraction.ts`: function-like source extraction.
- `source-resolver/cache.ts`: cache keys, limits, and eviction policy.
- `source-resolver/protocol.ts`: JSON-line worker request parsing and response serialization.
- `source-resolver/resolver.ts`: `SourceResolver` compatibility facade.

The facade may hold cache state for runtime efficiency. Helper modules should remain documented,
mostly pure, and directly testable.

## Source Graph Read Model

The durable graph currently exposed to callers is `ProjectIndexSnapshot.sources`. Each
`IndexSourceFile` row records:

- `file`: the authored source path.
- `definitionIds`: index definitions produced by the file.
- `dependencies`: source files this file imports or references.
- `dependents`: source files that depend on this file.
- `diagnostics`: indexer diagnostics attached to the file.

This read model is intentionally plain JSON so it can cross the TypeScript worker and Go runtime
boundary. Internally, `indexer/graph` uses branded IDs and maps to construct the richer graph before
projecting it back into index source rows.

```mermaid
flowchart LR
  A["ProjectDefinition"] --> B["IndexGraphBuilder"]
  C["ProjectRelation"] --> B
  D["IndexDiagnostic"] --> B
  E["Discovery dependencies"] --> B
  F["Definition sourceRefs"] --> B
  B --> G["IndexGraph"]
  G --> H["ProjectIndexSnapshot.sources"]
```

## Incremental Planner and Executor

Incremental indexing is split into a pure planner and an executor. The planner decides what a file
change would affect. The executor either turns planner-approved closures into exact-invalidation
patches or delegates unsafe decisions to the existing full indexing paths.

```mermaid
flowchart TD
  A["Changed files"] --> B["planIndexFiles"]
  B --> C["Normalize and classify files"]
  C --> D["Build graph read model from previousIndex.sources"]
  D --> E["Safety gates"]
  C --> E
  E -->|unsafe or incomplete| F["Full reindex decision"]
  E -->|safe graph evidence| G["Reverse dependency closure"]
  G --> H["Affected files"]
  H --> I["Affected definition ids"]
  I --> J["Incremental plan decision"]
  F --> K["Explainable decision"]
  J --> K
  K --> L["Return plan only"]
```

The planner exists to establish the same invariant used by compilers and build systems:

> A partial plan is allowed only when the graph can explain the affected closure. Otherwise the
> planner must request a full reindex.

The current implementation uses `previousIndex.sources` as graph evidence. Later work may add richer
graph evidence without changing the high-level planner contract.

## Planned Incremental Layers

```mermaid
flowchart TD
  A["Index source rows"] --> B["Import dependency graph"]
  B --> C["Export and barrel graph"]
  C --> D["Definition ownership graph"]
  D --> E["Source-ref support graph"]
  E --> F["Semantic fact graph"]
  F --> G["Fingerprint graph"]
  G --> H["Partial AST and semantic execution"]
```

The planner should scale by improving graph evidence in layers:

1. **Index source rows**: existing durable graph rows in `previousIndex.sources`.
2. **Import dependency graph**: static import edges, including path aliases when the resolver proves
   the target.
3. **Export and barrel graph**: edges that distinguish re-export files from definition-owning files.
4. **Definition ownership graph**: mapping of definitions to producing and contributing files.
5. **Source-ref support graph**: schema, callback, template, and helper source references that
   contribute metadata without always producing definitions.
6. **Semantic fact graph**: TypeScript-resolved aliases, schemas, callbacks, and relation facts.
7. **Fingerprint graph**: content and config hashes that support reusing cached facts.

Each layer should be additive. Missing evidence at any layer reduces optimization, not correctness.

## Planner Decisions

Planner decisions should be a discriminated union with stable reason codes. The exact TypeScript
names can evolve, but the architecture should preserve these categories:

- `full-reindex-required`: graph evidence is missing, ambiguous, stale, or a broad boundary changed.
- `source-file-reindex`: changed files are known leaves with locally owned index facts.
- `dependency-closure-reindex`: changed files affect known dependents through the reverse source graph.
- `semantic-closure-reindex`: typed vocabulary for future source-ref or checker-backed facts that
  require semantic enrichment; defined and explainable before it is emitted.
- `noop`: future category for changes proven irrelevant to index output.

Every decision should include normalized changed files, affected files, affected definition IDs when
known, graph confidence, and an explanation payload suitable for worker logs.

`semantic-closure-reindex` remains reserved planner vocabulary. Current semantic partial execution is
file-closure based: it enriches known index-owning files and semantic source-ref support rows inside
planner-approved AST closures. Checker-only closure decisions should still fall back until durable
semantic graph evidence can prove the affected set.

`noop` is documented as a future category only. The first planner implementation should not emit it
because a false no-op can silently preserve stale index facts.

## Safety Gates

The planner must return `full-reindex-required` when any of these conditions apply:

- No previous index is available.
- The previous index has no source rows or no dependency/dependent evidence.
- A config, compiler, package manifest, or lockfile changed.
- A changed source file is not represented in the previous graph.
- A dependency target cannot be resolved with confidence.
- A deleted file cannot be mapped back to previous graph ownership.
- The affected closure exceeds a configured budget.
- The graph contains unresolved import diagnostics relevant to the changed files.

Dynamic imports, side-effect imports, path alias oddities, generated files, deleted files, and config
changes are reliability hazards only if treated optimistically. The intended behavior is conservative:
fallback first, optimize later when graph evidence can prove the affected closure.

```mermaid
flowchart TD
  A["Potential partial plan"] --> B{"Can graph evidence prove closure?"}
  B -->|Yes| C["Return partial plan"]
  B -->|No| D["Return full reindex"]
  D --> E["Correct but slower"]
  C --> F["Correct and faster"]
```

## Proven Architecture Basis

The planner should follow established incremental architecture rather than invent a Crux-specific
shortcut.

| System                                               | Architecture lesson                                                                                          | Crux equivalent                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| TypeScript project references and incremental builds | Persist graph/build metadata and explain up-to-date decisions separately from compilation.                   | Use index source rows as graph metadata, then execute indexing in later phases.         |
| Bazel Skyframe                                       | Invalidate reverse dependencies from changed inputs; undeclared dependencies make incremental reuse unsound. | Walk `dependents` from changed files and fall back when dependencies are not declared.  |
| rustc query system                                   | Track query dependencies and fingerprints so unchanged facts can stay green.                                 | Future static, semantic, and lint facts can become independently reusable graph facts.  |
| ESLint cache                                         | Separate changed-file classification and cache strategy from lint execution.                                 | Keep file classification and invalidation planning separate from AST/semantic indexing. |
| Nx and Turborepo                                     | Use explicit project/task graphs to compute affected work before executing tasks.                            | Compute affected source/index work before partial index workers run.                    |

## Testing Strategy

Planner work should use vertical TDD slices through the public planner interface:

1. Missing graph data returns a full reindex decision.
2. A known source leaf returns a source-file plan.
3. A changed dependency walks reverse dependents deterministically.
4. Config and compiler boundary changes return full reindex.
5. Unknown or deleted files return full reindex unless previous ownership is provable.
6. Explanation generation handles every decision kind exhaustively.

Tests should verify behavior through public planner functions, not private traversal helpers. Type-level
tests or `never` exhaustiveness checks should protect discriminated-union handling.

## Implementation Boundaries

The incremental planner is not the incremental executor. Planner modules stay pure and explainable;
executor modules own analyzer calls, patch construction, fallback routing, and execution reports.

The Go runtime remains the read-model owner. The `project-indexer.mjs` worker exposes
`indexProjectIncremental`; `@crux/local` can call it with a previous index plus changed/deleted
files, then apply the returned ordered patches through the same index patch state used by AST and
semantic refreshes.

## Incremental Execution Architecture

The production execution phase wires the planner into an executor that keeps full indexing as the
reference implementation. Incremental execution is a smaller invalidated run through the same static
AST analyzers, TypeScript semantic analyzers, merge functions, lint analyzers, graph builder, and
patch application semantics.

```mermaid
flowchart TD
  A["File events"] --> B["Incremental planner"]
  B -->|unsafe| C["Full reindex"]
  B -->|safe source closure| D["Exact invalidation"]
  D --> E["Partial static AST executor"]
  E --> F["Apply AST patch"]
  F --> G["Partial TypeScript semantic executor"]
  G --> H["Apply semantic patch"]
  H --> I["Rebuild affected source rows"]
  I --> J["Index lint over merged graph"]
  J --> K["Execution report"]
```

The executor should follow proven incremental-system patterns:

| Proven system                 | Production lesson                                                                     | Crux execution rule                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| TypeScript builder programs   | Reuse diagnostics/work only when changed files and cascading dependencies are known.  | Execute semantic work over the planner's affected closure first; consider builder-program reuse later. |
| Bazel Skyframe                | Reads outside the dependency graph break incremental correctness.                     | Every analyzer dependency must be recorded in query fingerprints or force fallback.                    |
| rustc/Salsa red-green queries | A changed input can still keep dependents reusable when its output is unchanged.      | Add output equality reuse after file-level partial execution is proven equivalent to full indexing.    |
| ESLint cache                  | Content-hash cache strategy is safer than mtime-only detection across git operations. | Fingerprint source/config content, not only file metadata.                                             |
| Turborepo                     | Cache hits require deterministic tasks with declared inputs and outputs.              | Model static, semantic, lint, and source-graph facts as deterministic query records.                   |

Initial query records should stay file-level:

- `StaticParse(file)`: source hash, parser/extractor version, config boundary hashes, resolved import
  target hashes -> definitions, relations, source refs, diagnostics, dependency edges.
- `SemanticAnalyze(file, analyzer)`: source hash, analyzer version, TypeScript version, compiler
  options hash, resolved module graph hash, static candidate hash -> semantic definition patches,
  relations, source refs, diagnostics.
- `IndexLint(ruleProfile)`: extension rule outputs over merged definitions/relations plus lint
  config/suppressions -> lint findings.
- `SourceGraph(component)`: affected rows, dependency edges, ownership maps -> normalized
  `IndexSourceFile` rows and a trusted `sourceGraph` marker.

The executor must preserve these invariants:

- A partial patch must declare exact `invalidates.files` and `invalidates.definitionIds`.
- Patch application must remove stale file-owned, definition-owned, diagnostic, source-ref, relation,
  source-row, and lint facts before merging replacements.
- Go index patch application must honor exact invalidation before merge, including definitions,
  relations, diagnostics, lint findings, source rows, and phase ownership maps.
- Index-level lint runs after the partial static/semantic patches are merged because it depends on
  the merged graph.
- Source graph rows for affected files and direct neighbors are rebuilt together so dependency and
  dependent edges remain symmetric.
- If any analyzer reads unregistered input, any cache fingerprint is incomplete, or any graph marker
  capability cannot be preserved, the executor falls back to full reindex.

The rollout should begin in shadow mode: compute the partial patches, apply them to the previous
index state in memory, compare the normalized result to a full reindex in tests and diagnostic runs,
and publish partial results only after equivalence is stable across fixtures.

Implemented v1 behavior:

- `indexProjectIncremental({ mode: 'ast' })` emits exact-invalidation AST patches for
  `source-file-reindex` and `dependency-closure-reindex` decisions.
- `indexProjectIncremental({ mode: 'ast-and-semantic' })` emits the AST patch followed by semantic
  enrichment for known index-owning source files and semantic source-ref support files in the
  affected closure.
- Unsafe plans, old snapshots, unknown files, config changes, unsupported semantic closures, and
  incomplete graph evidence fall back to full indexing.
- Safe deleted leaf files emit invalidation-only AST patches.
- Execution reports are JSON-safe and include planner kind, fallback reason, affected files,
  affected definitions, parsed/analyzed files, invalidation, and cache counters.
- The devtools Go patch applier supports exact file/definition invalidation and source-row union
  merging, so runtime partial patches no longer require all-or-nothing invalidation.
- The local project index worker and devtools service have an incremental bridge. The service falls
  back to full reindex if no previous source graph or incremental-capable worker is available.

Known v1 boundary:

- First-run semantic support files, such as schema modules that have not yet been seen by semantic
  enrichment, are still `unknown-file` planner fallbacks. After semantic enrichment emits source-ref
  support rows, those files become durable graph nodes and can participate in partial semantic
  reindexing.
- HTTP/API delta triggering is wired through `POST /api/project/index/reindex` and
  `POST /api/index/reindex` when the request body includes `files` or `deletedFiles`.
- `crux dev` starts a Go `fsnotify` watcher after the initial full index reindex succeeds. The
  watcher recursively registers project directories, ignores generated/cache directories, debounces
  event bursts, coalesces changed/deleted file sets, and feeds a single-flight incremental reindex
  runner so index refreshes never overlap.

For the durable implementation checklist and slice-by-slice TDD plan, see
[docs/incremental-planner-execution-plan.md](./docs/incremental-planner-execution-plan.md).
