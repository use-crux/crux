---
"@use-crux/core": patch
"@use-crux/indexer": patch
"@use-crux/upstash": patch
---

Harden Memory namespace handling and capture scheduling: dynamic proposal operations now resolve from input, synchronous tool collection throws clear errors for async namespaces or async block tools, and `memory({ capture: { mode } })` is available with `processing` kept as a deprecated alias.

Align Memory store adapters with the beta `CruxStore` contract: `@use-crux/core` now exposes a reusable store conformance helper for adapter tests, deprecated private `memory/types` store aliases point to `CruxStore`, and the Upstash adapter supports page-shaped Convex component lists with decoded filtering and hydrated vector search metadata.

Harden Memory capture and proposal review: adapter-bound memory capture now preserves settled tool results and errors when available, proposal approve/reject/edit operations are pending-only to prevent duplicate writes, and proposal write observations include flattened source metadata.

Make Memory rendering predictable under token pressure: `budget.maxTokens` is now enforced for memory contexts and individual blocks, and extractive memory blocks support explicit list/recent and semantic render strategies.

Expose Memory beta behavior in observability and Project Index surfaces: budgeted memory rendering now emits inspectable `memory.read` observations, static memory extraction records capture mode, budgets, render strategies, and retention metadata, and devtools memory details can show indexed episodic retention policy.
