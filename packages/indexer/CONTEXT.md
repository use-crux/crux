# Crux Indexer

Crux Indexer is the Crux context that turns authored project files into a Project Index for local
devtools. The current implementation still contains `indexer` package names and
`ProjectIndex*` type names, but the accepted pre-launch terminology is **Indexer** and **Project
Index**.

## Language

**Crux Indexer**:
The public system that derives project intelligence from authored Crux source.
_Avoid_: indexer, index system, plugin runtime

**Project Index**:
The read model of authored Crux definitions, relations, source files, diagnostics, semantic facts,
and lint findings.
_Avoid_: index, registry, knowledge graph

**Project Index Snapshot**:
The raw Project Index value stored by `@use-crux/local` and written to cache. It contains compiler and
runtime snapshot facts, but not derived quality annotations.
_Avoid_: enriched index, devtools read model

**Project Index Read Model**:
The devtools-facing Project Index produced by `@use-crux/local/internal/projectindex/readmodel`. It
starts from a Project Index Snapshot and joins in-memory runs, file-backed quality records, source
mtimes, and safety target metadata.
_Avoid_: store index, quality pass, hidden enrichment

**Resolved Project Model**:
The user-facing project shape assembled from Project Index source facts, local filesystem
conventions, runtime evidence, and explicit policy config. It records provenance for inferred versus
explicit values.
_Avoid_: central registry, dashboard config, hidden setup

**Tooling Policy Config**:
Optional config that changes discovery policy, lint policy, extension trust, cloud/training upload,
or other boundaries. It does not complete ordinary authored primitive wiring.
_Avoid_: primitive registry, prompts list, stores list, memories list

**Duplicate Registration Trap**:
Requiring a user to define a prompt/context/tool/memory/retriever/store relationship in code and then
repeat the same relationship in `crux.config.ts` before local tooling can see it.
_Avoid_: config convenience, registration requirement

**Project Index Compiler**:
The internal compiler engine that derives Project Index facts from authored project files.
_Avoid_: plugin manager, indexing pipeline

**Compiler Slot**:
A role-based contribution point in the Project Index Compiler, such as source, parser, extractor,
resolver, rule, or emitter.
_Avoid_: static hook, semantic hook, lifecycle callback

**Compiler Profile**:
A host-only compiler configuration that bundles first-party Indexer Extensions and compiler-owned
compiler-owned projections into one runtime profile.
_Avoid_: plugin preset, global registry

**Compiler Intrinsic**:
A compiler-owned source pattern or projection that is explicit in a Compiler Profile but is not public extension authoring API.
_Avoid_: hidden special case, parser magic

**Compiler Result**:
An immutable Project Index Compiler output value containing facts, diagnostics, lint findings, source
rows, and graph evidence before snapshot or patch projection.
_Avoid_: session state, mutable accumulator

**Extension Runtime**:
The compiler-owned functional executor that normalizes Indexer Extensions and runs their Compiler
Slot contributions deterministically.
_Avoid_: plugin manager, mutable registry service

**Index Source Row**:
A durable Project Index row describing one source file and its known definitions, dependencies,
dependents, and diagnostics.
_Avoid_: file node, source cache entry

**Extension Boundary**:
The contract where Indexer capabilities contribute Project Index facts without exposing parser,
graph, cache, or TypeScript internals.
_Avoid_: AST plugin API, extractor internals

**Indexer Extension**:
A named contribution to the Project Index Compiler that declares the Index facts, rules, or relation
semantics it can produce.
_Avoid_: plugin, registry entry

**Extracted Fact**:
An immutable Project Index contribution emitted before it is validated, merged, and projected into the
Project Index.
_Avoid_: mutation, graph write

**Unresolved Reference**:
An extracted Project Index reference that has not yet been linked to a concrete Project Index
definition or relation.
_Avoid_: relation, edge

**Resolved Relation**:
A Project Index relation produced after reference resolution validates and links extracted
references.
_Avoid_: relation ref, unresolved edge

**Relation Spec**:
A package-namespaced extension declaration of the meaning and allowed endpoints for a Project Index
relation type.
_Avoid_: relation registry entry, edge config

**Index Rule**:
An Indexer Extension contribution with metadata that analyzes resolved definitions and relations and
returns Project Index lint findings.
_Avoid_: lint hook, graph mutation

**Analysis Tier**:
The declared analysis cost/capability level for a rule or compiler pass: `syntax`, `index`, or
`semantic`.
_Avoid_: static hook, lifecycle phase

**Static Index**:
The source-only Project Index lane that produces source graph rows, definitions, references,
diagnostics, lint facts, and semantic source-profile handoff without TypeScript type checking. It is
the product responsibility that may be implemented by TypeScript today and Rust/Oxc later.
_Avoid_: static-index, AST phase, native AST compiler

