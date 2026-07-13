import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  runStoreAdapterTests,
  type RunStoreAdapterTestsOptions,
} from '@use-crux/core/runtime/testing'
import type {
  DeferredIntentId,
  DeferredScopeId,
  FlowId,
  FlowSnapshot,
  LeaseToken,
  RuntimeOutboxItem,
  RuntimeTargetId,
  WorkId,
} from '@use-crux/core/runtime'
import {
  runDefaultRuntimeComposite,
  type RuntimeCompositeRunner,
} from '@use-crux/core/runtime'
import { postgres, type PostgresRuntimeStore } from '../src/runtime'
import { ddlStatements, REQUIRED_COLUMNS } from '../src/runtime/ddl'
import {
  createPostgresTestPool,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from './test-database'

interface TestStore {
  readonly store: PostgresRuntimeStore
  readonly close: () => Promise<void>
}

describe('@use-crux/postgres runtime', () => {
  let testDatabase: PostgresTestDatabase
  const stores: TestStore[] = []
  const schemas: string[] = []

  async function createStore(): Promise<PostgresRuntimeStore> {
    const schema = `crux_runtime_test_${Date.now()}_${schemas.length}`
    schemas.push(schema)
    const pool = createPostgresTestPool(testDatabase.url)
    const store = postgres({ pool, schema })
    stores.push({
      store,
      close: async () => {
        await store.close()
        await pool.end()
      },
    })
    await store.setup.apply()
    return store
  }

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase()
  }, 30_000)

  afterAll(async () => {
    try {
      await Promise.all(stores.map((store) => store.close()))
      const cleanup = createPostgresTestPool(testDatabase.url)
      try {
        for (const schema of schemas) {
          await cleanup.query(
            `DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`,
          )
        }
      } finally {
        await cleanup.end()
      }
    } finally {
      await testDatabase?.close()
    }
  })

  const options: RunStoreAdapterTestsOptions<PostgresRuntimeStore> = {
    name: 'postgres',
    createStore,
    failAfterWrites: (store, writes) => store.testing.failAfter(writes),
    crashBeforeOutboxConfirm: (store) => store.testing.crashBeforeConfirm(),
  }

  runStoreAdapterTests(options)

  it('keeps setup inspection columns aligned with create-table DDL', () => {
    const statements = ddlStatements('crux_runtime_test')
    for (const [tableName, expectedColumns] of Object.entries(
      REQUIRED_COLUMNS,
    )) {
      const statement = statements.find((item) =>
        item.includes(
          `CREATE TABLE IF NOT EXISTS "crux_runtime_test"."${tableName}"`,
        ),
      )
      expect(statement, `${tableName} create table statement`).toBeDefined()
      expect(columnsFromCreateTable(statement!)).toEqual(expectedColumns)
    }
  })

  it('setup check reports missing resources and apply is idempotent', async () => {
    const schema = `crux_runtime_setup_${Date.now()}`
    schemas.push(schema)
    const pool = createPostgresTestPool(testDatabase.url)
    const store = postgres({ pool, schema })
    stores.push({
      store,
      close: async () => {
        await store.close()
        await pool.end()
      },
    })

    await expect(store.setup.check()).resolves.toEqual({
      ok: false,
      findings: expect.arrayContaining([
        expect.objectContaining({ code: 'SETUP_REQUIRED' }),
      ]),
    })
    await expect(store.setup.apply()).resolves.toEqual({
      ok: true,
      findings: [],
    })
    await expect(store.setup.apply()).resolves.toEqual({
      ok: true,
      findings: [],
    })
    await expect(store.setup.check()).resolves.toEqual({
      ok: true,
      findings: [],
    })
  })

  it('setup check reports missing additive migration columns', async () => {
    const schema = `crux_runtime_setup_columns_${Date.now()}`
    schemas.push(schema)
    const storePool = createPostgresTestPool(testDatabase.url)
    const store = postgres({ pool: storePool, schema })
    stores.push({
      store,
      close: async () => {
        await store.close()
        await storePool.end()
      },
    })
    await store.setup.apply()

    const pool = createPostgresTestPool(testDatabase.url)
    try {
      await pool.query(
        `ALTER TABLE ${quoteIdent(schema)}.snapshots DROP COLUMN delivered_suspends`,
      )
    } finally {
      await pool.end()
    }

    await expect(store.setup.check()).resolves.toEqual({
      ok: false,
      findings: expect.arrayContaining([
        expect.objectContaining({
          code: 'SETUP_REQUIRED',
          resource: `schema ${schema} table snapshots column delivered_suspends`,
        }),
      ]),
    })
  })

  it('outbox claims use row locking so concurrent claimers get distinct rows', async () => {
    const store = await createStore()
    const targetId = 'review' as RuntimeTargetId

    const first = await store.outbox.put({
      v: 1,
      ns: 'tenant-a',
      workId: 'work_claim_1' as WorkId,
      target: targetId,
      kind: 'flow.resume',
      idempotencyKey: 'resume:work_claim_1',
      attempt: 1,
    })
    const second = await store.outbox.put({
      v: 1,
      ns: 'tenant-a',
      workId: 'work_claim_2' as WorkId,
      target: targetId,
      kind: 'flow.resume',
      idempotencyKey: 'resume:work_claim_2',
      attempt: 1,
    })

    let releaseFirst!: () => void
    let firstTransaction!: Promise<void>
    const firstClaimReady = new Promise<readonly RuntimeOutboxItem[]>(
      (resolve, reject) => {
        firstTransaction = store.transact(async (tx) => {
          const claimed = await tx.outbox.claimPending({
            namespace: 'tenant-a',
            now: new Date(),
            limit: 1,
          })
          resolve(claimed)
          await new Promise<void>((release) => {
            releaseFirst = release
          })
        })
        firstTransaction.catch(reject)
      },
    )

    const firstClaimed = await firstClaimReady
    const secondClaimed = await store.outbox.claimPending({
      namespace: 'tenant-a',
      now: new Date(),
      limit: 1,
    })
    releaseFirst()
    await firstTransaction

    expect(
      new Set([firstClaimed[0]?.outboxId, secondClaimed[0]?.outboxId]),
    ).toEqual(new Set([first.outboxId, second.outboxId]))
  })

  it('finalize vs abandon has exactly one winner; retry is idempotent; no resurrection', async () => {
    const store = await createStore()
    const run = createPostgresCompositeRunner(store)
    const leaseToken = 'lease_pg_race' as LeaseToken
    const scopeId = 'scope_pg_race' as DeferredScopeId
    const intentId = 'intent_pg_race' as DeferredIntentId

    const staged = await run('defer.stage', {
      namespace: 'tenant-a',
      scopeId,
      intentId,
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'pg-race' },
    })

    const contenders = await Promise.all([
      run('defer.finalize', {
        namespace: 'tenant-a',
        scopeId,
        leaseToken,
        outcome: 'success',
      }),
      run('defer.abandon', {
        namespace: 'tenant-a',
        scopeId,
        leaseToken,
        reason: 'expired',
      }),
    ])
    const applied = contenders.filter((result) => result.applied)
    expect(applied).toHaveLength(1)
    const winner = applied[0]!
    expect(['finalized', 'abandoned']).toContain(winner.terminal)

    // Retry of both transitions is idempotent / non-resurrecting.
    await expect(
      run('defer.finalize', {
        namespace: 'tenant-a',
        scopeId,
        leaseToken,
        outcome: 'success',
      }),
    ).resolves.toMatchObject({ applied: false, terminal: winner.terminal })
    await expect(
      run('defer.abandon', {
        namespace: 'tenant-a',
        scopeId,
        leaseToken,
        reason: 'retry',
      }),
    ).resolves.toMatchObject({ applied: false, terminal: winner.terminal })

    const scope = await store.deferred.getScope(scopeId, {
      namespace: 'tenant-a',
    })
    const intent = await store.deferred.getIntent(intentId, {
      namespace: 'tenant-a',
    })
    expect(scope?.finalization.state).toBe(winner.terminal)
    expect(intent?.state).toBe(
      winner.terminal === 'finalized' ? 'released' : 'abandoned',
    )
    if (winner.terminal === 'finalized') {
      await expect(
        store.state.getWork(staged.workId, { namespace: 'tenant-a' }),
      ).resolves.toMatchObject({ status: 'pending' })
    } else {
      await expect(
        store.state.getWork(staged.workId, { namespace: 'tenant-a' }),
      ).resolves.toBeNull()
      await expect(
        store.outbox.list({ namespace: 'tenant-a', state: 'pending' }),
      ).resolves.toEqual([])
    }
  })

  it('returns a stable workId when the same intent is staged concurrently', async () => {
    const store = await createStore()
    const run = createPostgresCompositeRunner(store)
    const input = {
      namespace: 'tenant-a',
      scopeId: 'scope_pg_dup' as DeferredScopeId,
      intentId: 'intent_pg_dup' as DeferredIntentId,
      leaseToken: 'lease_pg_dup' as LeaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'dup' },
    }

    const [first, second] = await Promise.all([
      run('defer.stage', input),
      run('defer.stage', input),
    ])
    expect(first.workId).toBe(second.workId)
    await expect(
      store.deferred.getIntent(input.intentId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ workId: first.workId, state: 'staged' })
  })

  it('createIntent round-trips named defer provenance including scheduledSpanId', async () => {
    const store = await createStore()
    const now = new Date('2026-07-12T00:00:00.000Z')
    const intentId = 'intent_pg_prov' as DeferredIntentId
    const provenance = {
      mode: 'named',
      sequence: 0,
      completion: 'handler-returned',
      scopeId: 'scope_pg_prov',
      workId: 'work_pg_prov',
      targetId: 'send-email',
      scheduledSpanId: 'fedcba9876543210',
      runId: 'run_pg',
      traceId: 'trace_pg',
    }
    const created = await store.transact((tx) =>
      tx.deferred.createIntent({
        namespace: 'tenant-a',
        scopeId: 'scope_pg_prov' as DeferredScopeId,
        intentId,
        workId: 'work_pg_prov' as WorkId,
        targetId: 'send-email' as RuntimeTargetId,
        input: { messageId: 'prov' },
        provenance,
        state: 'staged',
        createdAt: now,
        updatedAt: now,
      }),
    )
    expect(created.provenance).toEqual(provenance)
    await expect(
      store.deferred.getIntent(intentId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ provenance })
  })

  it('createIntent is insert-if-absent; putIntent cannot regress terminal or rewrite identity', async () => {
    const store = await createStore()
    const now = new Date('2026-07-12T00:00:00.000Z')
    const intentId = 'intent_pg_create' as DeferredIntentId
    const first = await store.transact((tx) =>
      tx.deferred.createIntent({
        namespace: 'tenant-a',
        scopeId: 'scope_pg_create' as DeferredScopeId,
        intentId,
        workId: 'work_pg_first' as WorkId,
        targetId: 'send-email' as RuntimeTargetId,
        input: { winner: true },
        state: 'staged',
        createdAt: now,
        updatedAt: now,
      }),
    )
    const second = await store.transact((tx) =>
      tx.deferred.createIntent({
        namespace: 'tenant-a',
        scopeId: 'scope_pg_create' as DeferredScopeId,
        intentId,
        workId: 'work_pg_second' as WorkId,
        targetId: 'other-target' as RuntimeTargetId,
        input: { winner: false },
        state: 'staged',
        createdAt: now,
        updatedAt: now,
      }),
    )
    expect(second.workId).toBe(first.workId)
    expect(second.targetId).toBe(first.targetId)
    expect(second.input).toEqual({ winner: true })

    await store.transact((tx) =>
      tx.deferred.putIntent({
        ...first,
        workId: 'work_overwritten' as WorkId,
        targetId: 'other' as RuntimeTargetId,
        input: { winner: false },
        state: 'released',
        updatedAt: new Date('2026-07-12T00:00:01.000Z'),
      }),
    )
    const released = await store.deferred.getIntent(intentId, {
      namespace: 'tenant-a',
    })
    expect(released).toMatchObject({
      workId: 'work_pg_first',
      targetId: 'send-email',
      input: { winner: true },
      state: 'released',
    })

    await store.transact((tx) =>
      tx.deferred.putIntent({
        ...released!,
        state: 'staged',
        updatedAt: new Date('2026-07-12T00:00:02.000Z'),
      }),
    )
    await expect(
      store.deferred.getIntent(intentId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ state: 'released' })
  })

  it('finalizes every staged sibling beyond the default listIntents page size', async () => {
    const store = await createStore()
    const run = createPostgresCompositeRunner(store)
    const leaseToken = 'lease_pg_high' as LeaseToken
    const scopeId = 'scope_pg_high' as DeferredScopeId
    const count = 150
    const workIds: string[] = []
    for (let index = 0; index < count; index += 1) {
      const intent = await run('defer.stage', {
        namespace: 'tenant-a',
        scopeId,
        intentId: `intent_pg_high_${index}` as DeferredIntentId,
        leaseToken,
        leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
        targetId: 'send-email' as RuntimeTargetId,
        input: { index },
      })
      workIds.push(intent.workId)
    }

    await expect(
      run('defer.finalize', {
        namespace: 'tenant-a',
        scopeId,
        leaseToken,
        outcome: 'success',
      }),
    ).resolves.toMatchObject({ applied: true, terminal: 'finalized' })

    const intents = await store.deferred.listIntents({
      namespace: 'tenant-a',
      scopeId,
      limit: count + 10,
    })
    expect(intents).toHaveLength(count)
    expect(intents.every((intent) => intent.state === 'released')).toBe(true)
    const stagedRemaining = await store.deferred.listIntents({
      namespace: 'tenant-a',
      scopeId,
      state: 'staged',
      limit: count + 10,
    })
    expect(stagedRemaining).toEqual([])
    const wakes = await store.outbox.list({
      namespace: 'tenant-a',
      state: 'pending',
      limit: count + 10,
    })
    expect(wakes).toHaveLength(count)
    expect(new Set(wakes.map((wake) => wake.envelope.workId))).toEqual(
      new Set(workIds),
    )
  })

  it('initial-row create is insert-if-absent and cannot reopen terminal fencing under READ COMMITTED', async () => {
    const store = await createStore()
    const schema = schemas.at(-1)!
    const pool = createPostgresTestPool(testDatabase.url)
    const scopesTable = `${quoteIdent(schema)}.${quoteIdent('defer_scopes')}`
    const namespace = 'tenant-a'
    const scopeId = 'scope_initial_row'
    const tokenA = 'lease_token_a'
    const tokenB = 'lease_token_b'
    const now = new Date('2026-07-12T00:00:00.000Z')
    const expiryA = new Date('2026-07-12T00:01:00.000Z')
    const expiryB = new Date('2026-07-12T00:02:00.000Z')

    const clientA = await pool.connect()
    const clientB = await pool.connect()
    try {
      // Controlled interleaving: both miss, A inserts+finalizes+commits,
      // then B's delayed create must not overwrite terminal/fencing state.
      await clientA.query('BEGIN')
      await clientB.query('BEGIN')

      const missA = await clientA.query(
        `SELECT scope_id FROM ${scopesTable}
          WHERE namespace = $1 AND scope_id = $2
          FOR UPDATE`,
        [namespace, scopeId],
      )
      const missB = await clientB.query(
        `SELECT scope_id FROM ${scopesTable}
          WHERE namespace = $1 AND scope_id = $2
          FOR UPDATE`,
        [namespace, scopeId],
      )
      expect(missA.rows).toHaveLength(0)
      expect(missB.rows).toHaveLength(0)

      await clientA.query(
        `INSERT INTO ${scopesTable}
          (namespace, scope_id, lease_token, lease_expires_at, finalization,
           created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT (namespace, scope_id) DO NOTHING`,
        [
          namespace,
          scopeId,
          tokenA,
          expiryA,
          JSON.stringify({ state: 'open' }),
          now,
          now,
        ],
      )
      await clientA.query(
        `UPDATE ${scopesTable}
            SET finalization = $3::jsonb,
                updated_at = $4
          WHERE namespace = $1 AND scope_id = $2`,
        [
          namespace,
          scopeId,
          JSON.stringify({
            state: 'finalized',
            outcome: 'success',
            finalizedAt: now.toISOString(),
          }),
          now,
        ],
      )
      await clientA.query('COMMIT')

      // Delayed initial-row create with a distinct token (insert-if-absent).
      await clientB.query(
        `INSERT INTO ${scopesTable}
          (namespace, scope_id, lease_token, lease_expires_at, finalization,
           created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT (namespace, scope_id) DO NOTHING`,
        [
          namespace,
          scopeId,
          tokenB,
          expiryB,
          JSON.stringify({ state: 'open' }),
          now,
          now,
        ],
      )
      await clientB.query('COMMIT')

      const final = await pool.query(
        `SELECT lease_token, finalization
           FROM ${scopesTable}
          WHERE namespace = $1 AND scope_id = $2`,
        [namespace, scopeId],
      )
      expect(final.rows).toHaveLength(1)
      expect(final.rows[0]?.lease_token).toBe(tokenA)
      expect(final.rows[0]?.finalization).toMatchObject({
        state: 'finalized',
        outcome: 'success',
      })
    } finally {
      clientA.release()
      clientB.release()
    }

    // Store-level createScope after terminal returns the accepted owner unchanged.
    const delayed = await store.transact((tx) =>
      tx.deferred.createScope({
        namespace,
        scopeId: scopeId as DeferredScopeId,
        leaseToken: tokenB as LeaseToken,
        leaseExpiresAt: expiryB,
        finalization: { state: 'open' },
        createdAt: now,
        updatedAt: now,
      }),
    )
    expect(delayed.leaseToken).toBe(tokenA)
    expect(delayed.finalization).toMatchObject({ state: 'finalized' })

    // Concurrent createScope with distinct tokens accepts exactly one owner.
    const raceScopeId = 'scope_initial_race' as DeferredScopeId
    const [createdA, createdB] = await Promise.all([
      store.transact((tx) =>
        tx.deferred.createScope({
          namespace,
          scopeId: raceScopeId,
          leaseToken: tokenA as LeaseToken,
          leaseExpiresAt: expiryA,
          finalization: { state: 'open' },
          createdAt: now,
          updatedAt: now,
        }),
      ),
      store.transact((tx) =>
        tx.deferred.createScope({
          namespace,
          scopeId: raceScopeId,
          leaseToken: tokenB as LeaseToken,
          leaseExpiresAt: expiryB,
          finalization: { state: 'open' },
          createdAt: now,
          updatedAt: now,
        }),
      ),
    ])
    expect(createdA.leaseToken).toBe(createdB.leaseToken)
    expect([tokenA, tokenB]).toContain(createdA.leaseToken)
    const raced = await store.deferred.getScope(raceScopeId, { namespace })
    expect(raced?.leaseToken).toBe(createdA.leaseToken)
    expect(raced?.finalization).toEqual({ state: 'open' })

    await pool.end()
  })

  it('staging after a terminal scope cannot reopen it with a distinct token', async () => {
    const store = await createStore()
    const run = createPostgresCompositeRunner(store)
    const scopeId = 'scope_no_reopen' as DeferredScopeId
    const tokenA = 'lease_owner' as LeaseToken
    const tokenB = 'lease_stale_creator' as LeaseToken

    await run('defer.stage', {
      namespace: 'tenant-a',
      scopeId,
      intentId: 'intent_owner' as DeferredIntentId,
      leaseToken: tokenA,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'owner' },
    })
    await run('defer.finalize', {
      namespace: 'tenant-a',
      scopeId,
      leaseToken: tokenA,
      outcome: 'success',
    })

    await expect(
      run('defer.stage', {
        namespace: 'tenant-a',
        scopeId,
        intentId: 'intent_stale' as DeferredIntentId,
        leaseToken: tokenB,
        leaseExpiresAt: new Date('2026-07-12T00:05:00.000Z'),
        targetId: 'send-email' as RuntimeTargetId,
        input: { messageId: 'stale' },
      }),
    ).rejects.toThrow(/missing or already terminal/)

    await expect(
      store.deferred.getScope(scopeId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      leaseToken: tokenA,
      finalization: { state: 'finalized' },
    })
  })

  it('putScope is monotonic under row-lock updates: no reopen or terminal flip', async () => {
    const store = await createStore()
    const now = new Date('2026-07-12T00:00:00.000Z')
    const scopeId = 'scope_pg_mono' as DeferredScopeId
    const token = 'lease_pg_mono' as LeaseToken
    const open = await store.transact((tx) =>
      tx.deferred.createScope({
        namespace: 'tenant-a',
        scopeId,
        leaseToken: token,
        leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
        finalization: { state: 'open' },
        createdAt: now,
        updatedAt: now,
      }),
    )
    // Open renew allowed.
    await store.transact((tx) =>
      tx.deferred.putScope({
        ...open,
        leaseExpiresAt: new Date('2026-07-12T00:02:00.000Z'),
        updatedAt: new Date('2026-07-12T00:00:01.000Z'),
      }),
    )
    await store.transact((tx) =>
      tx.deferred.putScope({
        ...open,
        finalization: {
          state: 'finalized',
          outcome: 'success',
          finalizedAt: new Date('2026-07-12T00:00:02.000Z'),
        },
        updatedAt: new Date('2026-07-12T00:00:02.000Z'),
      }),
    )
    // Reopen and flip must no-op (0-row conditional update).
    await store.transact((tx) =>
      tx.deferred.putScope({
        ...open,
        finalization: { state: 'open' },
        leaseToken: 'lease_reopen' as LeaseToken,
        updatedAt: new Date('2026-07-12T00:00:03.000Z'),
      }),
    )
    await store.transact((tx) =>
      tx.deferred.putScope({
        ...open,
        finalization: {
          state: 'abandoned',
          abandonedAt: new Date('2026-07-12T00:00:04.000Z'),
          reason: 'flip',
        },
        updatedAt: new Date('2026-07-12T00:00:04.000Z'),
      }),
    )
    await expect(
      store.deferred.getScope(scopeId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      leaseToken: token,
      finalization: { state: 'finalized', outcome: 'success' },
    })
  })
})

