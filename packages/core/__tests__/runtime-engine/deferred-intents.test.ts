import { describe, expect, it } from 'vitest'
import { inMemoryRuntimeStore } from '../../src/runtime/adapters/memory'
import { runDefaultRuntimeComposite } from '../../src/runtime/engine/composites'
import type {
  LeaseToken,
  RuntimeTargetId,
  WorkId,
} from '../../src/runtime/ports'

describe('durable deferred intents', () => {
  it('atomically finalizes a scope, releases every staged sibling, and writes their wakes', async () => {
    const store = inMemoryRuntimeStore()
    const runComposite = createCompositeRunner(store)
    const leaseToken = 'lease_defer_1' as LeaseToken

    const first = await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'defer_scope_1',
      intentId: 'defer_intent_1',
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'message_1' },
    })
    const second = await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'defer_scope_1',
      intentId: 'defer_intent_2',
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'write-audit' as RuntimeTargetId,
      input: { messageId: 'message_1' },
    })

    await expect(
      runComposite('defer.finalize', {
        namespace: 'tenant-a',
        scopeId: 'defer_scope_1',
        leaseToken,
        outcome: 'success',
      }),
    ).resolves.toMatchObject({ applied: true, terminal: 'finalized' })

    const scope = await store.deferred.getScope('defer_scope_1', {
      namespace: 'tenant-a',
    })
    const intents = await store.deferred.listIntents({
      namespace: 'tenant-a',
      scopeId: 'defer_scope_1',
    })
    const wakes = await store.outbox.list({
      namespace: 'tenant-a',
      state: 'pending',
    })

    expect(scope?.finalization).toMatchObject({
      state: 'finalized',
      outcome: 'success',
    })
    expect(intents).toEqual([
      expect.objectContaining({ workId: first.workId, state: 'released' }),
      expect.objectContaining({ workId: second.workId, state: 'released' }),
    ])
    expect(wakes.map((wake) => wake.envelope.workId)).toEqual([
      first.workId,
      second.workId,
    ])
    await expect(
      store.state.getWork(first.workId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ status: 'pending' })
    await expect(
      store.state.getWork(second.workId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ status: 'pending' })
  })

  it('atomically abandons staged siblings and prevents a later finalization from resurrecting them', async () => {
    const store = inMemoryRuntimeStore()
    const runComposite = createCompositeRunner(store)
    const leaseToken = 'lease_defer_2' as LeaseToken

    const staged = await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'defer_scope_2',
      intentId: 'defer_intent_3',
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'message_2' },
    })

    await expect(
      runComposite('defer.abandon', {
        namespace: 'tenant-a',
        scopeId: 'defer_scope_2',
        leaseToken,
        reason: 'staging failed',
      }),
    ).resolves.toMatchObject({ applied: true, terminal: 'abandoned' })
    await expect(
      runComposite('defer.finalize', {
        namespace: 'tenant-a',
        scopeId: 'defer_scope_2',
        leaseToken,
        outcome: 'error',
      }),
    ).resolves.toMatchObject({ applied: false, terminal: 'abandoned' })

    await expect(
      store.deferred.getIntent(staged.intentId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ state: 'abandoned' })
    await expect(
      store.state.getWork(staged.workId, { namespace: 'tenant-a' }),
    ).resolves.toBeNull()
    await expect(
      store.outbox.list({ namespace: 'tenant-a', state: 'pending' }),
    ).resolves.toEqual([])
  })

  it.each(['success', 'error', 'redirect', 'not-found', 'cancelled'] as const)(
    'releases staged work after the committed %s outcome',
    async (outcome) => {
      const store = inMemoryRuntimeStore()
      const runComposite = createCompositeRunner(store)
      const leaseToken = `lease_${outcome}` as LeaseToken
      const staged = await runComposite('defer.stage', {
        namespace: 'tenant-a',
        scopeId: `scope_${outcome}`,
        intentId: `intent_${outcome}`,
        leaseToken,
        leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
        targetId: 'send-email' as RuntimeTargetId,
        input: { outcome },
      })

      await runComposite('defer.finalize', {
        namespace: 'tenant-a',
        scopeId: `scope_${outcome}`,
        leaseToken,
        outcome,
      })

      await expect(
        store.deferred.getIntent(staged.intentId, { namespace: 'tenant-a' }),
      ).resolves.toMatchObject({ state: 'released' })
    },
  )

  it('deduplicates staging retries and gives exactly one terminal race contender the win', async () => {
    const store = inMemoryRuntimeStore()
    const runComposite = createCompositeRunner(store)
    const leaseToken = 'lease_race' as LeaseToken
    const input = {
      namespace: 'tenant-a',
      scopeId: 'scope_race',
      intentId: 'intent_race',
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'message_race' },
    }
    const first = await runComposite('defer.stage', input)
    const retry = await runComposite('defer.stage', input)
    expect(retry.workId).toBe(first.workId)

    const contenders = await Promise.all([
      runComposite('defer.finalize', {
        namespace: 'tenant-a',
        scopeId: 'scope_race',
        leaseToken,
        outcome: 'success',
      }),
      runComposite('defer.abandon', {
        namespace: 'tenant-a',
        scopeId: 'scope_race',
        leaseToken,
        reason: 'expired',
      }),
    ])
    expect(contenders.filter((result) => result.applied)).toHaveLength(1)
    const intent = await store.deferred.getIntent(first.intentId, {
      namespace: 'tenant-a',
    })
    expect(['released', 'abandoned']).toContain(intent?.state)
  })

  it('fences terminal commits from a stale scope lease token', async () => {
    const store = inMemoryRuntimeStore()
    const runComposite = createCompositeRunner(store)
    const leaseToken = 'lease_current' as LeaseToken
    await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'scope_fenced',
      intentId: 'intent_fenced',
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'message_fenced' },
    })

    await expect(
      runComposite('defer.finalize', {
        namespace: 'tenant-a',
        scopeId: 'scope_fenced',
        leaseToken: 'lease_stale' as LeaseToken,
        outcome: 'success',
      }),
    ).rejects.toMatchObject({ code: 'LEASE_LOST' })
    await expect(
      store.deferred.getScope('scope_fenced', { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ finalization: { state: 'open' } })
  })

  it('rolls back every release write when finalization fails partway through', async () => {
    const store = inMemoryRuntimeStore()
    const runComposite = createCompositeRunner(store)
    const leaseToken = 'lease_rollback' as LeaseToken
    const staged = await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'scope_rollback',
      intentId: 'intent_rollback',
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'message_rollback' },
    })
    store.testing.failAfter(1)

    await expect(
      runComposite('defer.finalize', {
        namespace: 'tenant-a',
        scopeId: 'scope_rollback',
        leaseToken,
        outcome: 'success',
      }),
    ).rejects.toThrow('Injected transaction failure')
    await expect(
      store.deferred.getIntent(staged.intentId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ state: 'staged' })
    await expect(
      store.state.getWork(staged.workId, { namespace: 'tenant-a' }),
    ).resolves.toBeNull()
  })
})

type UnsafeCompositeRunner = (
  kind: string,
  input: unknown,
) => Promise<Record<string, unknown>>

function createCompositeRunner(
  store: ReturnType<typeof inMemoryRuntimeStore>,
): UnsafeCompositeRunner {
  let nextWorkId = 0
  const run =
    runDefaultRuntimeComposite as unknown as UnsafeCompositeRunnerWithStore
  return (kind, input) =>
    run(
      store,
      {
        now: () => new Date('2026-07-12T00:00:00.000Z'),
        newWorkId: () => `work_defer_${++nextWorkId}` as WorkId,
      },
      kind,
      input,
    )
}

type UnsafeCompositeRunnerWithStore = (
  store: ReturnType<typeof inMemoryRuntimeStore>,
  deps: {
    readonly now: () => Date
    readonly newWorkId: () => WorkId
  },
  kind: string,
  input: unknown,
) => Promise<Record<string, unknown>>
