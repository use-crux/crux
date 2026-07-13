import { describe, expect, it, vi } from 'vitest'
import { inMemoryRuntimeStore } from '../../src/runtime/adapters/memory'
import {
  runDefaultRuntimeComposite,
  type RuntimeCompositeDeps,
  type RuntimeCompositeRunner,
} from '../../src/runtime/engine/composites'
import { createRuntimeKernel } from '../../src/runtime/engine/kernel'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import type {
  DeferredIntentId,
  DeferredScopeId,
  LeaseToken,
  RuntimeTargetId,
  WorkId,
} from '../../src/runtime/ports'
import type { RuntimeStoreAdapter } from '../../src/runtime/store'

describe('durable deferred intent maintenance', () => {
  it('persists process-death abandonment without inventing a span closure', async () => {
    vi.useFakeTimers()
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    try {
      vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'))
      const store = inMemoryRuntimeStore()
      const lease = await store.leases.claim('defer:scope_expired', {
        ttlMs: 1_000,
      })
      const runComposite = createCompositeRunner(store, {
        now: () => new Date('2026-07-12T00:00:00.000Z'),
      })
      const staged = await runComposite('defer.stage', {
        namespace: 'tenant-a',
        scopeId: 'scope_expired' as DeferredScopeId,
        intentId: 'intent_expired' as DeferredIntentId,
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
      // Maintenance has only recovered durable state; the original process and
      // its in-process span are gone, so no cross-process closure is emitted.
      await observe.flush()
      expect(transport.records).toEqual([])
    } finally {
      vi.useRealTimers()
      resetObservabilityRuntime()
    }
  })

  it('persists scope lease renewal so a live owner stays out of expiry maintenance', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'))
      const store = inMemoryRuntimeStore()
      const lease = await store.leases.claim('defer:scope_renewed', {
        ttlMs: 1_000,
      })
      const now = () => new Date()
      const runComposite = createCompositeRunner(store, { now })
      await runComposite('defer.stage', {
        namespace: 'tenant-a',
        scopeId: 'scope_renewed' as DeferredScopeId,
        intentId: 'intent_renewed' as DeferredIntentId,
        leaseToken: lease!.token,
        leaseExpiresAt: lease!.expiresAt,
        targetId: 'send-email' as RuntimeTargetId,
        input: { messageId: 'message_renewed' },
      })

      vi.advanceTimersByTime(900)
      const renewedExpiry = new Date(Date.now() + 1_000)
      await expect(
        runComposite('defer.renew', {
          namespace: 'tenant-a',
          scopeId: 'scope_renewed' as DeferredScopeId,
          leaseToken: lease!.token,
          leaseExpiresAt: renewedExpiry,
        }),
      ).resolves.toMatchObject({ renewed: true })

      const kernel = createRuntimeKernel({
        store,
        targets: {},
        newWorkId: () => 'unused' as WorkId,
        leaseTtlMs: 1_000,
      })
      // Original TTL has elapsed, but the persisted scope expiry was renewed.
      await expect(
        kernel.maintenanceTick({
          namespace: 'tenant-a',
          now: new Date(),
        }),
      ).resolves.toMatchObject({ deferredScopesAbandoned: 0 })
      await expect(
        store.deferred.getScope('scope_renewed' as DeferredScopeId, {
          namespace: 'tenant-a',
        }),
      ).resolves.toMatchObject({
        finalization: { state: 'open' },
        leaseExpiresAt: renewedExpiry,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('production heartbeat renews persisted scope fencing after lease-store extend', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'))
      const { createTestRuntime } =
        await import('../../src/runtime/testing/test-runtime')
      const { durableTask } = await import('../../src/runtime/api/task')
      const { createDurableDeferController } =
        await import('../../src/defer/internal/durable')
      const target = durableTask('heartbeat-target', {
        run: async (input: { readonly id: string }) => input.id,
      })
      const testRuntime = createTestRuntime({ targets: [target] })
      const store = testRuntime.store
      let heartbeatOutcome!: Promise<'renewed' | 'poisoned'>
      let resolveHeartbeat!: (outcome: 'renewed' | 'poisoned') => void
      heartbeatOutcome = new Promise((resolve) => {
        resolveHeartbeat = resolve
      })

      try {
        const controller = createDurableDeferController(
          {
            completion: 'handler-returned',
            limits: {
              maxDrainMs: 1_000,
              maxCallbacks: 10,
              concurrency: 1,
              maxNestingDepth: 3,
            },
            supportsInline: true,
            durableFinalization: true,
            schedule() {},
          },
          {
            onStaged() {},
            onTerminal() {},
            onHeartbeat(outcome) {
              resolveHeartbeat(outcome)
            },
          },
        )
        await controller.stage(target, { id: 'hb-1' })
        const scopesBefore = await store.deferred.listScopes({
          namespace: 'local',
          state: 'open',
        })
        expect(scopesBefore).toHaveLength(1)
        const scopeBefore = scopesBefore[0]!
        const originalExpiry = scopeBefore.leaseExpiresAt.getTime()
        const ownerToken = scopeBefore.leaseToken

        // Durable heartbeat interval is leaseTtl/3 (60s / 3 = 20s).
        await vi.advanceTimersByTimeAsync(20_000)
        await expect(heartbeatOutcome).resolves.toBe('renewed')

        const scopeAfter = await store.deferred.getScope(scopeBefore.scopeId, {
          namespace: 'local',
        })
        expect(scopeAfter?.leaseExpiresAt.getTime()).toBeGreaterThan(
          originalExpiry,
        )
        expect(scopeAfter?.leaseToken).toBe(ownerToken)
        // Owner still holds the lease-store resource after a successful renew.
        await expect(
          store.leases.claim(`defer:${scopeBefore.scopeId}`, { ttlMs: 1_000 }),
        ).resolves.toBeNull()
        await controller.commit('success', Promise.resolve())
      } finally {
        testRuntime.dispose()
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('poisons, stops, and releases lease-store ownership when scope renew fails after extend', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'))
      const { createTestRuntime } =
        await import('../../src/runtime/testing/test-runtime')
      const { durableTask } = await import('../../src/runtime/api/task')
      const { createDurableDeferController } =
        await import('../../src/defer/internal/durable')
      const target = durableTask('heartbeat-poison-target', {
        run: async (input: { readonly id: string }) => input.id,
      })
      const testRuntime = createTestRuntime({ targets: [target] })
      const store = testRuntime.store
      let heartbeatOutcome!: Promise<'renewed' | 'poisoned'>
      let resolveHeartbeat!: (outcome: 'renewed' | 'poisoned') => void
      heartbeatOutcome = new Promise((resolve) => {
        resolveHeartbeat = resolve
      })
      let extendCount = 0
      const originalExtend = store.leases.extend.bind(store.leases)
      store.leases.extend = async (lease, ttlMs) => {
        extendCount += 1
        return originalExtend(lease, ttlMs)
      }

      try {
        const controller = createDurableDeferController(
          {
            completion: 'handler-returned',
            limits: {
              maxDrainMs: 1_000,
              maxCallbacks: 10,
              concurrency: 1,
              maxNestingDepth: 3,
            },
            supportsInline: true,
            durableFinalization: true,
            schedule() {},
          },
          {
            onStaged() {},
            onTerminal() {},
            onHeartbeat(outcome) {
              resolveHeartbeat(outcome)
            },
          },
        )
        await controller.stage(target, { id: 'poison-1' })
        const scopes = await store.deferred.listScopes({
          namespace: 'local',
          state: 'open',
        })
        const scope = scopes[0]!
        const expiryBeforeBeat = scope.leaseExpiresAt.getTime()
        const resource = `defer:${scope.scopeId}`

        // Next composite write fails: renew's putScope is the first write.
        store.testing.failAfter(0)

        await vi.advanceTimersByTimeAsync(20_000)
        await expect(heartbeatOutcome).resolves.toBe('poisoned')

        // Lease-store extended once, but persisted scope fencing must not advance.
        expect(extendCount).toBe(1)
        await expect(
          store.deferred.getScope(scope.scopeId, { namespace: 'local' }),
        ).resolves.toMatchObject({
          leaseExpiresAt: new Date(expiryBeforeBeat),
          finalization: { state: 'open' },
        })

        // Ownership released so maintenance can claim after durable expiry.
        const maintenanceClaim = await store.leases.claim(resource, {
          ttlMs: 1_000,
        })
        expect(maintenanceClaim).not.toBeNull()
        await store.leases.release(maintenanceClaim!)

        // Sticky poison: commit fails; cleanup remains idempotent.
        await expect(
          controller.commit('success', Promise.resolve()),
        ).rejects.toBeTruthy()

        // No further extends after poison stopped the heartbeat.
        const extendsAfterPoison = extendCount
        await vi.advanceTimersByTimeAsync(40_000)
        expect(extendCount).toBe(extendsAfterPoison)
      } finally {
        testRuntime.dispose()
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('allows pre-first-stage renew (scope null) to advance the active lease', async () => {
    const store = inMemoryRuntimeStore()
    const runComposite = createCompositeRunner(store)
    await expect(
      runComposite('defer.renew', {
        namespace: 'tenant-a',
        scopeId: 'scope_pre_stage' as DeferredScopeId,
        leaseToken: 'lease_pre_stage' as LeaseToken,
        leaseExpiresAt: new Date('2026-07-12T00:02:00.000Z'),
      }),
    ).resolves.toEqual({ renewed: false, scope: null })
  })

  it('open matching-token renew succeeds; token mismatch throws LEASE_LOST', async () => {
    const store = inMemoryRuntimeStore()
    const runComposite = createCompositeRunner(store)
    const leaseToken = 'lease_open_renew' as LeaseToken
    await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'scope_open_renew' as DeferredScopeId,
      intentId: 'intent_open_renew' as DeferredIntentId,
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'open-renew' },
    })
    const nextExpiry = new Date('2026-07-12T00:05:00.000Z')
    await expect(
      runComposite('defer.renew', {
        namespace: 'tenant-a',
        scopeId: 'scope_open_renew' as DeferredScopeId,
        leaseToken,
        leaseExpiresAt: nextExpiry,
      }),
    ).resolves.toMatchObject({
      renewed: true,
      scope: {
        finalization: { state: 'open' },
        leaseExpiresAt: nextExpiry,
      },
    })
    await expect(
      runComposite('defer.renew', {
        namespace: 'tenant-a',
        scopeId: 'scope_open_renew' as DeferredScopeId,
        leaseToken: 'lease_stale' as LeaseToken,
        leaseExpiresAt: new Date('2026-07-12T00:06:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'LEASE_LOST' })
  })

  it('non-open renew returns renewed:false so durable heartbeat can poison', async () => {
    const store = inMemoryRuntimeStore()
    const runComposite = createCompositeRunner(store)
    const leaseToken = 'lease_terminal' as LeaseToken
    await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'scope_terminal' as DeferredScopeId,
      intentId: 'intent_terminal' as DeferredIntentId,
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'terminal' },
    })
    await runComposite('defer.finalize', {
      namespace: 'tenant-a',
      scopeId: 'scope_terminal' as DeferredScopeId,
      leaseToken,
      outcome: 'success',
    })
    await expect(
      runComposite('defer.renew', {
        namespace: 'tenant-a',
        scopeId: 'scope_terminal' as DeferredScopeId,
        leaseToken,
        leaseExpiresAt: new Date('2026-07-12T00:05:00.000Z'),
      }),
    ).resolves.toMatchObject({
      renewed: false,
      scope: { finalization: { state: 'finalized' } },
    })
  })

  it('expire reports observed state without claiming terminal when not applied', async () => {
    const store = inMemoryRuntimeStore()
    const runComposite = createCompositeRunner(store, {
      now: () => new Date('2026-07-12T00:00:02.000Z'),
    })
    const owner = 'lease_expire_obs' as LeaseToken
    const maintenance = 'lease_maint_obs' as LeaseToken

    await expect(
      runComposite('defer.expire', {
        namespace: 'tenant-a',
        scopeId: 'scope_expire_missing' as DeferredScopeId,
        observedLeaseToken: owner,
        maintenanceLeaseToken: maintenance,
        reason: 'missing',
      }),
    ).resolves.toEqual({ applied: false, observed: 'missing' })

    await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'scope_expire_live' as DeferredScopeId,
      intentId: 'intent_expire_live' as DeferredIntentId,
      leaseToken: owner,
      leaseExpiresAt: new Date('2026-07-12T00:00:05.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { id: 'live' },
    })
    // Fresh expiry (still open) must not claim terminal abandoned.
    await expect(
      runComposite('defer.expire', {
        namespace: 'tenant-a',
        scopeId: 'scope_expire_live' as DeferredScopeId,
        observedLeaseToken: owner,
        maintenanceLeaseToken: maintenance,
        reason: 'still live',
      }),
    ).resolves.toEqual({ applied: false, observed: 'open' })

    // Token mismatch while open.
    await expect(
      runComposite('defer.expire', {
        namespace: 'tenant-a',
        scopeId: 'scope_expire_live' as DeferredScopeId,
        observedLeaseToken: 'lease_other' as LeaseToken,
        maintenanceLeaseToken: maintenance,
        reason: 'token mismatch',
      }),
    ).resolves.toEqual({ applied: false, observed: 'open' })

    await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'scope_expire_done' as DeferredScopeId,
      intentId: 'intent_expire_done' as DeferredIntentId,
      leaseToken: owner,
      leaseExpiresAt: new Date('2026-07-12T00:00:01.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { id: 'done' },
    })
    await runComposite('defer.finalize', {
      namespace: 'tenant-a',
      scopeId: 'scope_expire_done' as DeferredScopeId,
      leaseToken: owner,
      outcome: 'success',
    })
    await expect(
      runComposite('defer.expire', {
        namespace: 'tenant-a',
        scopeId: 'scope_expire_done' as DeferredScopeId,
        observedLeaseToken: owner,
        maintenanceLeaseToken: maintenance,
        reason: 'already finalized',
      }),
    ).resolves.toEqual({ applied: false, observed: 'finalized' })

    // Eligible expire applies and claims abandoned only then.
    await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'scope_expire_apply' as DeferredScopeId,
      intentId: 'intent_expire_apply' as DeferredIntentId,
      leaseToken: owner,
      leaseExpiresAt: new Date('2026-07-12T00:00:01.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { id: 'apply' },
    })
    await expect(
      runComposite('defer.expire', {
        namespace: 'tenant-a',
        scopeId: 'scope_expire_apply' as DeferredScopeId,
        observedLeaseToken: owner,
        maintenanceLeaseToken: maintenance,
        reason: 'eligible',
      }),
    ).resolves.toEqual({ applied: true, terminal: 'abandoned' })
  })

  it('fences the old owner after atomic expire-and-abandon so finalize fails with LEASE_LOST', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'))
      const store = inMemoryRuntimeStore()
      const ownerLease = await store.leases.claim('defer:scope_takeover', {
        ttlMs: 1_000,
      })
      const runComposite = createCompositeRunner(store, {
        now: () => new Date(),
      })
      const staged = await runComposite('defer.stage', {
        namespace: 'tenant-a',
        scopeId: 'scope_takeover' as DeferredScopeId,
        intentId: 'intent_takeover' as DeferredIntentId,
        leaseToken: ownerLease!.token,
        leaseExpiresAt: ownerLease!.expiresAt,
        targetId: 'send-email' as RuntimeTargetId,
        input: { messageId: 'message_takeover' },
      })

      vi.advanceTimersByTime(1_001)
      // Release the lease-store lock so maintenance can claim takeover ownership.
      await store.leases.release(ownerLease!)
      const kernel = createRuntimeKernel({
        store,
        targets: {},
        newWorkId: () => 'unused' as WorkId,
        leaseTtlMs: 1_000,
      })
      await expect(
        kernel.maintenanceTick({
          namespace: 'tenant-a',
          now: new Date(),
        }),
      ).resolves.toMatchObject({ deferredScopesAbandoned: 1 })

      const abandoned = await store.deferred.getScope(
        'scope_takeover' as DeferredScopeId,
        { namespace: 'tenant-a' },
      )
      // Maintenance token is installed only as part of terminal abandonment —
      // scope is not open under that token.
      expect(abandoned?.finalization.state).toBe('abandoned')
      expect(abandoned?.leaseToken).not.toBe(ownerLease!.token)

      await expect(
        runComposite('defer.finalize', {
          namespace: 'tenant-a',
          scopeId: 'scope_takeover' as DeferredScopeId,
          leaseToken: ownerLease!.token,
          outcome: 'success',
        }),
      ).rejects.toMatchObject({ code: 'LEASE_LOST' })
      await expect(
        store.deferred.getIntent(staged.intentId, { namespace: 'tenant-a' }),
      ).resolves.toMatchObject({ state: 'abandoned' })
      await expect(
        store.state.getWork(staged.workId, { namespace: 'tenant-a' }),
      ).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('expire composite is atomic: no open scope remains under the maintenance token after failure', async () => {
    const store = inMemoryRuntimeStore()
    const runComposite = createCompositeRunner(store, {
      now: () => new Date('2026-07-12T00:00:02.000Z'),
    })
    const observed = 'lease_owner' as LeaseToken
    const maintenance = 'lease_maintenance' as LeaseToken
    await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'scope_atomic_expire' as DeferredScopeId,
      intentId: 'intent_atomic_expire' as DeferredIntentId,
      leaseToken: observed,
      leaseExpiresAt: new Date('2026-07-12T00:00:01.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'atomic' },
    })

    // Fail after sibling abandon write, before terminal scope write would complete.
    // Memory rolls back the whole composite transaction.
    store.testing.failAfter(1)
    await expect(
      runComposite('defer.expire', {
        namespace: 'tenant-a',
        scopeId: 'scope_atomic_expire' as DeferredScopeId,
        observedLeaseToken: observed,
        maintenanceLeaseToken: maintenance,
        reason: 'crash window test',
      }),
    ).rejects.toThrow('Injected transaction failure')

    const scope = await store.deferred.getScope(
      'scope_atomic_expire' as DeferredScopeId,
      { namespace: 'tenant-a' },
    )
    expect(scope?.finalization).toEqual({ state: 'open' })
    expect(scope?.leaseToken).toBe(observed)
    expect(scope?.leaseToken).not.toBe(maintenance)
    await expect(
      store.deferred.listIntents({
        namespace: 'tenant-a',
        scopeId: 'scope_atomic_expire' as DeferredScopeId,
        state: 'staged',
      }),
    ).resolves.toHaveLength(1)
  })

  it('continues the maintenance batch when one scope is still live or mismatched', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'))
      const store = inMemoryRuntimeStore()
      const runComposite = createCompositeRunner(store, {
        now: () => new Date(),
      })

      // Scope A: expired — should abandon.
      const leaseA = await store.leases.claim('defer:scope_batch_a', {
        ttlMs: 1_000,
      })
      await runComposite('defer.stage', {
        namespace: 'tenant-a',
        scopeId: 'scope_batch_a' as DeferredScopeId,
        intentId: 'intent_batch_a' as DeferredIntentId,
        leaseToken: leaseA!.token,
        leaseExpiresAt: leaseA!.expiresAt,
        targetId: 'send-email' as RuntimeTargetId,
        input: { id: 'a' },
      })
      await store.leases.release(leaseA!)

      // Scope B: still live (far future expiry) but listed if we force list;
      // maintenance list filters by leaseExpiresBefore, so stage a second expired
      // scope that will race to not-applied via token mismatch simulation.
      const leaseB = await store.leases.claim('defer:scope_batch_b', {
        ttlMs: 1_000,
      })
      await runComposite('defer.stage', {
        namespace: 'tenant-a',
        scopeId: 'scope_batch_b' as DeferredScopeId,
        intentId: 'intent_batch_b' as DeferredIntentId,
        leaseToken: leaseB!.token,
        leaseExpiresAt: leaseB!.expiresAt,
        targetId: 'send-email' as RuntimeTargetId,
        input: { id: 'b' },
      })
      // Owner renews B so it is no longer expired by maintenance time.
      vi.advanceTimersByTime(500)
      await runComposite('defer.renew', {
        namespace: 'tenant-a',
        scopeId: 'scope_batch_b' as DeferredScopeId,
        leaseToken: leaseB!.token,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      })
      await store.leases.release(leaseB!)

      // Scope C: expired — should abandon even if a middle entry is skipped.
      const leaseC = await store.leases.claim('defer:scope_batch_c', {
        ttlMs: 1_000,
      })
      await runComposite('defer.stage', {
        namespace: 'tenant-a',
        scopeId: 'scope_batch_c' as DeferredScopeId,
        intentId: 'intent_batch_c' as DeferredIntentId,
        leaseToken: leaseC!.token,
        leaseExpiresAt: new Date('2026-07-12T00:00:00.500Z'),
        targetId: 'send-email' as RuntimeTargetId,
        input: { id: 'c' },
      })
      await store.leases.release(leaseC!)

      vi.advanceTimersByTime(600)
      const kernel = createRuntimeKernel({
        store,
        targets: {},
        newWorkId: () => 'unused' as WorkId,
        leaseTtlMs: 1_000,
      })
      // A and C expired; B live. Batch must abandon both expired scopes.
      await expect(
        kernel.maintenanceTick({
          namespace: 'tenant-a',
          now: new Date(),
        }),
      ).resolves.toMatchObject({ deferredScopesAbandoned: 2 })

      await expect(
        store.deferred.getScope('scope_batch_a' as DeferredScopeId, {
          namespace: 'tenant-a',
        }),
      ).resolves.toMatchObject({ finalization: { state: 'abandoned' } })
      await expect(
        store.deferred.getScope('scope_batch_b' as DeferredScopeId, {
          namespace: 'tenant-a',
        }),
      ).resolves.toMatchObject({ finalization: { state: 'open' } })
      await expect(
        store.deferred.getScope('scope_batch_c' as DeferredScopeId, {
          namespace: 'tenant-a',
        }),
      ).resolves.toMatchObject({ finalization: { state: 'abandoned' } })

      // Direct expire against a live scope returns not-applied open (no throw).
      await expect(
        runComposite('defer.expire', {
          namespace: 'tenant-a',
          scopeId: 'scope_batch_b' as DeferredScopeId,
          observedLeaseToken: leaseB!.token,
          maintenanceLeaseToken: 'lease_maint_b' as LeaseToken,
          reason: 'should not apply while live',
        }),
      ).resolves.toEqual({ applied: false, observed: 'open' })
    } finally {
      vi.useRealTimers()
    }
  })
})

function createCompositeRunner(
  store: RuntimeStoreAdapter,
  deps: Partial<RuntimeCompositeDeps> = {},
): RuntimeCompositeRunner {
  let nextWorkId = 0
  return (kind, input) =>
    runDefaultRuntimeComposite(
      store,
      {
        now: deps.now ?? (() => new Date('2026-07-12T00:00:00.000Z')),
        newWorkId:
          deps.newWorkId ?? (() => `work_defer_${++nextWorkId}` as WorkId),
      },
      kind,
      input,
    )
}
