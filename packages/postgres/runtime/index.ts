import {
  createRuntimeError,
  type RuntimeSetupMode,
  type RuntimeSetupPort,
  type RuntimeStoreAdapter,
  type RuntimeStoreTransaction,
} from '@use-crux/core/runtime'
import { Pool, type PoolConfig } from 'pg'
import { createPostgresEventPort } from './events'
import {
  beginFaultWindow,
  createPostgresStoreFaults,
  type PostgresStoreFaults,
} from './faults'
import { createPostgresLeasePort } from './leases'
import { createPostgresOutboxPort } from './outbox'
import { createPostgresSetupPort } from './setup'
import { type PgExecutor, withTransaction } from './sql'
import { createPostgresStatePort } from './state'
import { createPostgresTimerStore } from './timers'
import { createPostgresWaiterPort } from './waiters'
import { DEFAULT_POSTGRES_SCHEMA } from './ddl'

/** Setup policy for the Postgres Runtime Engine store. */
export interface PostgresSetupOptions {
  /**
   * Setup mode requested by tooling.
   *
   * `verify` checks only. `create-if-missing` allows safe additive DDL through
   * {@link RuntimeSetupPort.apply}; destructive migrations are never run.
   */
  readonly mode?: RuntimeSetupMode
}

/** Options accepted by {@link postgres}. */
export interface PostgresRuntimeStoreOptions {
  /**
   * Postgres connection string.
   *
   * Defaults to `DATABASE_URL` when no `pool` is supplied. Explicit options
   * always win over environment autodetection.
   */
  readonly url?: string
  /**
   * Caller-owned `pg` pool.
   *
   * Use this when your app already manages pooling. Crux will not close a
   * caller-owned pool from {@link PostgresRuntimeStore.close}.
   */
  readonly pool?: Pool
  /** Additional `pg` pool options when Crux creates the pool. */
  readonly poolOptions?: Omit<PoolConfig, 'connectionString'>
  /** SQL schema that owns Crux runtime tables. Defaults to `crux_runtime`. */
  readonly schema?: string
  /** Setup mode metadata consumed by setup tooling. */
  readonly setup?: PostgresSetupOptions
}

/** Fault-injection controls used by runtime store conformance tests. */
export interface PostgresRuntimeStoreTesting {
  /** Fail a transaction after `writes` successful writes to prove rollback. */
  failAfter(writes: number): void
  /** Throw once before confirming the next outbox item. */
  crashBeforeConfirm(): void
}

/** Postgres-backed Runtime Engine store adapter. */
export interface PostgresRuntimeStore extends RuntimeStoreAdapter {
  /** Stable adapter id used in conformance output. */
  readonly id: 'postgres'
  /** Resource verification and additive DDL setup. */
  readonly setup: RuntimeSetupPort
  /** Fault-injection controls for conformance tests. */
  readonly testing: PostgresRuntimeStoreTesting
  /** Close the Crux-owned pool. Caller-owned pools are left open. */
  close(): Promise<void>
}

/**
 * Create a Postgres Runtime Engine store adapter.
 *
 * The adapter persists state, events, waiters, timers, outbox rows,
 * idempotency keys, leases, and scoped-idle counters in a Crux-owned SQL
 * schema. It does not deliver wake requests by itself; compose it with a wake
 * adapter such as QStash when running in serverless environments.
 *
 * @param options - Connection, schema, and setup options.
 * @returns A durable store adapter accepted by runtime composers.
 *
 * @example
 * ```ts
 * import { node } from '@use-crux/core/runtime'
 * import { postgres } from '@use-crux/postgres/runtime'
 *
 * export default config({
 *   runtime: node({ store: postgres() }),
 * })
 * ```
 */
export function postgres(
  options: PostgresRuntimeStoreOptions = {},
): PostgresRuntimeStore {
  const schema = options.schema ?? DEFAULT_POSTGRES_SCHEMA
  const ownsPool = options.pool === undefined
  const connectionString = options.url ?? process.env.DATABASE_URL

  if (!options.pool && !connectionString) {
    throw createRuntimeError({
      code: 'SETUP_REQUIRED',
      whatFailed: 'Postgres Runtime Engine store could not connect.',
      why: 'No Postgres pool was supplied and DATABASE_URL is not set.',
      whatStillWorks:
        'Object-bound flow APIs and the in-memory node() runtime still work.',
      nextStep:
        'Set DATABASE_URL or call postgres({ url: process.env.DATABASE_URL }).',
    })
  }

  const pool =
    options.pool ??
    new Pool({
      ...options.poolOptions,
      connectionString,
    })
  const faults = createPostgresStoreFaults()

  function portsFor(
    client: PgExecutor = pool,
    txFaults = faults,
  ): RuntimeStoreTransaction {
    return {
      state: createPostgresStatePort(client, schema, txFaults),
      events: createPostgresEventPort(client, schema, txFaults),
      waiters: createPostgresWaiterPort(client, schema, txFaults),
      timers: createPostgresTimerStore(client, schema, txFaults),
      outbox: createPostgresOutboxPort(client, schema, txFaults),
    }
  }

  const ports = portsFor()
  const store: PostgresRuntimeStore = Object.freeze({
    id: 'postgres',
    ...ports,
    leases: createPostgresLeasePort(pool, schema),
    setup: createPostgresSetupPort(pool, schema),
    async transact<T>(
      fn: (tx: RuntimeStoreTransaction) => Promise<T>,
    ): Promise<T> {
      beginFaultWindow(faults)
      try {
        return await withTransaction(pool, async (client) => {
          return await fn(portsFor(client, faults))
        })
      } finally {
        faults.failAfterWrites = undefined
      }
    },
    testing: Object.freeze({
      failAfter(writes: number): void {
        faults.failAfterWrites = writes
      },
      crashBeforeConfirm(): void {
        faults.crashBeforeConfirm = true
      },
    }),
    async close(): Promise<void> {
      if (ownsPool) await pool.end()
    },
  })

  return store
}

export type { PostgresStoreFaults }
