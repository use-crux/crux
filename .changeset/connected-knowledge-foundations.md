---
"@use-crux/core": minor
---

Add the new `@use-crux/core/knowledge` entrypoint as the canonical home for `knowledgeBase`, add `knowledgeBase` pipeline config, and add an inert fingerprinted derive slot to `indexingPipeline`.

Bind knowledge-base recipes to namespace-scoped graph readers when record storage is configured, allowing recipe steps to traverse knowledge relations and hydrate active chunk refs.

Add the `expandRelations()` retrieval recipe step: additive, visibility-safe graph expansion of retrieved hits with deterministic ordering, bounded fan-out, and per-hit graph provenance.

Export `relate()` and `knowledgeModel()` from the canonical `@use-crux/core/knowledge` entrypoint.

Add built-in `relateReferences()` and `relateEntities({ model })` relation stages for explicit references and generic entity connections.

Validate `knowledgeBase({ metadataSchema })` metadata during ingestion so invalid direct sources are skipped with aggregate diagnostics after valid sources index, while corpus-backed sources report schema failures through per-source sync outcomes.

Add `knowledgeBase().view()` for schema-typed connected knowledge views with live and pinned revisions, view-scoped retrieval, recipes, grounding, and tools.

Add `assertions()` for schema-typed, evidence-backed connected knowledge assertions with deterministic and model-backed derive modes, assertion claim caching, and generation-scoped support merging.
