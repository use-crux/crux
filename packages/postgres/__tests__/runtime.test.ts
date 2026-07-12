import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  runStoreAdapterTests,
  type RunStoreAdapterTestsOptions,
} from '@use-crux/core/runtime/testing'
import type {
  FlowId,
  FlowSnapshot,
  RuntimeOutboxItem,
  RuntimeTargetId,
  WorkId,
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
  })

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
      await testDatabase.close()
    }
  })

  const options: RunStoreAdapterTestsOptions<PostgresRuntimeStore> = {
    name: 'postgres',
    createStore,
    failAfterWrites: (store, writes) => store.testing.failAfter(writes),
    crashBeforeOutboxConfirm: (store) => store.testing.crashBeforeConfirm(),
  }

  runStoreAdapterTests(options)

  it('reads legacy scheduled_effects rows and writes scheduled_work only', async () => {
    const store = await createStore()
    const schema = schemas.at(-1)!
    const pool = createPostgresTestPool(testDatabase.url)
    try {
      await pool.query(
        `ALTER TABLE ${quoteIdent(schema)}.snapshots
           ADD COLUMN IF NOT EXISTS scheduled_effects jsonb`,
      )
      await pool.query(
        `INSERT INTO ${quoteIdent(schema)}.snapshots
          (namespace, flow_id, work_id, target_id, status, input,
           completed_steps, fingerprint, pending_suspends, scheduled_effects,
           updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb,
                 $9::jsonb, $10::jsonb, $11)`,
        [
          'tenant-a',
          'flow_legacy',
          'work_parent',
          'review',
          'suspended',
          '{}',
          '{}',
          '[]',
          '[]',
          JSON.stringify({ 'defer:1': { workId: 'work_child' } }),
          new Date('2026-07-12T00:00:00.000Z'),
        ],
      )

      await expect(
        store.state.getSnapshot('flow_legacy' as FlowId, {
          namespace: 'tenant-a',
        }),
      ).resolves.toMatchObject({
        scheduledWork: {
          'defer:1': { workId: 'work_child' },
        },
      })

      await store.state.putSnapshot(
        snapshotFixture('flow_new', {
          'defer:1': { workId: 'work_child' as WorkId },
        }),
      )
      const written = await pool.query(
        `SELECT scheduled_work, scheduled_effects
           FROM ${quoteIdent(schema)}.snapshots
          WHERE namespace = $1 AND flow_id = $2`,
        ['tenant-a', 'flow_new'],
      )
      expect(written.rows[0]).toEqual({
        scheduled_work: { 'defer:1': { workId: 'work_child' } },
        scheduled_effects: null,
      })
    } finally {
      await pool.end()
    }
  })

  it('keeps setup-check required columns aligned with create-table DDL', () => {
    const statements = ddlStatements('crux_runtime_test')
    for (const [tableName, expectedColumns] of Object.entries(REQUIRED_COLUMNS)) {
      const statement = statements.find((item) =>
        item.includes(`CREATE TABLE IF NOT EXISTS "crux_runtime_test"."${tableName}"`),
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

    expect(new Set([firstClaimed[0]?.outboxId, secondClaimed[0]?.outboxId]))
      .toEqual(new Set([first.outboxId, second.outboxId]))
  })
})

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
    .filter((column): column is string => Boolean(column) && column !== 'PRIMARY')
}
