import { expect, it, vi } from 'vitest'
import { createRuntimeKernel } from '../engine/kernel'
import { createOutboxDispatcher } from '../engine/outbox'
import type {
  DeferredIntentId,
  DeferredScopeId,
  RuntimeTargetId,
  WorkId,
} from '../ports'
import type { RuntimeStoreAdapter } from '../store'
import type { RunStoreAdapterTestsOptions } from './store-types'

/** Register adapter-independent recovery checks for durable deferred intents. */
export function registerDeferredRecoveryTests<
  TStore extends RuntimeStoreAdapter,
>(options: RunStoreAdapterTestsOptions<TStore>): void {
  it('invariant: staged work survives kernel reconstruction and is abandoned after liveness expiry', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'))
      const store = await options.createStore()
      const lease = await store.leases.claim(
        'defer:scope_crash_before_finalize',
        {
          ttlMs: 1_000,
        },
      )
      expect(lease).not.toBeNull()
      const firstKernel = recoveryKernel(store)
      const intent = await firstKernel.stageDeferredIntent({
        namespace: 'tenant-a',
        scopeId: 'scope_crash_before_finalize' as DeferredScopeId,
        intentId: 'intent_crash_before_finalize' as DeferredIntentId,
        leaseToken: lease!.token,
        leaseExpiresAt: lease!.expiresAt,
        targetId: 'send-email' as RuntimeTargetId,
        input: { messageId: 'message_1' },
      })

      vi.advanceTimersByTime(1_001)
      const reconstructed = recoveryKernel(store)
      await expect(
        reconstructed.maintenanceTick({
          namespace: 'tenant-a',
          now: new Date(),
        }),
      ).resolves.toMatchObject({ deferredScopesAbandoned: 1 })
      await expect(
        store.deferred.getIntent(intent.intentId, { namespace: 'tenant-a' }),
      ).resolves.toMatchObject({ state: 'abandoned' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('invariant: released work and its wake survive kernel reconstruction before dispatch', async () => {
    const store = await options.createStore()
    const lease = await store.leases.claim(
      'defer:scope_crash_before_dispatch',
      {
        ttlMs: 60_000,
      },
    )
    expect(lease).not.toBeNull()
    const firstKernel = recoveryKernel(store)
    const intent = await firstKernel.stageDeferredIntent({
      namespace: 'tenant-a',
      scopeId: 'scope_crash_before_dispatch' as DeferredScopeId,
      intentId: 'intent_crash_before_dispatch' as DeferredIntentId,
      leaseToken: lease!.token,
      leaseExpiresAt: lease!.expiresAt,
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'message_2' },
    })
    await firstKernel.finalizeDeferredScope({
      namespace: 'tenant-a',
      scopeId: 'scope_crash_before_dispatch' as DeferredScopeId,
      leaseToken: lease!.token,
      outcome: 'success',
    })

    const delivered: WorkId[] = []
    const reconstructedDispatcher = createOutboxDispatcher({
      store,
      namespace: 'tenant-a',
      deliver: async (envelope) => {
        delivered.push(envelope.workId)
      },
    })
    await expect(reconstructedDispatcher.nudge()).resolves.toEqual({
      delivered: 1,
      failed: 0,
    })
    expect(delivered).toEqual([intent.workId])
  })

  it('invariant: a crash after dispatch but before confirmation redelivers the same wake identity', async () => {
    const store = await options.createStore()
    const workId = 'work_dispatched_crash' as WorkId
    const outbox = await store.outbox.put({
      v: 1,
      ns: 'tenant-a',
      workId,
      target: 'send-email' as RuntimeTargetId,
      kind: 'task.run',
      idempotencyKey: 'task:work_dispatched_crash',
      attempt: 1,
    })
    await expect(
      store.outbox.claimPending({
        namespace: 'tenant-a',
        now: new Date(),
        limit: 1,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ outboxId: outbox.outboxId, attempts: 1 }),
    ])

    await expect(
      store.outbox.claimPending({
        namespace: 'tenant-a',
        now: new Date(),
        limit: 1,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        outboxId: outbox.outboxId,
        attempts: 2,
        envelope: expect.objectContaining({ workId }),
      }),
    ])
  })
}

function recoveryKernel(store: RuntimeStoreAdapter) {
  let nextWorkId = 0
  return createRuntimeKernel({
    store,
    targets: {},
    newWorkId: () => `work_recovery_${++nextWorkId}` as WorkId,
    leaseTtlMs: 1_000,
    leaseExtension: false,
  })
}
