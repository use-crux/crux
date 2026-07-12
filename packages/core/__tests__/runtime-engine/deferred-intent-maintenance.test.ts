import { describe, expect, it, vi } from 'vitest'
import { inMemoryRuntimeStore } from '../../src/runtime/adapters/memory'
import { runDefaultRuntimeComposite } from '../../src/runtime/engine/composites'
import { createRuntimeKernel } from '../../src/runtime/engine/kernel'
import type { RuntimeTargetId, WorkId } from '../../src/runtime/ports'

describe('durable deferred intent maintenance', () => {
  it('abandons an open scope only after its lease expires', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'))
      const store = inMemoryRuntimeStore()
      const lease = await store.leases.claim('defer:scope_expired', {
        ttlMs: 1_000,
      })
      let nextWorkId = 0
      const runComposite = (
        runDefaultRuntimeComposite as unknown as UnsafeCompositeRunner
      ).bind(undefined, store, {
        now: () => new Date('2026-07-12T00:00:00.000Z'),
        newWorkId: () => `work_defer_${++nextWorkId}` as WorkId,
      })
      const staged = await runComposite('defer.stage', {
        namespace: 'tenant-a',
        scopeId: 'scope_expired',
        intentId: 'intent_expired',
        leaseToken: lease!.token,
        leaseExpiresAt: lease!.expiresAt,
        targetId: 'send-email' as RuntimeTargetId,
        input: { messageId: 'message_expired' },
      })
      const kernel = createRuntimeKernel({
        store,
        targets: {},
        newWorkId: () => 'unused' as WorkId,
        leaseTtlMs: 1_000,
      })

      await expect(
        kernel.maintenanceTick({
          namespace: 'tenant-a',
          now: new Date('2026-07-12T00:00:00.999Z'),
        }),
      ).resolves.toMatchObject({ deferredScopesAbandoned: 0 })
      vi.advanceTimersByTime(1_001)
      await expect(
        kernel.maintenanceTick({
          namespace: 'tenant-a',
          now: new Date('2026-07-12T00:00:01.001Z'),
        }),
      ).resolves.toMatchObject({ deferredScopesAbandoned: 1 })
      await expect(
        store.deferred.getIntent(staged.intentId, { namespace: 'tenant-a' }),
      ).resolves.toMatchObject({ state: 'abandoned' })
    } finally {
      vi.useRealTimers()
    }
  })
})

type UnsafeCompositeRunner = (
  store: ReturnType<typeof inMemoryRuntimeStore>,
  deps: {
    readonly now: () => Date
    readonly newWorkId: () => WorkId
  },
  kind: string,
  input: unknown,
) => Promise<Record<string, unknown>>
