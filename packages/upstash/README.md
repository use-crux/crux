# @use-crux/upstash

Upstash-backed Storage Beta adapters for Crux.

## Install

```bash
pnpm add @use-crux/upstash @use-crux/core @upstash/vector @upstash/qstash
```

`@upstash/vector` is a required peer dependency for vector stores.
`@upstash/redis` is optional and only needed when you use
`upstashRedisRecordStore()`. `@upstash/qstash` is optional and only needed for
the Runtime Engine wake adapter.

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

## Runtime Wake

Use `qstash()` from `@use-crux/upstash/runtime` as the HTTP wake adapter for
serverless Runtime Engine deployments.

```ts
import { config } from '@use-crux/core'
import { serverless } from '@use-crux/core/runtime'
import { postgres } from '@use-crux/postgres/runtime'
import { qstash } from '@use-crux/upstash/runtime'

export default config({
  runtime: serverless({
    store: postgres(),
    wake: qstash(),
  }),
})
```

QStash publishes small signed wake envelopes to the generated Crux runtime
endpoint and verifies incoming `Upstash-Signature` headers with the official
`@upstash/qstash` receiver.
