# @crux/upstash

Upstash Vector and Redis adapters for Crux storage.

## Install

```bash
pnpm add @crux/upstash @crux/core @upstash/vector
```

`@upstash/vector` is a required peer dependency. `@upstash/redis` is an optional peer — install it only if you use the Redis store.

## Usage

Use `upstashVectorStore()` as the canonical `VectorStore` for dense, sparse, and hybrid retrieval.

```ts
import { upstashVectorStore } from '@crux/upstash'

const vectors = upstashVectorStore({
  index,
  namespace: 'docs',
})
```

`cruxUpstashStore()` remains available for combined Convex + Upstash store setups where existing primitives still expect a combined store shape.

## Semantic Response Cache

Use a dedicated Upstash namespace for semantic response cache entries and declare that isolation explicitly:

```ts
const cacheStore = cruxUpstashStore({
  index,
  namespace: 'semantic-cache',
  convex: { ctx, fns },
  semanticCache: { isolatedVectorNamespace: true },
})
```

Do not reuse the same vector namespace for RAG chunks, memory, and semantic cache entries. `createSemanticCache()` requires an isolated namespace so cache lookup is not crowded out by unrelated vectors before filtering.

## Redis Store

`cruxRedisStore()` is a Redis-backed key/value store with optional pub/sub. Plain Redis mode does not expose vector search:

```ts
import { cruxRedisStore } from '@crux/upstash/redis'

const store = cruxRedisStore({ redis })

store.searchVectors // undefined
store.vectorSearch  // undefined
```

Redis vector support is provider/module-specific. Redis Stack/RediSearch, managed Redis products, and sidecar vector indexes do not share one universal TypeScript command shape, so Crux exposes product-specific hooks instead of pretending all Redis deployments support vectors.

```ts
const cacheStore = cruxRedisStore({
  redis,
  prefix: 'crux-cache:',
  vector: {
    capabilities: { dense: true },
    semanticCache: { isolatedVectorNamespace: true },
    upsert: async ({ key, value }) => {
      // Write value.embedding into your Redis vector index.
    },
    delete: async ({ key }) => {
      // Remove the vector row from your Redis vector index.
    },
    searchVectors: async (query, helpers) => {
      // Run your product-specific vector query and return Crux keys + scores.
      return [{ key: 'semantic-cache:entry', score: 0.98 }]
    },
  },
})
```

If `vector` is not configured, semantic cache setup fails clearly because `searchVectors()` is absent. If `vector.semanticCache.isolatedVectorNamespace` is not `true`, `createSemanticCache()` also fails clearly.