function createPostgresCompositeRunner(
  store: PostgresRuntimeStore,
): RuntimeCompositeRunner {
  let nextWorkId = 0
  return (kind, input) =>
    runDefaultRuntimeComposite(
      store,
      {
        now: () => new Date('2026-07-12T00:00:00.000Z'),
        newWorkId: () => `work_pg_defer_${++nextWorkId}` as WorkId,
      },
      kind,
      input,
    )
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function snapshotFixture(
  flowId: string,
  scheduledWork: NonNullable<FlowSnapshot['scheduledWork']>,
): FlowSnapshot {
  return {
    flowId: flowId as FlowId,
    workId: 'work_parent' as WorkId,
    targetId: 'review' as RuntimeTargetId,
    namespace: 'tenant-a',
    status: 'suspended',
    input: {},
    completedSteps: {},
    fingerprint: [],
    pendingSuspends: [],
    scheduledWork,
    updatedAt: new Date('2026-07-12T00:00:00.000Z'),
  }
}

function columnsFromCreateTable(statement: string): readonly string[] {
  return statement
    .split('\n')
    .map((line) => line.trim())
    .map((line) => line.match(/^([a-z_]+)\s/)?.[1])
    .filter(
      (column): column is string => Boolean(column) && column !== 'PRIMARY',
    )
}
