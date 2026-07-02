# @use-crux/postgres

Postgres Runtime Engine store adapter for Crux.

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

Full runtime recipes and setup CLI docs land with the Runtime Engine docs pass.
