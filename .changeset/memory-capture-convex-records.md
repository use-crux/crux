---
'@use-crux/core': minor
'@use-crux/convex': minor
---

Memory capture modes are now honored end to end, and Convex memory storage is records-only.

Adapters previously awaited memory flush unconditionally, so `capture.mode: 'afterResponse'` and `'detached'` behaved like `'inline'` for prompt-bound memory. Adapters now only await capture when the mode is `'inline'`, or when it is `'afterResponse'` without a configured `capture.waitUntil` hook (the serverless-safe fallback). Adapters also forward each tool call to memory blocks' `captureToolEvent` hooks, so `episodes()` records tool activity, and the Convex agent lifecycle retains tool results and errors. Extractive blocks with `write: { mode: 'manual' }` no longer run their extract callback during capture.

Breaking for `@use-crux/convex` (pre-1.0 minor): the bundled Convex vector path was unusable (no schema vector index, wrong search result hydration) and its same-key vector upsert corrupted memory records, so it has been removed, including the `vectorIndexName` and `semanticCache` profile-storage options, the `ConvexSemanticCacheOptions` type, and the store-doc dense-search contract types. `convexStorage()` and the ambient Convex runtime storage now provide records only; embeddings remain mirrored on records. Semantic memory blocks fall back to recency listing on Convex unless an explicit `VectorStore` (for example `upstashVectorStore()` from `@use-crux/upstash`) is configured, and `convexVectorStore()` now throws `unsupported_capability` with migration guidance. `memory({ records })` from `@use-crux/convex` no longer injects ambient runtime storage when explicit stores are passed.