**Static Syntax**:
File-local parser evidence consumed by the Static Index lane before facts are projected into the
Project Index. Static Syntax may come from a TypeScript parser or an Oxc Syntax Frontend, but callers
should not couple to either parser's raw AST objects.
_Avoid_: raw AST, nativeAst, parser plugin payload

**Semantic Read Model**:
A stable read-only facade for type/program-aware analysis.
_Avoid_: TypeScript TypeChecker, raw AST access

**Semantic Backend**:
A compiler-owned implementation that emits compiler-free **Semantic Evidence** through the same
`SemanticBackend` contract. TypeScript compiler API is the correctness baseline; the native backend
matches the current semantic fact contract but remains experimental until its native engines,
upstream API stability, and benchmark confidence justify switching defaults.
_Avoid_: TypeScript mode, checker plugin

**Static Syntax Frontend**:
The implementation-specific parser frontend that emits **Static Syntax** for the **Static Index**.
It is JavaScript today and can move to Rust/Oxc later without changing semantic backend or extension
contracts.
_Avoid_: semantic backend, type checker, nativeAst

**TypeScript Local Worker Package**:
The private package that owns Local's TypeScript worker bundle entrypoints for Project Index source,
semantic, runtime, and compatibility work.
_Avoid_: UI package worker owner, UI package worker scripts

**Semantic Scope**:
The file set, previous index snapshot, and source-graph dependency closure handed from static/source
indexing to semantic enrichment. It lets semantic backends skip duplicate discovery while preserving
cache identity and budget checks.
_Avoid_: broad project rescan, semantic registry

**Semantic Source Profile**:
The preflight artifact for a **Semantic Scope**. It contains the closure, source byte counts, source
hashes, and transient source text read before backend execution. The semantic service shares it with
backend caches and native projectors so source scanning, cache identity, and native coverage checks do
not each reread the same files. It may be produced inside the JavaScript worker today or handed over
from Go/native syntax frontends later.
_Avoid_: semantic cache key, AST snapshot

**Native Semantic Engine**:
The backend-owned implementation behind `experimental.indexer.native`. The first engine is
TypeScript-Go (`engine: 'tsgo'`), but the public product concept is native indexing rather than a
TypeScript-Go-specific mode. Future Rust or mixed engines must emit the same **Semantic Evidence**.
_Avoid_: public tsgo backend, native plugin API

**Semantic Evidence**:
Backend-neutral rows produced by semantic analyzers and projected into Project Index facts by the
shared semantic service. Evidence is Crux-shaped, not TypeScript-AST-shaped, so extensions and
workers can run against TypeScript, TypeScript-Go, or a future native backend without changing their
public contracts.
_Avoid_: compiler node payload, checker symbol API

**Native Semantic Projector**:
A backend-owned fast path that lowers a proven source shape directly from a native compiler AST into
**Semantic Evidence**. It is only allowed when normalized Project Index facts exactly match the
TypeScript backend for that shape; unsupported syntax must route to the native shared analyzer path
instead of emitting partial native facts or falling back to the JavaScript TypeScript backend.
Current first-party direct coverage includes prompt/context/tool schema and source refs,
prompt/context `use` and `tools` dependency facts, agent prompt/tool/model-routing/callback config
refs and literal handoff relations, and local
`router`/`split`/`retry`/`cascade`/`fallback` parent and child definitions, containment and target
relations, callback refs, routing target source refs, router/split context evidence, and literal route
call-profile facts.
_Avoid_: separate tsgo feature set, native-only semantics

**Native Shared Analyzer**:
The completeness path inside the native **Semantic Backend**. It handles semantic shapes that are not
safe for direct native projectors while still using native backend ownership and the shared semantic
evidence contract.
_Avoid_: JavaScript fallback, partial native coverage

**Semantic Facts Cache**:
The projected semantic fact cache keyed by semantic source profile, backend identity, TypeScript and
compiler-option identity, and explicit epoch. Current writes use the binary local envelope after the
`semantic-facts-v23` hard migration.
_Avoid_: legacy JSON cache, backend-agnostic cache blob

**Runtime Index**:
Runtime-observed Project Index facts and diagnostics produced from local execution evidence rather
than authored source alone. Runtime Index data enriches the local runtime read models without
changing Static Index or Semantic Backend ownership.
_Avoid_: static index, semantic backend, devtools-only annotation

**Native Direct Primitive Manifest**:
Internal compiler data that describes the subset of primitive projection behavior a native projector
can prove without the shared analyzer: call names, definition identity fields, schema properties,
dependency relations, source-ref roles, and supported local reference forms. It is not a public
extension API; it is the way first-party native fast paths avoid hidden hardcoded primitive branches.
_Avoid_: native plugin manifest, tsgo primitive registry

