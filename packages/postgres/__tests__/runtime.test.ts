import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  runStoreAdapterTests,
  type RunStoreAdapterTestsOptions,
} from '@use-crux/core/runtime/testing'
import type {
  RuntimeOutboxItem,
  RuntimeTargetId,
  WorkId,
} from '@use-crux/core/runtime'
import { Pool } from 'pg'
import { postgres, type PostgresRuntimeStore } from '../runtime'
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from './test-database'

describe('@use-crux/postgres runtime', () => {
  let testDatabase: PostgresTestDatabase
  const stores: PostgresRuntimeStore[] = []
  const schemas: string[] = []

  async function createStore(): Promise<PostgresRuntimeStore> {
    const schema = `crux_runtime_test_${Date.now()}_${schemas.length}`
    schemas.push(schema)
    const store = postgres({ url: testDatabase.url, schema })
    stores.push(store)
    await store.setup.apply()
    return store
  }

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase()
  })

  afterAll(async () => {
    const cleanup = new Pool({ connectionString: testDatabase.url })
    try {
      for (const schema of schemas) {
        await cleanup.query(
          `DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`,
        )
      }
    } finally {
      await cleanup.end()
      await Promise.all(stores.map((store) => store.close()))
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

  it('setup check reports missing resources and apply is idempotent', async () => {
    const schema = `crux_runtime_setup_${Date.now()}`
    schemas.push(schema)
    const store = postgres({ url: testDatabase.url, schema })
    stores.push(store)

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
