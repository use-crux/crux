# @use-crux/upstash

Upstash-backed Storage Beta adapters for Crux.

## Install

```bash
pnpm add @use-crux/upstash @use-crux/core @upstash/vector @upstash/qstash
```

`@upstash/vector` is a required peer dependency for search stores.
`@upstash/redis` is optional and only needed when you use
`upstashRedisRecordStore()`. `@upstash/qstash` is optional and only needed for
the Runtime Engine wake adapter.

## SearchStore

Use `upstashSearchStore()` for Upstash Vector indexes. The adapter supports
SearchStore dense and sparse query legs, exact pre-filtering, and RRF fusion.
Narrow capabilities when the backing Upstash index does not support both dense
and sparse vectors.

```ts
import { upstashSearchStore } from '@use-crux/upstash'

const search = upstashSearchStore({
  index,
  namespace: 'docs',
  capabilities: { legs: { dense: true, sparse: true }, filter: 'pre' },
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
import { upstashRedisRecordStore, upstashSearchStore } from '@use-crux/upstash'

const appStorage = storage({
  records: upstashRedisRecordStore({ redis }),
  search: upstashSearchStore({
    index,
    namespace: 'memory',
    capabilities: { legs: { dense: true, sparse: true }, filter: 'pre' },
  }),
})
```

Use dedicated search namespaces for separate workloads such as RAG chunks,
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