**Experimental Indexer Config**:
The top-level `experimental.indexer` config bucket for unstable Crux Indexer behavior, currently
`experimental.indexer.native: true | { engine?: 'tsgo'; tsserverPath?: string }` for semantic
backend experiments and `experimental.indexer.nativeAst: true | { frontend?: 'oxc' }` for Static
Syntax experiments.
_Avoid_: indexer.semantic backend config, public unstableApi flag

**Internal Traversal Helper**:
An unstable compiler-owned utility that walks parser-owned source structures for first-party extractors.
_Avoid_: public visitor API, stable AST plugin hook

**Source Graph**:
The directed graph of source files where edges point from a file to the files it depends on.
_Avoid_: dependency cache, import map

**Dependent Closure**:
The complete set of files reached by walking reverse source graph edges from changed files.
_Avoid_: affected files, blast radius

**Incremental Planner**:
The component that decides what Project Index work a file change affects without executing the
indexing work.
_Avoid_: incremental indexer, partial reindexer

**Full Reindex Fallback**:
A deliberate planner decision to rebuild the whole Project Index when graph evidence cannot prove a
safe partial plan.
_Avoid_: failure, cache miss

**Graph Evidence**:
The previous Project Index facts used to prove that a partial reindex plan covers every affected
source file and definition.
_Avoid_: hints, assumptions

## Relationships

- A **Project Index** contains zero or more **Index Source Rows**.
- A **Project Index Compiler** produces **Extracted Facts** that are merged into a **Project Index**.
- `@use-crux/local` stores a raw **Project Index Snapshot**; `GetIndex()` callers should treat it as
  cache/snapshot data, not the devtools-facing quality view.
- `@use-crux/local/internal/projectindex/readmodel` produces the **Project Index Read Model**. It is
  the only owner of derived `IndexQuality` annotations.
- A **Resolved Project Model** combines Project Index source facts with filesystem conventions,
  runtime evidence, and **Tooling Policy Config**.
- **Tooling Policy Config** may override or constrain discovery, but must not be required to repeat
  relationships already present in authored source.
- A **Duplicate Registration Trap** is an architecture bug unless the repeated field is really an
  explicit policy, trust, privacy, cost, or ownership decision.
- A **Compiler Result** is projected by emitters into a `ProjectIndexSnapshot` or `IndexPatch`.
  These names describe Project Index artifacts, not the public system name.
- Production syntax discovery and incremental AST partial execution project through shared compiler
  result emitters while downstream consumers keep the Project Index artifact shapes.
- A **Project Index Compiler** exposes **Compiler Slots** for different contribution roles.
- A **Compiler Profile** creates an **Extension Runtime** for one compiler instance.
- A **Compiler Intrinsic** belongs to a **Compiler Profile** and explains first-party parser-owned behavior that is not stable extension API.
- A **Project Index Compiler** may still contain named first-party **Compiler Intrinsics** while
  first-party behavior migrates behind internal extension/runtime slots; this is intentional only
  when declared in the **Compiler Profile** and represented in cache identity.
- A **Semantic Backend** is selected behind compiler-owned configuration and produces the same
  Project Index fact families regardless of implementation.
- A **Static Index** consumes **Static Syntax**, produces source-only Project Index facts, and feeds a
  **Semantic Scope** into semantic enrichment; it does not depend on TypeScript type checking.
- A **Static Syntax Frontend** emits **Static Syntax** and may become native before semantic does.
- A **Semantic Source Profile** is the shared preflight/cache/backend handoff for a
  **Semantic Scope**. It avoids duplicate source scans and gives future Go/native frontends one
  stable place to pass source fingerprints into semantic enrichment.
- A **Native Semantic Engine** is an implementation detail of the experimental native
  **Semantic Backend**. It may use TypeScript-Go, Rust, or another native implementation, but it
  must emit the same **Semantic Evidence** and keep extension APIs stable.
- A **Native Semantic Projector** is an optimization inside a **Semantic Backend**. It must not
  change the Project Index fact contract, extension surface, or parity requirements.
- The **Native Shared Analyzer** is still part of the native backend path. It is not a JavaScript
  TypeScript semantic fallback.
- A **Native Direct Primitive Manifest** explains native-projectable primitive shapes as data.
  Manifest-known primitives that are not supported by a projector must route through the native
  shared analyzer path instead of being ignored.
- **Experimental Indexer Config** lives under top-level `experimental.indexer`, not under stable
  `indexer` policy config, so unstable backend experiments have an obvious graduation path.
