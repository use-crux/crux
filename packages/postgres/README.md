# @use-crux/postgres

First-party PostgreSQL storage and Runtime Engine adapters for Crux. `pg` is a
peer dependency; pgvector is provided by PostgreSQL rather than a JavaScript
client dependency.

## Connected Knowledge storage

```ts
import { postgresStorage } from "@use-crux/postgres";

const storage = postgresStorage({
  url: process.env.DATABASE_URL,
  dimensions: 1536,
  sparseDimensions: 30_000,
});

const checked = await storage.setup.check();
if (!checked.ok) await storage.setup.apply();
await storage.close();
```

The root package exports `postgresRecordStore(options?)` for JSONB records,
lazy TTL, native scalar filters, batches, and versioned CAS;
`postgresVectorStore({ dimensions, sparseDimensions? })` for pgvector dense,
optional sparse, and RRF hybrid search; and `postgresStorage(options)` for both
adapters over one pool and setup lifecycle.

Storage defaults to the dedicated `crux_storage` schema. Setup is always
explicit: `check()` is read-only and `apply()` performs idempotent additive
DDL. Data operations never create extensions, schemas, tables, or indexes. A
caller-supplied `Pool` remains caller-owned; `close()` only ends a pool the
adapter created.

Dense and sparse searches use pgvector cosine HNSW indexes. HNSW is
approximate, so recall depends on PostgreSQL/pgvector tuning. Hybrid search
uses Crux's fixed RRF semantics; DBSF is intentionally unsupported.

## Runtime Engine

```ts
import { config } from '@use-crux/core'
import { node } from '@use-crux/core/runtime'
import { postgres } from '@use-crux/postgres/runtime'

export default config({
  runtime: node({
    store: postgres({
      url: process.env.DATABASE_URL,
      schema: 'crux_runtime',
    }),
  }),
})
```

`postgres()` persists Runtime Engine work, snapshots, events, waiters, timers,
outbox rows, idempotency keys, leases, and scoped-idle counters in a Crux-owned
Postgres schema. It also exposes `store.setup.check()` and
`store.setup.apply()` for non-mutating verification and safe additive setup.
Runtime DDL stays in the separate `crux_runtime` schema and is never coupled to
Connected Knowledge storage setup.

See the Runtime Engine docs for setup and deployment recipes:

- Reference: https://cruxjs.dev/docs/reference/postgres
- Next/Vercel runtime: https://cruxjs.dev/docs/guides/durable-execution/next-vercel
- Long-lived Node runtime: https://cruxjs.dev/docs/guides/durable-execution/node
