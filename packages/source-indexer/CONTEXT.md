# Source Indexer

Source Indexer is the Crux context that turns authored project files into Project Catalog facts for local devtools.

## Language

**Project Catalog**:
The read model of authored Crux definitions, relations, source files, diagnostics, and lint findings.
_Avoid_: index, registry

**Project Catalog Compiler**:
The Source Indexer boundary that derives Project Catalog facts from authored project files.
_Avoid_: indexing pipeline, compiler pipeline

**Compiler Slot**:
A role-based contribution point in the Project Catalog Compiler, such as source, parser, extractor, resolver, rule, or emitter.
_Avoid_: static hook, semantic hook, lifecycle callback

**Compiler Result**:
An immutable Project Catalog Compiler output value containing facts, diagnostics, lint findings, source rows, and graph evidence before snapshot or patch projection.
_Avoid_: session state, mutable accumulator

**Extension Runtime**:
The compiler-owned functional executor that normalizes Source Indexer Extensions and runs their Compiler Slot contributions deterministically.
_Avoid_: plugin manager, mutable registry service

**Catalog Source Row**:
A durable catalog row describing one source file and its known definitions, dependencies, dependents, and diagnostics.
_Avoid_: file node, source cache entry

**Extension Boundary**:
The contract where Source Indexer capabilities contribute Project Catalog facts without exposing parser internals.
_Avoid_: plugin API, extractor internals

**Source Indexer Extension**:
A named contribution to the Project Catalog Compiler that declares the catalog facts or relation semantics it can produce.
_Avoid_: plugin, registry entry

**Extracted Fact**:
An immutable catalog contribution emitted before it is validated, merged, and projected into the Project Catalog.
_Avoid_: mutation, graph write

**Unresolved Reference**:
An extracted catalog reference that has not yet been linked to a concrete Project Catalog definition or relation.
_Avoid_: relation, edge

**Resolved Relation**:
A Project Catalog relation produced after reference resolution validates and links extracted references.
_Avoid_: relation ref, unresolved edge

**Relation Spec**:
An extension-owned declaration of the meaning and allowed endpoints for a Project Catalog relation type.
_Avoid_: relation registry entry, edge config

**Catalog Rule**:
A Source Indexer Extension contribution that analyzes resolved definitions and relations and returns Project Catalog lint findings.
_Avoid_: lint hook, graph mutation

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
The component that decides what catalog work a file change affects without executing the indexing work.
_Avoid_: incremental indexer, partial reindexer

**Full Reindex Fallback**:
A deliberate planner decision to rebuild the whole Project Catalog when graph evidence cannot prove a safe partial plan.
_Avoid_: failure, cache miss

**Graph Evidence**:
The previous catalog facts used to prove that a partial reindex plan covers every affected source file and definition.
_Avoid_: hints, assumptions

## Relationships

- A **Project Catalog** contains zero or more **Catalog Source Rows**.
- A **Project Catalog Compiler** produces **Extracted Facts** that are merged into a **Project Catalog**.
- A **Compiler Result** is projected by emitters into a `ProjectCatalogSnapshot` or `CatalogPatch`.
- Production static discovery and incremental AST partial execution project through shared compiler result emitters while downstream consumers keep the existing catalog result shape.
- A **Project Catalog Compiler** exposes **Compiler Slots** for different contribution roles.
- The **Extension Runtime** executes **Compiler Slots** and owns deterministic extension ordering, contribution identity, result policy, and cache identity inputs.
- **Catalog Rule** identities participate in **Extension Runtime** cache identity inputs.
- A **Source Indexer Extension** contributes **Extracted Facts** through the **Extension Boundary**.
- First-party static primitive call names are owned by `cruxCoreExtension` extension extractors. Extractors emit **Extracted Facts**; the removed primitive extractor registry is not part of the extension boundary.
- A **Source Indexer Extension** may declare zero or more **Relation Specs**.
- `cruxCoreExtension` contributes the built-in **Catalog Rule** used by full and AST-partial indexing.
- An **Internal Traversal Helper** may support first-party extractors, but it is not part of the stable **Extension Boundary**.
- An **Extracted Fact** may contain an **Unresolved Reference**.
- A **Resolved Relation** is produced from an **Unresolved Reference** and a matching **Relation Spec**.
- A **Catalog Source Row** contributes to the **Source Graph**.
- A **Dependent Closure** is computed from the **Source Graph**.
- An **Incremental Planner** uses **Graph Evidence** to choose either a partial plan or a **Full Reindex Fallback**.
- A **Full Reindex Fallback** is correct behavior, not an indexing error.

## Example Dialogue

> **Dev:** "Can the incremental planner reindex only this changed prompt file?"
> **Domain expert:** "Only if the source graph gives enough graph evidence to compute the dependent closure. Otherwise it should choose a full reindex fallback."
>
> **Dev:** "Should a plugin write directly to the catalog graph?"
> **Domain expert:** "No - call it a source indexer extension, and have it emit extracted facts through the extension boundary."

## Flagged Ambiguities

- "Incremental indexer" was used to describe the next step, but the resolved term is **Incremental Planner** because this architecture plans affected work before any partial execution exists.
- "Affected files" is useful in API payloads, but the resolved domain term is **Dependent Closure** when describing the graph traversal result.
- "Plugin" is useful when discussing future third-party loading, but the Source Indexer domain term is **Source Indexer Extension** until loading and sandboxing become their own concern.
- "Graph write" suggests mutation of the final catalog graph, but the resolved term is **Extracted Fact** because extensions contribute immutable facts before validation and merge.
- "Static" and "semantic" describe internal execution/cache modes, but extension authoring should use **Compiler Slots** such as extractor, resolver, rule, and emitter.
- "Relation" should mean a **Resolved Relation** in the Project Catalog; extractor outputs that still need linking are **Unresolved References**.
- "Visitor" or "traversal API" should mean an **Internal Traversal Helper** unless a later ADR deliberately makes parser traversal public.
- "Registry" is acceptable for a normalized data structure, but the architectural boundary should be the **Extension Runtime** because it executes slot contributions rather than merely storing them.