- The **Extension Runtime** executes **Compiler Slots** and owns deterministic extension ordering, contribution identity, result policy, and cache identity inputs.
- **Index Rule** identities participate in **Extension Runtime** cache identity inputs.
- **Cache Identity** means structured input plus an explicit epoch. Structured inputs cover source/config hashes, extension/extractor/rule identity, compiler profile identity, compiler-owned projection identity, TypeScript version, and semantic compiler options. Current hard migration epochs are `static-parse-v60`, `semantic-facts-v23`, and Go snapshot `epoch-31` under `.crux/cache/index-v2/`. Epochs live in `indexer/cache-identity.ts` and `@use-crux/local`'s `projectindex/cache/identity.go`; they are migration levers, not hidden magic constants.
- **Index Rule** metadata provides docs, option schema, and message declarations before a rule can run.
- An **Indexer Extension** contributes **Extracted Facts** through the **Extension Boundary**.
- First-party static primitive call names are owned by the Rust/Oxc Static Index primitive manifest. Bundled primitives do not have a TypeScript implementation.
- An **Indexer Extension** may declare zero or more **Relation Specs**.
- Built-in **Index Rules** are evaluated by the Rust `crates/lints` implementation. TypeScript exposes descriptor/contract readers and the third-party extension rule surface.
- An **Internal Traversal Helper** may support first-party extractors, but it is not part of the stable **Extension Boundary**.
- An **Extracted Fact** may contain an **Unresolved Reference**.
- A **Resolved Relation** is produced from an **Unresolved Reference** and a matching **Relation Spec**.
- An **Index Source Row** contributes to the **Source Graph**.
- A **Dependent Closure** is computed from the **Source Graph**.
- An **Incremental Planner** uses **Graph Evidence** to choose either a partial plan or a **Full Reindex Fallback**.
- A **Full Reindex Fallback** is correct behavior, not an indexing error.
- An **Index Rule** may declare `requires: ['semantic']` to receive the **Semantic Read Model**.
- The stable **Extension Boundary** does not expose raw TypeScript AST nodes, `Program`, or `TypeChecker`.
- Discovery gaps should produce diagnostics with suggested code or policy fixes; the default fix
  should not be "add another registry list to config."

## Example Dialogue

> **Dev:** "Can the incremental planner reindex only this changed prompt file?"
> **Domain expert:** "Only if the source graph gives enough graph evidence to compute the dependent closure. Otherwise it should choose a full reindex fallback."
>
> **Dev:** "Should an extension write directly to the index graph?"
> **Domain expert:** "No - call it an indexer extension, and have it emit extracted facts through the extension boundary."

## Flagged Ambiguities

- "Incremental indexer" was used to describe the next step, but the resolved term is **Incremental Planner** because this architecture plans affected work before any partial execution exists.
- "Affected files" is useful in API payloads, but the resolved domain term is **Dependent Closure** when describing the graph traversal result.
- "Plugin" is useful when discussing ecosystem expectations, but the domain term is **Indexer
  Extension**.
- "Graph write" suggests mutation of the final Project Index graph, but the resolved term is
  **Extracted Fact** because extensions contribute immutable facts before validation and merge.
- "Static" should refer to the source-only **Static Index** lane. Use **Static Syntax** when the
  specific parser evidence is meant. **Semantic** means optional type/program-aware analysis behind a
  stable read model.
- "Semantic backend config" should mean **Experimental Indexer Config** when referring to an
  unstable implementation selector. Do not introduce `indexer.semantic` public config.
- "Profile" should mean **Compiler Profile**, the compiler-owned bundle of first-party extensions and compiler-owned projections; it is not public third-party plugin loading.
- "Special case" should be replaced with **Compiler Intrinsic** when the behavior is intentional and compiler-owned.
- "Relation" should mean a **Resolved Relation** in the Project Index; extractor outputs that still need linking are **Unresolved References**.
- "Visitor" or "traversal API" should mean an **Internal Traversal Helper** unless a later ADR deliberately makes parser traversal public.
- "Registry" is acceptable for a normalized data structure, but the architectural boundary should be the **Extension Runtime** because it executes slot contributions rather than merely storing them.
- "Index" alone is ambiguous. Use **Crux Indexer** for the system and **Project Index** for the
  artifact/read model.
- "Project Index" can mean either the raw snapshot or the devtools read model in older code. Use
  **Project Index Snapshot** for cache/store values and **Project Index Read Model** for enriched
  devtools/API values.
- "Config" can mean runtime setup, policy override, or primitive registry in older docs. Prefer
  **Tooling Policy Config** for inert local/cloud/indexer policy and avoid using config to mean
  central primitive registration.
- "Zero config" must not mean magic ownership decisions. It means local tooling can discover authored
  code and conventions without duplicate registration.
- "Pure compiler shell" should not be used until first-party syntax projections have either moved
  behind internal extension/runtime slots or are explicitly retained as named compiler-owned behavior,
  semantic analysis is exposed only through `SemanticReadModel`, and relation/rule metadata contracts
  are frozen.
