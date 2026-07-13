import { describe, expect, it } from 'vitest'
import { inMemoryRuntimeStore } from '../../src/runtime/adapters/memory'
import {
  runDefaultRuntimeComposite,
  type RuntimeCompositeDeps,
  type RuntimeCompositeRunner,
} from '../../src/runtime/engine/composites'
import type {
  DeferredIntentId,
  DeferredScopeId,
  LeaseToken,
  RuntimeTargetId,
  WorkId,
} from '../../src/runtime/ports'
import type { RuntimeStoreAdapter } from '../../src/runtime/store'

describe('durable deferred intents', () => {
  it('atomically finalizes a scope, releases every staged sibling, and writes their wakes', async () => {
    const store = inMemoryRuntimeStore()
    const runComposite = createCompositeRunner(store)
    const leaseToken = 'lease_defer_1' as LeaseToken

    const first = await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'defer_scope_1' as DeferredScopeId,
      intentId: 'defer_intent_1' as DeferredIntentId,
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'message_1' },
    })
    const second = await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'defer_scope_1' as DeferredScopeId,
      intentId: 'defer_intent_2' as DeferredIntentId,
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'write-audit' as RuntimeTargetId,
      input: { messageId: 'message_1' },
    })

    await expect(
      runComposite('defer.finalize', {
        namespace: 'tenant-a',
        scopeId: 'defer_scope_1' as DeferredScopeId,
        leaseToken,
        outcome: 'success',
      }),
    ).resolves.toMatchObject({ applied: true, terminal: 'finalized' })

    const scope = await store.deferred.getScope(
      'defer_scope_1' as DeferredScopeId,
      { namespace: 'tenant-a' },
    )
    const intents = await store.deferred.listIntents({
      namespace: 'tenant-a',
      scopeId: 'defer_scope_1' as DeferredScopeId,
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

  it('round-trips named defer provenance including scheduledSpanId into released work', async () => {
    const store = inMemoryRuntimeStore()
    const runComposite = createCompositeRunner(store)
    const leaseToken = 'lease_prov_1' as LeaseToken
    const provenance = {
      mode: 'named',
      sequence: 0,
      completion: 'handler-returned',
      scopeId: 'scope_prov_1',
      workId: 'pending',
      targetId: 'send-email',
      scheduledAtMs: 1_720_000_000_000,
      traceId: 'trace_abc',
      scheduledSpanId: '0123456789abcdef',
    }

    const staged = await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'scope_prov_1' as DeferredScopeId,
      intentId: 'intent_prov_1' as DeferredIntentId,
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'prov' },
      provenance,
    })

    const intent = await store.deferred.getIntent(staged.intentId, {
      namespace: 'tenant-a',
    })
    expect(intent?.provenance).toMatchObject({
      ...provenance,
      workId: staged.workId,
      scheduledSpanId: '0123456789abcdef',
    })

    await runComposite('defer.finalize', {
      namespace: 'tenant-a',
      scopeId: 'scope_prov_1' as DeferredScopeId,
      leaseToken,
      outcome: 'success',
    })

    await expect(
      store.state.getWork(staged.workId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      work: {
        kind: 'task.run',
        defer: expect.objectContaining({
          scheduledSpanId: '0123456789abcdef',
          workId: staged.workId,
          traceId: 'trace_abc',
        }),
      },
    })
    const released = await store.state.getWork(staged.workId, {
      namespace: 'tenant-a',
    })
    expect(released?.work).not.toMatchObject({
      defer: expect.objectContaining({ segmentId: expect.any(String) }),
    })
    expect(released?.work).not.toMatchObject({
      defer: expect.objectContaining({ runId: expect.any(String) }),
    })
  })

  it('atomically abandons staged siblings and prevents a later finalization from resurrecting them', async () => {
    const store = inMemoryRuntimeStore()
    const runComposite = createCompositeRunner(store)
    const leaseToken = 'lease_defer_2' as LeaseToken

    const staged = await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'defer_scope_2' as DeferredScopeId,
      intentId: 'defer_intent_3' as DeferredIntentId,
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'message_2' },
    })

    await expect(
      runComposite('defer.abandon', {
        namespace: 'tenant-a',
        scopeId: 'defer_scope_2' as DeferredScopeId,
        leaseToken,
        reason: 'staging failed',
      }),
    ).resolves.toMatchObject({ applied: true, terminal: 'abandoned' })
    await expect(
      runComposite('defer.finalize', {
        namespace: 'tenant-a',
        scopeId: 'defer_scope_2' as DeferredScopeId,
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
        scopeId: `scope_${outcome}` as DeferredScopeId,
        intentId: `intent_${outcome}` as DeferredIntentId,
        leaseToken,
        leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
        targetId: 'send-email' as RuntimeTargetId,
        input: { outcome },
      })

      await runComposite('defer.finalize', {
        namespace: 'tenant-a',
        scopeId: `scope_${outcome}` as DeferredScopeId,
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
      scopeId: 'scope_race' as DeferredScopeId,
      intentId: 'intent_race' as DeferredIntentId,
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
        scopeId: 'scope_race' as DeferredScopeId,
        leaseToken,
        outcome: 'success',
      }),
      runComposite('defer.abandon', {
        namespace: 'tenant-a',
        scopeId: 'scope_race' as DeferredScopeId,
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

  it('createIntent is insert-if-absent and preserves first workId/target/input', async () => {
    const store = inMemoryRuntimeStore()
    const now = new Date('2026-07-12T00:00:00.000Z')
    const first = await store.transact((tx) =>
      tx.deferred.createIntent({
        namespace: 'tenant-a',
        scopeId: 'scope_intent_create' as DeferredScopeId,
        intentId: 'intent_create' as DeferredIntentId,
        workId: 'work_first' as WorkId,
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
        scopeId: 'scope_intent_create' as DeferredScopeId,
        intentId: 'intent_create' as DeferredIntentId,
        workId: 'work_second' as WorkId,
        targetId: 'other-target' as RuntimeTargetId,
        input: { winner: false },
        state: 'staged',
        createdAt: now,
        updatedAt: now,
      }),
    )
    expect(second).toMatchObject({
      workId: first.workId,
      targetId: first.targetId,
      input: { winner: true },
    })
    expect(second.workId).toBe('work_first')
  })

  it('putIntent updates lifecycle only and cannot regress terminal to staged', async () => {
    const store = inMemoryRuntimeStore()
    const now = new Date('2026-07-12T00:00:00.000Z')
    const intent = await store.transact((tx) =>
      tx.deferred.createIntent({
        namespace: 'tenant-a',
        scopeId: 'scope_intent_put' as DeferredScopeId,
        intentId: 'intent_put' as DeferredIntentId,
        workId: 'work_put' as WorkId,
        targetId: 'send-email' as RuntimeTargetId,
        input: { keep: true },
        state: 'staged',
        createdAt: now,
        updatedAt: now,
      }),
    )
    await store.transact((tx) =>
      tx.deferred.putIntent({
        ...intent,
        workId: 'work_overwritten' as WorkId,
        targetId: 'other' as RuntimeTargetId,
        input: { keep: false },
        state: 'released',
        updatedAt: new Date('2026-07-12T00:00:01.000Z'),
      }),
    )
    const released = await store.deferred.getIntent(intent.intentId, {
      namespace: 'tenant-a',
    })
    expect(released).toMatchObject({
      workId: 'work_put',
      targetId: 'send-email',
      input: { keep: true },
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
      store.deferred.getIntent(intent.intentId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ state: 'released' })
  })

  it('putScope is monotonic: open may renew/close; terminal cannot reopen or flip', async () => {
    const store = inMemoryRuntimeStore()
    const now = new Date('2026-07-12T00:00:00.000Z')
    const open = await store.transact((tx) =>
      tx.deferred.createScope({
        namespace: 'tenant-a',
        scopeId: 'scope_mono' as DeferredScopeId,
        leaseToken: 'lease_mono' as LeaseToken,
        leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
        finalization: { state: 'open' },
        createdAt: now,
        updatedAt: now,
      }),
    )
    // Open renew is allowed.
    await store.transact((tx) =>
      tx.deferred.putScope({
        ...open,
        leaseExpiresAt: new Date('2026-07-12T00:02:00.000Z'),
        updatedAt: new Date('2026-07-12T00:00:01.000Z'),
      }),
    )
    await expect(
      store.deferred.getScope('scope_mono' as DeferredScopeId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({
      finalization: { state: 'open' },
      leaseExpiresAt: new Date('2026-07-12T00:02:00.000Z'),
    })

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
    // Terminal cannot reopen.
    await store.transact((tx) =>
      tx.deferred.putScope({
        ...open,
        finalization: { state: 'open' },
        leaseToken: 'lease_reopen' as LeaseToken,
        updatedAt: new Date('2026-07-12T00:00:03.000Z'),
      }),
    )
    // Terminal cannot flip to the opposite terminal.
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
      store.deferred.getScope('scope_mono' as DeferredScopeId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({
      finalization: { state: 'finalized', outcome: 'success' },
      leaseToken: 'lease_mono',
    })
  })

  it('stageDeferredIntent conflicts on released or abandoned existing intents', async () => {
    const store = inMemoryRuntimeStore()
    const runComposite = createCompositeRunner(store)
    const leaseToken = 'lease_stage_conflict' as LeaseToken
    const input = {
      namespace: 'tenant-a',
      scopeId: 'scope_stage_conflict' as DeferredScopeId,
      intentId: 'intent_stage_conflict' as DeferredIntentId,
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'conflict' },
    }
    await runComposite('defer.stage', input)
    await runComposite('defer.finalize', {
      namespace: 'tenant-a',
      scopeId: input.scopeId,
      leaseToken,
      outcome: 'success',
    })
    // Must not look like successful fresh staging after release.
    await expect(runComposite('defer.stage', input)).rejects.toThrow(
      /missing or already terminal/,
    )

    const abandonToken = 'lease_stage_abandon' as LeaseToken
    const abandonInput = {
      namespace: 'tenant-a',
      scopeId: 'scope_stage_abandon' as DeferredScopeId,
      intentId: 'intent_stage_abandon' as DeferredIntentId,
      leaseToken: abandonToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'abandon' },
    }
    await runComposite('defer.stage', abandonInput)
    await runComposite('defer.abandon', {
      namespace: 'tenant-a',
      scopeId: abandonInput.scopeId,
      leaseToken: abandonToken,
      reason: 'failed',
    })
    await expect(runComposite('defer.stage', abandonInput)).rejects.toThrow(
      /missing or already terminal/,
    )
  })

  it('concurrent stage retries preserve one stable work identity', async () => {
    const store = inMemoryRuntimeStore()
    const runComposite = createCompositeRunner(store)
    const input = {
      namespace: 'tenant-a',
      scopeId: 'scope_concurrent' as DeferredScopeId,
      intentId: 'intent_concurrent' as DeferredIntentId,
      leaseToken: 'lease_concurrent' as LeaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'concurrent' },
    }
    const [a, b] = await Promise.all([
      runComposite('defer.stage', input),
      runComposite('defer.stage', input),
    ])
    expect(a.workId).toBe(b.workId)
    await expect(
      store.deferred.getIntent(input.intentId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ workId: a.workId, state: 'staged' })
  })

  it('fences terminal commits from a stale scope lease token', async () => {
    const store = inMemoryRuntimeStore()
    const runComposite = createCompositeRunner(store)
    const leaseToken = 'lease_current' as LeaseToken
    await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'scope_fenced' as DeferredScopeId,
      intentId: 'intent_fenced' as DeferredIntentId,
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'message_fenced' },
    })

    await expect(
      runComposite('defer.finalize', {
        namespace: 'tenant-a',
        scopeId: 'scope_fenced' as DeferredScopeId,
        leaseToken: 'lease_stale' as LeaseToken,
        outcome: 'success',
      }),
    ).rejects.toMatchObject({ code: 'LEASE_LOST' })
    await expect(
      store.deferred.getScope('scope_fenced' as DeferredScopeId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({ finalization: { state: 'open' } })
  })

  it('releases every staged sibling when the adapter hard-caps pages below 256', async () => {
    const base = inMemoryRuntimeStore()
    // Hard-cap requested pages well below the kernel batch size (256).
    const store = withHardCapIntentListLimit(base, 7)
    const runComposite = createCompositeRunner(store)
    const leaseToken = 'lease_hard_cap' as LeaseToken
    const count = 40
    for (let index = 0; index < count; index += 1) {
      await runComposite('defer.stage', {
        namespace: 'tenant-a',
        scopeId: 'scope_hard_cap' as DeferredScopeId,
        intentId: `intent_hard_cap_${index}` as DeferredIntentId,
        leaseToken,
        leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
        targetId: 'send-email' as RuntimeTargetId,
        input: { index },
      })
    }

    await expect(
      runComposite('defer.finalize', {
        namespace: 'tenant-a',
        scopeId: 'scope_hard_cap' as DeferredScopeId,
        leaseToken,
        outcome: 'success',
      }),
    ).resolves.toMatchObject({ applied: true, terminal: 'finalized' })

    const intents = await base.deferred.listIntents({
      namespace: 'tenant-a',
      scopeId: 'scope_hard_cap' as DeferredScopeId,
      limit: count + 10,
    })
    expect(intents).toHaveLength(count)
    expect(intents.every((intent) => intent.state === 'released')).toBe(true)
  })

  it('fails the terminal transaction without closing the scope when staged pages make no progress', async () => {
    const base = inMemoryRuntimeStore()
    const store = withStuckStagedIntentList(base, 3)
    const runComposite = createCompositeRunner(store)
    const leaseToken = 'lease_no_progress' as LeaseToken
    for (let index = 0; index < 5; index += 1) {
      await runComposite('defer.stage', {
        namespace: 'tenant-a',
        scopeId: 'scope_no_progress' as DeferredScopeId,
        intentId: `intent_no_progress_${index}` as DeferredIntentId,
        leaseToken,
        leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
        targetId: 'send-email' as RuntimeTargetId,
        input: { index },
      })
    }

    await expect(
      runComposite('defer.finalize', {
        namespace: 'tenant-a',
        scopeId: 'scope_no_progress' as DeferredScopeId,
        leaseToken,
        outcome: 'success',
      }),
    ).rejects.toThrow(/no progress transitioning staged intents/)

    await expect(
      base.deferred.getScope('scope_no_progress' as DeferredScopeId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({ finalization: { state: 'open' } })
    const staged = await base.deferred.listIntents({
      namespace: 'tenant-a',
      scopeId: 'scope_no_progress' as DeferredScopeId,
      state: 'staged',
      limit: 20,
    })
    expect(staged).toHaveLength(5)
  })

  it('fails the terminal transaction when sibling pages rotate without emptying', async () => {
    const base = inMemoryRuntimeStore()
    // Distinct pages each time evade identical-page detection; max-page guard trips.
    const store = withRotatingStagedIntentList(base, 2)
    const runComposite = createCompositeRunner(store)
    const leaseToken = 'lease_max_pages' as LeaseToken
    await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'scope_max_pages' as DeferredScopeId,
      intentId: 'intent_max_pages_seed' as DeferredIntentId,
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { seed: true },
    })

    await expect(
      runComposite('defer.finalize', {
        namespace: 'tenant-a',
        scopeId: 'scope_max_pages' as DeferredScopeId,
        leaseToken,
        outcome: 'success',
      }),
    ).rejects.toThrow(/exceeded .* staged-intent pages/)

    await expect(
      base.deferred.getScope('scope_max_pages' as DeferredScopeId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({ finalization: { state: 'open' } })
  })

  it('keeps terminal retries idempotent and rejects a contradictory winner rewrite', async () => {
    const store = inMemoryRuntimeStore()
    const runComposite = createCompositeRunner(store)
    const leaseToken = 'lease_idempotent' as LeaseToken
    const staged = await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'scope_idempotent' as DeferredScopeId,
      intentId: 'intent_idempotent' as DeferredIntentId,
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'message_idempotent' },
    })

    await expect(
      runComposite('defer.finalize', {
        namespace: 'tenant-a',
        scopeId: 'scope_idempotent' as DeferredScopeId,
        leaseToken,
        outcome: 'success',
      }),
    ).resolves.toMatchObject({ applied: true, terminal: 'finalized' })
    await expect(
      runComposite('defer.finalize', {
        namespace: 'tenant-a',
        scopeId: 'scope_idempotent' as DeferredScopeId,
        leaseToken,
        outcome: 'success',
      }),
    ).resolves.toMatchObject({ applied: false, terminal: 'finalized' })
    await expect(
      runComposite('defer.abandon', {
        namespace: 'tenant-a',
        scopeId: 'scope_idempotent' as DeferredScopeId,
        leaseToken,
        reason: 'should not resurrect',
      }),
    ).resolves.toMatchObject({ applied: false, terminal: 'finalized' })

    await expect(
      store.deferred.getIntent(staged.intentId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ state: 'released' })
    await expect(
      store.outbox.list({ namespace: 'tenant-a', state: 'pending' }),
    ).resolves.toHaveLength(1)
  })

  it('rolls back every release write when finalization fails partway through', async () => {
    const store = inMemoryRuntimeStore()
    const runComposite = createCompositeRunner(store)
    const leaseToken = 'lease_rollback' as LeaseToken
    const staged = await runComposite('defer.stage', {
      namespace: 'tenant-a',
      scopeId: 'scope_rollback' as DeferredScopeId,
      intentId: 'intent_rollback' as DeferredIntentId,
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { messageId: 'message_rollback' },
    })
    store.testing.failAfter(1)

    await expect(
      runComposite('defer.finalize', {
        namespace: 'tenant-a',
        scopeId: 'scope_rollback' as DeferredScopeId,
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

/** Always clamp listIntents pages below the requested limit (adapter hard-cap). */
function withHardCapIntentListLimit(
  store: ReturnType<typeof inMemoryRuntimeStore>,
  hardCap: number,
): RuntimeStoreAdapter {
  const wrapDeferred = (
    deferred: typeof store.deferred,
  ): typeof store.deferred => ({
    ...deferred,
    listIntents: (options) =>
      deferred.listIntents({
        ...options,
        limit: Math.min(options.limit ?? hardCap, hardCap),
      }),
  })
  return wrapDeferredStore(store, wrapDeferred)
}

/**
 * Simulate an adapter that returns the same staged page forever even after
 * visitors write released/abandoned rows (no progress).
 */
function withStuckStagedIntentList(
  store: ReturnType<typeof inMemoryRuntimeStore>,
  hardCap: number,
): RuntimeStoreAdapter {
  const wrapDeferred = (
    deferred: typeof store.deferred,
  ): typeof store.deferred => ({
    ...deferred,
    listIntents: async (options) => {
      if (options.state !== 'staged') {
        return deferred.listIntents(options)
      }
      // Ignore state filter so released rows keep appearing as "staged".
      const page = await deferred.listIntents({
        namespace: options.namespace,
        scopeId: options.scopeId,
        limit: Math.min(options.limit ?? hardCap, hardCap),
      })
      return page.map((intent) =>
        Object.freeze({
          ...intent,
          state: 'staged' as const,
        }),
      )
    },
  })
  return wrapDeferredStore(store, wrapDeferred)
}

/**
 * Simulate an adapter that always returns a distinct nonempty staged page so
 * identical-page detection never fires; max-page guard must fail closed.
 */
function withRotatingStagedIntentList(
  store: ReturnType<typeof inMemoryRuntimeStore>,
  pageSize: number,
): RuntimeStoreAdapter {
  let page = 0
  const wrapDeferred = (
    deferred: typeof store.deferred,
  ): typeof store.deferred => ({
    ...deferred,
    listIntents: async (options) => {
      if (options.state !== 'staged') {
        return deferred.listIntents(options)
      }
      page += 1
      const now = new Date('2026-07-12T00:00:00.000Z')
      return Array.from({ length: pageSize }, (_, index) =>
        Object.freeze({
          namespace: options.namespace,
          scopeId: options.scopeId,
          intentId: `rotating_${page}_${index}` as DeferredIntentId,
          workId: `work_rotating_${page}_${index}` as WorkId,
          targetId: 'send-email' as RuntimeTargetId,
          input: { page, index },
          state: 'staged' as const,
          createdAt: now,
          updatedAt: now,
        }),
      )
    },
  })
  return wrapDeferredStore(store, wrapDeferred)
}

function wrapDeferredStore(
  store: ReturnType<typeof inMemoryRuntimeStore>,
  wrapDeferred: (deferred: typeof store.deferred) => typeof store.deferred,
): RuntimeStoreAdapter {
  return {
    ...store,
    deferred: wrapDeferred(store.deferred),
    transact: (fn) =>
      store.transact((tx) =>
        fn({
          ...tx,
          deferred: wrapDeferred(tx.deferred),
        }),
      ),
  }
}

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
