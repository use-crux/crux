# @use-crux/upstash

Upstash-backed Storage Beta adapters for Crux.

## Install

```bash
pnpm add @use-crux/upstash @use-crux/core @upstash/vector
```

`@upstash/vector` is a required peer dependency. `@upstash/redis` is optional
and only needed when you use `upstashRedisRecordStore()`.

## VectorStore

Use `upstashVectorStore()` for Upstash Vector indexes. The adapter defaults to
dense-only search because index mode is configured in Upstash, not in Crux.
Opt into sparse or hybrid capabilities only when the backing index supports
them.

```ts
import { upstashVectorStore } from '@use-crux/upstash'

const vectors = upstashVectorStore({
  index,
  namespace: 'docs',
  capabilities: { dense: true, filter: 'pre' },
})
```

## RecordStore

Use `upstashRedisRecordStore()` for Redis-backed JSON records. It uses Redis PX
expiry for native TTL and cursor-based SCAN for prefix listing.

```ts
import { upstashRedisRecordStore } from '@use-crux/upstash'

const records = upstashRedisRecordStore({ redis, prefix: 'crux:' })
```

## Storage Bundle

Pass the adapters explicitly to Crux primitives that need them.

```ts
import { storage } from '@use-crux/core/storage'
import { upstashRedisRecordStore, upstashVectorStore } from '@use-crux/upstash'

const appStorage = storage({
  records: upstashRedisRecordStore({ redis }),
  vectors: upstashVectorStore({
    index,
    namespace: 'memory',
    capabilities: { dense: true, filter: 'pre' },
  }),
})
```

Use dedicated vector namespaces for separate workloads such as RAG chunks,
memory recall, and semantic response cache entries.
