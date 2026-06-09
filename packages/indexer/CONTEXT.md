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

**Semantic Read Model**:
A stable read-only facade for type/program-aware analysis.
_Avoid_: TypeScript TypeChecker, raw AST access

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

**Legacy Project Index**:
The current implementation name for the accepted Project Index concept.
_Avoid_: using in new public APIs after the rename slice

**Legacy Crux Indexer**:
The current package/system name for the accepted Crux Indexer concept.
_Avoid_: using in new public APIs after the rename slice

## Relationships

- A **Project Index** contains zero or more **Index Source Rows**.
- A **Project Index Compiler** produces **Extracted Facts** that are merged into a **Project Index**.
- A **Compiler Result** is projected by emitters into a `ProjectIndexSnapshot` or `IndexPatch` after
  the rename slice. Current code still uses `ProjectIndexSnapshot` and `IndexPatch`.
- Production syntax discovery and incremental AST partial execution project through shared compiler
  result emitters while downstream consumers keep the existing result shape until the rename lands.
- A **Project Index Compiler** exposes **Compiler Slots** for different contribution roles.
- A **Compiler Profile** creates an **Extension Runtime** for one compiler instance.
- A **Compiler Intrinsic** belongs to a **Compiler Profile** and explains first-party parser-owned behavior that is not stable extension API.
- A **Project Index Compiler** may still contain named first-party **Compiler Intrinsics** while
  first-party behavior migrates behind internal extension/runtime slots; this is intentional only
  when declared in the **Compiler Profile** and represented in cache identity.
- The **Extension Runtime** executes **Compiler Slots** and owns deterministic extension ordering, contribution identity, result policy, and cache identity inputs.
- **Index Rule** identities participate in **Extension Runtime** cache identity inputs.
- **Cache Identity** means structured input plus an explicit epoch. Structured inputs cover source/config hashes, extension/extractor/rule identity, compiler profile identity, compiler-owned projection identity, TypeScript version, and semantic compiler options. Epochs live in `indexer/cache-identity.ts` and `@crux/local`'s `index_cache_identity.go`; they are migration levers, not hidden magic constants.
- **Index Rule** metadata provides docs, option schema, and message declarations before a rule can run.
- An **Indexer Extension** contributes **Extracted Facts** through the **Extension Boundary**.
- First-party static primitive call names are owned by `cruxCoreExtension` extension extractors. Extractors emit **Extracted Facts**; the removed primitive extractor registry is not part of the extension boundary.
- An **Indexer Extension** may declare zero or more **Relation Specs**.
- `cruxCoreExtension` contributes the built-in **Index Rule** used by full and AST-partial indexing.
- An **Internal Traversal Helper** may support first-party extractors, but it is not part of the stable **Extension Boundary**.
- An **Extracted Fact** may contain an **Unresolved Reference**.
- A **Resolved Relation** is produced from an **Unresolved Reference** and a matching **Relation Spec**.
- An **Index Source Row** contributes to the **Source Graph**.
- A **Dependent Closure** is computed from the **Source Graph**.
- An **Incremental Planner** uses **Graph Evidence** to choose either a partial plan or a **Full Reindex Fallback**.
- A **Full Reindex Fallback** is correct behavior, not an indexing error.
- An **Index Rule** may declare `requires: ['semantic']` to receive the **Semantic Read Model**.
- The stable **Extension Boundary** does not expose raw TypeScript AST nodes, `Program`, or `TypeChecker`.

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
- "Static" should become **Syntax** in public compiler language. **Semantic** means optional
  type/program-aware analysis behind a stable read model.
- "Profile" should mean **Compiler Profile**, the compiler-owned bundle of first-party extensions and compiler-owned projections; it is not public third-party plugin loading.
- "Special case" should be replaced with **Compiler Intrinsic** when the behavior is intentional and compiler-owned.
- "Relation" should mean a **Resolved Relation** in the Project Index; extractor outputs that still need linking are **Unresolved References**.
- "Visitor" or "traversal API" should mean an **Internal Traversal Helper** unless a later ADR deliberately makes parser traversal public.
- "Registry" is acceptable for a normalized data structure, but the architectural boundary should be the **Extension Runtime** because it executes slot contributions rather than merely storing them.
- "Index" and "Crux Indexer" are legacy implementation terms until the pre-launch rename lands.
- "Pure compiler shell" should not be used until first-party syntax projections have either moved
  behind internal extension/runtime slots or are explicitly retained as named compiler-owned behavior,
  semantic analysis is exposed only through `SemanticReadModel`, and relation/rule metadata contracts
  are frozen.
