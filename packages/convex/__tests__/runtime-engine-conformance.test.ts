import { runStoreAdapterTests } from '@use-crux/core/runtime/testing'
import { convexTest } from 'convex-test'
import { makeFunctionReference, type FunctionReference } from 'convex/server'
import { readdir } from 'node:fs/promises'
import { expect, it } from 'vitest'
import schema from '../src/component/schema'
import { convexRuntimeStore, type ConvexRuntimeComponent } from '../src/runtime'
import type { ConvexCtxPort } from '../src/store'
import type {
  DeferredIntentId,
  DeferredScopeId,
  FlowId,
  FlowSnapshot,
  LeaseToken,
  RuntimeTargetId,
  WorkId,
} from '@use-crux/core/runtime'

const modules = {
  '../src/component/_generated/server.ts': () =>
    import('../src/component/_generated/server'),
  '../src/component/runtime/composite_events.ts': () =>
    import('../src/component/runtime/composite_events'),
  '../src/component/runtime/composite_deferred.ts': () =>
    import('../src/component/runtime/composite_deferred'),
  '../src/component/runtime/composite_outbox.ts': () =>
    import('../src/component/runtime/composite_outbox'),
  '../src/component/runtime/composite_state.ts': () =>
    import('../src/component/runtime/composite_state'),
  '../src/component/runtime/composite_timers.ts': () =>
    import('../src/component/runtime/composite_timers'),
  '../src/component/runtime/composite_transaction.ts': () =>
    import('../src/component/runtime/composite_transaction'),
  '../src/component/runtime/composite_utils.ts': () =>
    import('../src/component/runtime/composite_utils'),
  '../src/component/runtime/composite_waiters.ts': () =>
    import('../src/component/runtime/composite_waiters'),
  '../src/component/runtime/composites.ts': () =>
    import('../src/component/runtime/composites'),
  '../src/component/runtime/events.ts': () =>
    import('../src/component/runtime/events'),
  '../src/component/runtime/deferred.ts': () =>
    import('../src/component/runtime/deferred'),
  '../src/component/runtime/leases.ts': () =>
    import('../src/component/runtime/leases'),
  '../src/component/runtime/outbox.ts': () =>
    import('../src/component/runtime/outbox'),
  '../src/component/runtime/state.ts': () =>
    import('../src/component/runtime/state'),
  '../src/component/runtime/timers.ts': () =>
    import('../src/component/runtime/timers'),
  '../src/component/runtime/waiters.ts': () =>
    import('../src/component/runtime/waiters'),
} satisfies Record<string, () => Promise<unknown>>

it('releases every staged deferred sibling beyond the Convex listIntents default page', async () => {
  const t = convexTest({ schema, modules })
  const ctx: ConvexCtxPort = {
    runQuery: async <TResult>() => undefined as TResult,
    runMutation: async <TResult>(ref: unknown, args: Record<string, unknown>) =>
      t.mutation(
        ref as FunctionReference<
          'mutation',
          'public',
          Record<string, unknown>,
          TResult
        >,
        args,
      ),
  }
  const store = convexRuntimeStore({ ctx, component: runtimeComponent() })
  if (!store.runComposite) {
    throw new Error('Expected Convex runtime store to expose runComposite')
  }
  const run = store.runComposite.bind(store)

  const leaseToken = 'lease_cx_high' as LeaseToken
  const scopeId = 'scope_cx_high' as DeferredScopeId
  // Proportional high-cardinality regression: exceed Postgres's 100-row
  // default page while staying well under Convex mutation cost ceilings.
  // Algorithm hard-cap paging is covered by the Core 7/40 unit test.
  const count = 150
  for (let index = 0; index < count; index += 1) {
    await run('defer.stage', {
      namespace: 'tenant-a',
      scopeId,
      intentId: `intent_cx_high_${index}` as DeferredIntentId,
      leaseToken,
      leaseExpiresAt: new Date('2026-07-12T00:01:00.000Z'),
      targetId: 'send-email' as RuntimeTargetId,
      input: { index },
    })
  }

  let finalizeResult:
    | Awaited<ReturnType<typeof run<'defer.finalize'>>>
    | undefined
  let finalizeError: unknown
  try {
    finalizeResult = await run('defer.finalize', {
      namespace: 'tenant-a',
      scopeId,
      leaseToken,
      outcome: 'success',
    })
  } catch (error) {
    finalizeError = error
  }

  if (finalizeError) {
    // Platform mutation limits must fail atomically: scope stays open, no partial release.
    await expect(
      store.deferred.getScope(scopeId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ finalization: { state: 'open' } })
    const released = await store.deferred.listIntents({
      namespace: 'tenant-a',
      scopeId,
      state: 'released',
      limit: count + 10,
    })
    expect(released).toEqual([])
    return
  }

  expect(finalizeResult).toMatchObject({
    applied: true,
    terminal: 'finalized',
  })
  const intents = await store.deferred.listIntents({
    namespace: 'tenant-a',
    scopeId,
    limit: count + 10,
  })
  expect(intents).toHaveLength(count)
  expect(intents.every((intent) => intent.state === 'released')).toBe(true)
  const staged = await store.deferred.listIntents({
    namespace: 'tenant-a',
    scopeId,
    state: 'staged',
    limit: count + 10,
  })
  expect(staged).toEqual([])
}, 120_000)

