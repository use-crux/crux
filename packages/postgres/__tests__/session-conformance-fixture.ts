import {
  config,
  createWorkHost,
  getSession,
  session,
  type WorkHost,
} from '@use-crux/core'
import {
  createRuntimeError,
  createRuntimeProgram,
  createRuntimeWorker,
  node,
  type RuntimeResultPayloadPort,
  type RuntimeStoreAdapter,
  type RuntimeStoreTransaction,
} from '@use-crux/core/runtime'
import type { SessionConformanceHarness } from '@use-crux/core/runtime/testing'
import type { Pool } from 'pg'
import { postgresRecordStore, type PostgresRecordStore } from '../src'
import { postgres, type PostgresRuntimeStore } from '../src/runtime'
import { createConformanceProgramFixture } from './session-conformance-model'
import { createPostgresTestPool } from './test-database'

let nextSchema = 0

export interface PostgresSessionConformanceHarness extends SessionConformanceHarness {
  /** Prune old result payloads through the adapter's production retention port. */
  readonly pruneResults: () => Promise<{
    readonly removed: number
    readonly truncated: boolean
  }>
}

export async function createPostgresSessionConformanceHarness(
  url: string,
  id: string,
): Promise<PostgresSessionConformanceHarness> {
  const schema = `crux_session_${process.pid}_${nextSchema++}`
  const namespace = `session-conformance-${id}`
  const pools: Pool[] = []
  const hosts: WorkHost[] = []
  const fixture = createConformanceProgramFixture(id)
  const program = createRuntimeProgram({
    targets: [fixture.primary, fixture.conflicting, fixture.unsupported],
    transports: [],
  })
  const workerPool = newPool()
  const workerStore = postgres({ pool: workerPool, schema })
  let host = await createHost(true)
  let fault: 'after-checkpoint' | 'after-thread-publication' | undefined

  function newPool(): Pool {
    const pool = createPostgresTestPool(url)
    pools.push(pool)
    return pool
  }

  async function createHost(applySetup: boolean): Promise<WorkHost> {
    const pool = newPool()
    const store = postgres({ pool, schema })
    const records = postgresRecordStore({ pool, schema })
    if (applySetup) {
      await store.setup.apply()
      await records.setup.apply()
    }
    config({ storage: { records } })
    const created = createWorkHost({
      runtime: node({ store, namespace, autoStartMaintenance: false }),
      program,
    })
    hosts.push(created)
    return created
  }

  return {
    create: (key) => host.run(() => session(fixture.primary, { key })),
    get: (key) => host.run(() => getSession(fixture.primary, key)),
    createConflict: (key) =>
      host.run(() => session(fixture.conflicting, { key })),
    createCapabilityFailure: async (key) =>
      await host.run(() =>
        Reflect.apply(session, undefined, [fixture.unsupported, { key }]),
      ),
    ownerIds: async (threadId) => {
      const records = currentRecords()
      const control = await records.get(`thread/${threadId}`)
      const owners = control?.owners
      return owners && typeof owners === 'object' && !Array.isArray(owners)
        ? Object.keys(owners)
        : []
    },
    startWorker: () =>
      createRuntimeWorker({
        runtime: node({
          store: faultStore(
            workerStore,
            () => fault,
            () => {
              fault = undefined
            },
          ),
          namespace,
          autoStartMaintenance: false,
        }),
        program,
        pollIntervalMs: 1,
      }),
    armFault: (boundary) => {
      fault = boundary
    },
    reconnect: async () => {
      host.dispose()
      host = await createHost(false)
    },
    receiptCount: async (threadId) =>
      (
        await currentRecords().list(`thread/${threadId}/receipt/`, {
          limit: 100,
        })
      ).entries.length,
    makeTerminalFailure: async () => {
      const pending = await workerStore.state.listWork({
        namespace,
        status: 'pending',
      })
      const [work] = pending
      if (!work || pending.length !== 1) {
        throw new Error('Expected one pending Session Work.')
      }
      await workerStore.state.putWork(
        Object.freeze({ ...work, maxAttempts: 1 }),
      )
    },
    sessionCount: async () => {
      const result = await workerPool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "${schema}"."sessions" WHERE namespace = $1`,
        [namespace],
      )
      return Number(result.rows[0]?.count ?? 0)
    },
    executionCounts: () => ({
      executor: fixture.execute.mock.calls.length,
      provider: fixture.provider.mock.calls.length,
      tool: fixture.tool.mock.calls.length,
      effect: fixture.effectHandler.mock.calls.length,
    }),
    pruneResults: async () =>
      await workerStore.results.pruneUnreferenced({
        namespace,
        before: new Date(Date.now() + 60_000),
        limit: 100,
      }),
    dispose: async () => {
      for (const current of hosts) current.dispose()
      const cleanup = createPostgresTestPool(url)
      try {
        await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      } finally {
        await Promise.all(pools.map(async (pool) => await pool.end()))
        await cleanup.end()
      }
    },
  }

  function currentRecords(): PostgresRecordStore {
    const pool = pools.at(-1)
    if (!pool) throw new Error('Expected an active PostgreSQL test pool.')
    return postgresRecordStore({ pool, schema })
  }
}

function faultStore(
  store: PostgresRuntimeStore,
  readFault: () => 'after-checkpoint' | 'after-thread-publication' | undefined,
  clearFault: () => void,
): RuntimeStoreAdapter {
  const sessions = store.sessions
  if (!sessions) return store
  const results = faultResults(store.results, readFault, clearFault)
  return {
    ...store,
    results,
    sessions: {
      ...sessions,
      async checkpointPreparedExecution(input) {
        const checkpoint = await sessions.checkpointPreparedExecution(input)
        if (readFault() === 'after-checkpoint') {
          clearFault()
          throw injectedCrash('prepared Session checkpoint')
        }
        return checkpoint
      },
    },
    transact: async <T>(
      fn: (tx: RuntimeStoreTransaction) => Promise<T>,
    ): Promise<T> => await store.transact(fn),
  }
}

function faultResults(
  results: RuntimeResultPayloadPort,
  readFault: () => 'after-checkpoint' | 'after-thread-publication' | undefined,
  clearFault: () => void,
): RuntimeResultPayloadPort {
  let writes = 0
  return {
    ...results,
    async put(payload, options) {
      writes += 1
      if (writes === 2 && readFault() === 'after-thread-publication') {
        clearFault()
        throw injectedCrash('owner-Thread publication')
      }
      return await results.put(payload, options)
    },
  }
}

function injectedCrash(boundary: string) {
  return createRuntimeError({
    code: 'LEASE_LOST',
    whatFailed: `Runtime work stopped after ${boundary}.`,
    why: 'The PostgreSQL conformance harness injected process loss.',
    whatStillWorks: 'Durable records remain available to the next attempt.',
    nextStep: 'Retry through the Runtime worker.',
  })
}
