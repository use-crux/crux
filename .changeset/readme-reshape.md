---
"@use-crux/core": patch
---

Reshape the `@use-crux/core` README (npm page) to orient rather than document:
keep the intro, install, examples, subpaths table, and links, and route deep
reference topics to the docs site. Also fix stale example APIs (guardrails and
constraints now use the boundary-based `{ id, on, run }` shape; the retriever
example uses the real `records` field).