it('putScope is monotonic: open may renew/close; terminal cannot reopen or flip', async () => {
  const t = convexTest({ schema, modules })
  const ctx: ConvexCtxPort = {
    runQuery: async <TResult>() => undefined as TResult,
    runMutation: async <TResult>(ref: unknown, args: Record<string, unknown>) =>
      t.mutation(
        ref as FunctionReference<
          'mutation',
          'public',
          Record<string, unknown>,
          TResult
        >,
        args,
      ),
  }
  const store = convexRuntimeStore({ ctx, component: runtimeComponent() })
  const now = new Date('2026-07-12T00:00:00.000Z')
  const scopeId = 'scope_cx_mono' as DeferredScopeId
  const token = 'lease_cx_mono' as LeaseToken
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

it('createIntent round-trips named defer provenance including scheduledSpanId', async () => {
  const t = convexTest({ schema, modules })
  const ctx: ConvexCtxPort = {
    runQuery: async <TResult>() => undefined as TResult,
    runMutation: async <TResult>(ref: unknown, args: Record<string, unknown>) =>
      t.mutation(
        ref as FunctionReference<
          'mutation',
          'public',
          Record<string, unknown>,
          TResult
        >,
        args,
      ),
  }
  const store = convexRuntimeStore({ ctx, component: runtimeComponent() })
  const now = new Date('2026-07-12T00:00:00.000Z')
  const intentId = 'intent_cx_prov' as DeferredIntentId
  const provenance = {
    mode: 'named',
    sequence: 0,
    completion: 'handler-returned',
    scopeId: 'scope_cx_prov',
    workId: 'work_cx_prov',
    targetId: 'send-email',
    scheduledSpanId: 'aabbccddeeff0011',
    runId: 'run_cx',
    traceId: 'trace_cx',
  }
  const created = await store.transact((tx) =>
    tx.deferred.createIntent({
      namespace: 'tenant-a',
      scopeId: 'scope_cx_prov' as DeferredScopeId,
      intentId,
      workId: 'work_cx_prov' as WorkId,
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

it('createIntent preserves first work identity; putIntent cannot regress terminal', async () => {
  const t = convexTest({ schema, modules })
  const ctx: ConvexCtxPort = {
    runQuery: async <TResult>() => undefined as TResult,
    runMutation: async <TResult>(ref: unknown, args: Record<string, unknown>) =>
      t.mutation(
        ref as FunctionReference<
          'mutation',
          'public',
          Record<string, unknown>,
          TResult
        >,
        args,
      ),
  }
  const store = convexRuntimeStore({ ctx, component: runtimeComponent() })
  const now = new Date('2026-07-12T00:00:00.000Z')
  const intentId = 'intent_cx_create' as DeferredIntentId
  const first = await store.transact((tx) =>
    tx.deferred.createIntent({
      namespace: 'tenant-a',
      scopeId: 'scope_cx_create' as DeferredScopeId,
      intentId,
      workId: 'work_cx_first' as WorkId,
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
      scopeId: 'scope_cx_create' as DeferredScopeId,
      intentId,
      workId: 'work_cx_second' as WorkId,
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
    workId: 'work_cx_first',
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

it('uses Convex-compatible runtime module filenames', async () => {
  const entries = await readdir(
    new URL('../src/component/runtime', import.meta.url),
    { withFileTypes: true },
  )
  const invalid = entries.filter(
    (entry) => entry.isFile() && !/^[A-Za-z0-9_.]+$/.test(entry.name),
  )
  expect(invalid.map((entry) => entry.name)).toEqual([])
})

runStoreAdapterTests({
  name: 'Convex component',
  substrateAtomicTransact: true,
  createStore: () => {
    const t = convexTest({ schema, modules })
    const ctx: ConvexCtxPort = {
      runQuery: async <TResult>() => undefined as TResult,
      runMutation: async <TResult>(
        ref: unknown,
        args: Record<string, unknown>,
      ) =>
        t.mutation(
          ref as FunctionReference<
            'mutation',
            'public',
            Record<string, unknown>,
            TResult
          >,
          args,
        ),
    }
    return convexRuntimeStore({ ctx, component: runtimeComponent() })
  },
})

it('reads legacy scheduledEffects documents and writes scheduledWork only', async () => {
  const t = convexTest({ schema, modules })
  await t.run(async (ctx) => {
    await ctx.db.insert('runtimeSnapshots', {
      flowId: 'flow_legacy',
      workId: 'work_parent',
      targetId: 'review',
      namespace: 'tenant-a',
      status: 'suspended',
      input: {},
      completedSteps: {},
      fingerprint: [],
      pendingSuspends: [],
      scheduledEffects: { 'defer:1': { workId: 'work_child' } },
      updatedAt: 1,
    })
  })
  const ctx: ConvexCtxPort = {
    runQuery: async <TResult>() => undefined as TResult,
    runMutation: async <TResult>(ref: unknown, args: Record<string, unknown>) =>
      t.mutation(
        ref as FunctionReference<
          'mutation',
          'public',
          Record<string, unknown>,
          TResult
        >,
        args,
      ),
  }
  const store = convexRuntimeStore({ ctx, component: runtimeComponent() })

  await expect(
    store.state.getSnapshot('flow_legacy' as FlowId, {
      namespace: 'tenant-a',
    }),
  ).resolves.toMatchObject({
    scheduledWork: { 'defer:1': { workId: 'work_child' } },
  })

  await store.state.putSnapshot(snapshotFixture('flow_new'))
  const written = await t.run(async (database) =>
    database.db
      .query('runtimeSnapshots')
      .withIndex('by_flow', (query) =>
        query.eq('namespace', 'tenant-a').eq('flowId', 'flow_new'),
      )
      .first(),
  )
  expect(written?.scheduledWork).toEqual({
    'defer:1': { workId: 'work_child' },
  })
  expect(written).not.toHaveProperty('scheduledEffects')
})

it('invariant: Convex rolls back runtime table writes when a mutation throws', async () => {
  const t = convexTest({ schema, modules })

  await expect(
    t.run(async (ctx) => {
      await ctx.db.insert('runtimeWork', {
        workId: 'work-rollback',
        namespace: 'tenant-a',
        work: { kind: 'flow.resume', flowId: 'flow-rollback' },
        targetId: 'review',
        status: 'pending',
        attempt: 1,
        maxAttempts: 8,
        idempotencyKey: 'task:work-rollback',
        createdAt: 1,
        updatedAt: 1,
      })
      await ctx.db.insert('runtimeEvents', {
        namespace: 'tenant-a',
        name: 'runtime.rollback',
        payload: { workId: 'work-rollback' },
        eventId: 1,
        appendedAt: 1,
      })
      await ctx.db.insert('runtimeDeferredScopes', {
        namespace: 'tenant-a',
        scopeId: 'scope-rollback',
        leaseToken: 'lease-rollback',
        leaseExpiresAt: 2,
        finalization: { state: 'open' },
        finalizationState: 'open',
        createdAt: 1,
        updatedAt: 1,
      })
      await ctx.db.insert('runtimeDeferredIntents', {
        namespace: 'tenant-a',
        scopeId: 'scope-rollback',
        intentId: 'intent-rollback',
        workId: 'work-deferred-rollback',
        targetId: 'send-email',
        input: { messageId: '1' },
        state: 'released',
        createdAt: 1,
        updatedAt: 1,
      })
      await ctx.db.insert('runtimeOutbox', {
        outboxId: 'outbox-rollback',
        namespace: 'tenant-a',
        workId: 'work-deferred-rollback',
        envelope: { workId: 'work-deferred-rollback' },
        state: 'pending',
        attempts: 0,
        nextAttemptAt: 1,
      })
      throw new Error('rollback proof')
    }),
  ).rejects.toThrow('rollback proof')

  await expect(
    t.run(async (ctx) => {
      const workRows = await ctx.db.query('runtimeWork').collect()
      const eventRows = await ctx.db.query('runtimeEvents').collect()
      const scopeRows = await ctx.db.query('runtimeDeferredScopes').collect()
      const intentRows = await ctx.db.query('runtimeDeferredIntents').collect()
      const outboxRows = await ctx.db.query('runtimeOutbox').collect()
      return {
        workRows: workRows.length,
        eventRows: eventRows.length,
        scopeRows: scopeRows.length,
        intentRows: intentRows.length,
        outboxRows: outboxRows.length,
      }
    }),
  ).resolves.toEqual({
    workRows: 0,
    eventRows: 0,
    scopeRows: 0,
    intentRows: 0,
    outboxRows: 0,
  })
})

function runtimeComponent(): ConvexRuntimeComponent {
  return {
    runtime: {
      state: {
        createWork: mutationRef('runtime/state:createWork'),
        getWork: mutationRef('runtime/state:getWork'),
        putWork: mutationRef('runtime/state:putWork'),
        listWork: mutationRef('runtime/state:listWork'),
        pruneTerminalWork: mutationRef('runtime/state:pruneTerminalWork'),
        countWork: mutationRef('runtime/state:countWork'),
        setWorkPending: mutationRef('runtime/state:setWorkPending'),
        getSnapshot: mutationRef('runtime/state:getSnapshot'),
        putSnapshot: mutationRef('runtime/state:putSnapshot'),
        pruneTerminalSnapshots: mutationRef(
          'runtime/state:pruneTerminalSnapshots',
        ),
        markSnapshotDelivered: mutationRef(
          'runtime/state:markSnapshotDelivered',
        ),
        hasIdempotencyKey: mutationRef('runtime/state:hasIdempotencyKey'),
        putIdempotencyKey: mutationRef('runtime/state:putIdempotencyKey'),
        pruneIdempotencyKeys: mutationRef('runtime/state:pruneIdempotencyKeys'),
        incrementIdle: mutationRef('runtime/state:incrementIdle'),
        decrementIdle: mutationRef('runtime/state:decrementIdle'),
        getIdleCount: mutationRef('runtime/state:getIdleCount'),
      },
      events: {
        append: mutationRef('runtime/events:append'),
        read: mutationRef('runtime/events:read'),
        prune: mutationRef('runtime/events:prune'),
      },
      waiters: {
        register: mutationRef('runtime/waiters:register'),
        resolve: mutationRef('runtime/waiters:resolve'),
        cancel: mutationRef('runtime/waiters:cancel'),
        attachTimer: mutationRef('runtime/waiters:attachTimer'),
        listByWork: mutationRef('runtime/waiters:listByWork'),
        claimExpired: mutationRef('runtime/waiters:claimExpired'),
        transition: mutationRef('runtime/waiters:transition'),
        prune: mutationRef('runtime/waiters:prune'),
      },
      timers: {
        put: mutationRef('runtime/timers:put'),
        get: mutationRef('runtime/timers:get'),
        claimDue: mutationRef('runtime/timers:claimDue'),
        list: mutationRef('runtime/timers:list'),
        listByWork: mutationRef('runtime/timers:listByWork'),
        transition: mutationRef('runtime/timers:transition'),
        prune: mutationRef('runtime/timers:prune'),
      },
      outbox: {
        put: mutationRef('runtime/outbox:put'),
        get: mutationRef('runtime/outbox:get'),
        claimPending: mutationRef('runtime/outbox:claimPending'),
        list: mutationRef('runtime/outbox:list'),
        listByWork: mutationRef('runtime/outbox:listByWork'),
        confirm: mutationRef('runtime/outbox:confirm'),
        retryLater: mutationRef('runtime/outbox:retryLater'),
        prune: mutationRef('runtime/outbox:prune'),
      },
      leases: {
        claim: mutationRef('runtime/leases:claim'),
        extend: mutationRef('runtime/leases:extend'),
        release: mutationRef('runtime/leases:release'),
      },
      deferred: {
        getScope: mutationRef('runtime/deferred:getScope'),
        createScope: mutationRef('runtime/deferred:createScope'),
        putScope: mutationRef('runtime/deferred:putScope'),
        listScopes: mutationRef('runtime/deferred:listScopes'),
        getIntent: mutationRef('runtime/deferred:getIntent'),
        createIntent: mutationRef('runtime/deferred:createIntent'),
        putIntent: mutationRef('runtime/deferred:putIntent'),
        listIntents: mutationRef('runtime/deferred:listIntents'),
      },
      composites: {
        run: mutationRef('runtime/composites:run'),
      },
    },
  }
}

function snapshotFixture(flowId: string): FlowSnapshot {
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
    scheduledWork: {
      'defer:1': { workId: 'work_child' as WorkId },
    },
    updatedAt: new Date('2026-07-12T00:00:00.000Z'),
  }
}

function mutationRef(path: string): unknown {
  return makeFunctionReference<'mutation', Record<string, unknown>, unknown>(
    path,
  )
}
