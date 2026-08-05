import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { postgres, type PostgresRuntimeStore } from '../src/runtime'
import {
  createPostgresTestPool,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from './test-database'

describe('PostgreSQL Session subscription port', () => {
  let testDatabase: PostgresTestDatabase
  const stores: Array<{ store: PostgresRuntimeStore; close: () => Promise<void> }> =
    []
  let schemaCount = 0

  async function createStore(): Promise<PostgresRuntimeStore> {
    const schema = `crux_session_sub_${process.pid}_${schemaCount++}`
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

  afterEach(async () => {
    await Promise.all(stores.splice(0).map(({ close }) => close()))
  })

  afterAll(async () => {
    await testDatabase?.close()
  })

  async function prepareFlowSession(store: PostgresRuntimeStore) {
    const now = new Date('2026-08-05T00:00:00.000Z')
    const created = await store.transact(async (tx) => {
      if (!tx.sessions) throw new Error('missing sessions')
      return tx.sessions.create({
        namespace: 'sub-ns',
        sessionId: 'session_sub_1',
        keyHash: 'key_sub_1',
        targetId: 'flow-sub',
        targetKind: 'flow',
        threadId: 'thread_sub_1',
        definition: {
          targetId: 'flow-sub' as never,
          definitionId: 'flow:flow-sub',
          fingerprint: 'v1',
          manifestHash: 'manifest-v1',
        },
        now,
      })
    })
    await store.transact(async (tx) => {
      if (!tx.sessions) throw new Error('missing sessions')
      await tx.sessions.markReady('sub-ns', created.session.sessionId, now)
    })
    return { now, sessionId: created.session.sessionId }
  }

  it('upserts by canonical key-order match identity and reactivates after unsubscribe', async () => {
    const store = await createStore()
    const { now, sessionId } = await prepareFlowSession(store)
    const first = await store.transact(async (tx) => {
      if (!tx.sessions?.upsertSubscription) throw new Error('missing subs')
      return tx.sessions.upsertSubscription({
        namespace: 'sub-ns',
        sessionId,
        subscriptionId: 'subscription_a',
        signalId: 'orders.changed',
        match: { env: 'prod', repo: 'crux' },
        now,
      })
    })
    const second = await store.transact(async (tx) => {
      if (!tx.sessions?.upsertSubscription) throw new Error('missing subs')
      return tx.sessions.upsertSubscription({
        namespace: 'sub-ns',
        sessionId,
        subscriptionId: 'subscription_b',
        signalId: 'orders.changed',
        match: { repo: 'crux', env: 'prod' },
        now: new Date(now.getTime() + 1_000),
      })
    })
    expect(second.subscriptionId).toBe(first.subscriptionId)
    expect(second.matchKey).toBe(first.matchKey)
    expect(second.state).toBe('active')

    await store.transact(async (tx) => {
      if (!tx.sessions?.unsubscribe) throw new Error('missing subs')
      await tx.sessions.unsubscribe(
        'sub-ns',
        sessionId,
        first.subscriptionId,
        new Date(now.getTime() + 2_000),
      )
    })
    const reactivated = await store.transact(async (tx) => {
      if (!tx.sessions?.upsertSubscription) throw new Error('missing subs')
      return tx.sessions.upsertSubscription({
        namespace: 'sub-ns',
        sessionId,
        subscriptionId: first.subscriptionId,
        signalId: 'orders.changed',
        match: { env: 'prod', repo: 'crux' },
        now: new Date(now.getTime() + 3_000),
      })
    })
    expect(reactivated.subscriptionId).toBe(first.subscriptionId)
    expect(reactivated.state).toBe('active')
    const listed = await store.transact(async (tx) => {
      if (!tx.sessions?.listSubscriptions) throw new Error('missing subs')
      return tx.sessions.listSubscriptions('sub-ns', sessionId)
    })
    expect(listed).toHaveLength(1)
    expect(listed[0]?.subscriptionId).toBe(first.subscriptionId)
  })

  it('keeps one row under concurrent same-key upserts', async () => {
    const store = await createStore()
    const { now, sessionId } = await prepareFlowSession(store)
    const match = { env: 'prod', repo: 'crux' }
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        store.transact(async (tx) => {
          if (!tx.sessions?.upsertSubscription) throw new Error('missing subs')
          return tx.sessions.upsertSubscription({
            namespace: 'sub-ns',
            sessionId,
            subscriptionId: `subscription_race_${index}`,
            signalId: 'orders.changed',
            match: index % 2 === 0 ? match : { repo: 'crux', env: 'prod' },
            now: new Date(now.getTime() + index),
          })
        }),
      ),
    )
    const ids = new Set(results.map((row) => row.subscriptionId))
    expect(ids.size).toBe(1)
    const listed = await store.transact(async (tx) => {
      if (!tx.sessions?.listSubscriptions) throw new Error('missing subs')
      return tx.sessions.listSubscriptions('sub-ns', sessionId)
    })
    expect(listed).toHaveLength(1)
    expect(listed[0]?.subscriptionId).toBe(results[0]?.subscriptionId)
  })
})
