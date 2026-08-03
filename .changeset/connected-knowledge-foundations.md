---
'@use-crux/core': minor
'@use-crux/indexer': minor
'@use-crux/postgres': minor
---

Add the new `@use-crux/core/knowledge` entrypoint as the canonical home for `knowledgeBase`, add `knowledgeBase` pipeline config, and add an inert fingerprinted derive slot to `indexingPipeline`.

Bind knowledge-base recipes to namespace-scoped graph readers when record storage is configured, allowing recipe steps to traverse knowledge relations and hydrate active chunk refs.

Add the `expandRelations()` retrieval recipe step: additive, visibility-safe graph expansion of retrieved hits with deterministic ordering, bounded fan-out, and per-hit graph provenance.

Export `relate()` and `knowledgeModel()` from the canonical `@use-crux/core/knowledge` entrypoint.

Add built-in `relateReferences()` and `relateEntities({ model })` relation stages for explicit references and generic entity connections.

Validate `knowledgeBase({ metadataSchema })` metadata during ingestion so invalid direct sources are skipped with aggregate diagnostics after valid sources index, while corpus-backed sources report schema failures through per-source sync outcomes.

Add `knowledgeBase().view()` for schema-typed connected knowledge views with live and pinned revisions, view-scoped retrieval, recipes, grounding, and tools.

Add `assertions()` for schema-typed, evidence-backed connected knowledge assertions with deterministic and model-backed derive modes, assertion claim caching, and generation-scoped support merging.

Add `knowledgeBase().assertions()` and `view.assertions()` lazy assertion sets, persisted assertion relations, and assertion resolution partitions for explicit supersession and conflict handling.

Compose assertion sets and assertion resolutions directly in `use`, injecting bounded deterministic context summaries for selected assertions and selected resolution partitions.

Compose knowledge bases and views directly in `use` and request representation wrappers, using default prompt-input retrieval while preserving explicit `asContext()` customization for query, limit, rendering, and tool retention.

Add `communities({ model })` for Connected Knowledge community materialization, including knowledge-base and view lifecycle surfaces for `status()`, `prepare()`, and paginated `reports()`, with graph-backed clustering, report reuse, and atomic refresh publication.

Add fail-closed multimodal evidence validation for model-backed Connected Knowledge derivation and community reports, with `knowledgeModel()` modality declarations and an optional parts-based structured generation hook for hydrated media evidence.

Add `globalSearch({ model })` as a Connected Knowledge recipe producer over community reports, returning cited finding hits with knowledge receipts, freshness coverage, deterministic batching, and request-filter rejection in favor of typed views.

Integrate connected-knowledge contexts with request representation planning: view/retriever and assertion contexts keep exact required defaults, summarizable view contexts key derived artifacts by source revisions, retriever-owned tools remain sticky until explicit omission, request inspection projects redacted knowledge trace receipts, and `globalSearch()` can consult one injected admission hook before map calls.

Export `runConnectedKnowledgeConformance()` from `@use-crux/core/knowledge` so storage adapters can run the connected knowledge storage contract against their own storage bundles.

Add first-party PostgreSQL Connected Knowledge storage with JSONB records,
explicit idempotent setup, pgvector dense/sparse/hybrid search, normalized RRF,
shared pool ownership, and full storage conformance coverage.

Let configured storage bundles expose a provider-neutral setup capability so
`crux setup --check/--apply` verifies and safely provisions PostgreSQL storage,
redacts adapter findings, and releases only adapter-owned resources.

Emit native Effect receipts for public knowledge-base source mutations, including `index()`, `reindex()`, `remove()`, and corpus-backed sync, while keeping derived Connected Knowledge work outside the Effect boundary.

Add Project Index discovery for Connected Knowledge definitions, relation/assertion vocabularies, model bindings, communities, and knowledge-base views.

Add Project Index lint rules for unknown `expandRelations()` relation types, Connected Knowledge recipe producer conflicts, and unknown assertion type selections; Local LSP hovers and definition navigation now surface Connected Knowledge definition metadata from the Project Index read model.
