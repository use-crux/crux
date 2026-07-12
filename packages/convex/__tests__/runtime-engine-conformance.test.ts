import { runStoreAdapterTests } from '@use-crux/core/runtime/testing'
import { convexTest } from 'convex-test'
import { makeFunctionReference, type FunctionReference } from 'convex/server'
import { readdir } from 'node:fs/promises'
import { expect, it } from 'vitest'
import schema from '../src/component/schema'
import { convexRuntimeStore, type ConvexRuntimeComponent } from '../src/runtime'
import type { ConvexCtxPort } from '../src/store'
import type {
  FlowId,
  FlowSnapshot,
  RuntimeTargetId,
  WorkId,
} from '@use-crux/core/runtime'

const modules = {
  '../src/component/_generated/server.ts': () => import('../src/component/_generated/server'),
  '../src/component/runtime/composite_events.ts': () => import('../src/component/runtime/composite_events'),
  '../src/component/runtime/composite_deferred.ts': () => import('../src/component/runtime/composite_deferred'),
  '../src/component/runtime/composite_outbox.ts': () => import('../src/component/runtime/composite_outbox'),
  '../src/component/runtime/composite_state.ts': () => import('../src/component/runtime/composite_state'),
  '../src/component/runtime/composite_timers.ts': () => import('../src/component/runtime/composite_timers'),
  '../src/component/runtime/composite_transaction.ts': () => import('../src/component/runtime/composite_transaction'),
  '../src/component/runtime/composite_utils.ts': () => import('../src/component/runtime/composite_utils'),
  '../src/component/runtime/composite_waiters.ts': () => import('../src/component/runtime/composite_waiters'),
  '../src/component/runtime/composites.ts': () => import('../src/component/runtime/composites'),
  '../src/component/runtime/events.ts': () => import('../src/component/runtime/events'),
  '../src/component/runtime/deferred.ts': () => import('../src/component/runtime/deferred'),
  '../src/component/runtime/leases.ts': () => import('../src/component/runtime/leases'),
  '../src/component/runtime/outbox.ts': () => import('../src/component/runtime/outbox'),
  '../src/component/runtime/state.ts': () => import('../src/component/runtime/state'),
  '../src/component/runtime/timers.ts': () => import('../src/component/runtime/timers'),
  '../src/component/runtime/waiters.ts': () => import('../src/component/runtime/waiters'),
} satisfies Record<string, () => Promise<unknown>>

it('uses Convex-compatible runtime module filenames', async () => {
  const entries = await readdir(new URL('../src/component/runtime', import.meta.url), { withFileTypes: true })
  const invalid = entries.filter((entry) => entry.isFile() && !/^[A-Za-z0-9_.]+$/.test(entry.name))
  expect(invalid.map((entry) => entry.name)).toEqual([])
})

runStoreAdapterTests({
  name: 'Convex component',
  substrateAtomicTransact: true,
  createStore: () => {
    const t = convexTest({ schema, modules })
    const ctx: ConvexCtxPort = {
      runQuery: async <TResult>() => undefined as TResult,
      runMutation: async <TResult>(ref: unknown, args: Record<string, unknown>) =>
        t.mutation(ref as FunctionReference<'mutation', 'public', Record<string, unknown>, TResult>, args),
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
        pruneTerminalSnapshots: mutationRef('runtime/state:pruneTerminalSnapshots'),
        markSnapshotDelivered: mutationRef('runtime/state:markSnapshotDelivered'),
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
        putScope: mutationRef('runtime/deferred:putScope'),
        listScopes: mutationRef('runtime/deferred:listScopes'),
        getIntent: mutationRef('runtime/deferred:getIntent'),
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
  return makeFunctionReference<'mutation', Record<string, unknown>, unknown>(path)
}
