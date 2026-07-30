---
"@use-crux/core": minor
---

Add the new `@use-crux/core/knowledge` entrypoint as the canonical home for `knowledgeBase`, add `knowledgeBase` pipeline config, and add an inert fingerprinted derive slot to `indexingPipeline`.

Bind knowledge-base recipes to namespace-scoped graph readers when record storage is configured, allowing recipe steps to traverse knowledge relations and hydrate active chunk refs.
