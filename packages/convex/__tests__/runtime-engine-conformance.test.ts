import { runStoreAdapterTests } from '@use-crux/core/runtime/testing'
import { convexTest } from 'convex-test'
import { makeFunctionReference, type FunctionReference } from 'convex/server'
import { expect, it } from 'vitest'
import schema from '../src/component/schema'
import {
  convexRuntimeStore,
  type ConvexRuntimeComponent,
} from '../runtime'
import type { ConvexCtxPort } from '../store'

const modules = {
  '../src/component/_generated/server.ts': () => import('../src/component/_generated/server'),
  '../src/component/runtime/events.ts': () => import('../src/component/runtime/events'),
  '../src/component/runtime/leases.ts': () => import('../src/component/runtime/leases'),
  '../src/component/runtime/outbox.ts': () => import('../src/component/runtime/outbox'),
  '../src/component/runtime/state.ts': () => import('../src/component/runtime/state'),
  '../src/component/runtime/timers.ts': () => import('../src/component/runtime/timers'),
  '../src/component/runtime/waiters.ts': () => import('../src/component/runtime/waiters'),
} satisfies Record<string, () => Promise<unknown>>

runStoreAdapterTests({
  name: 'Convex component',
  substrateAtomicTransact: true,
  createStore: () => {
    const t = convexTest({ schema, modules })
    const ctx: ConvexCtxPort = {
      runQuery: async <TResult>() => undefined as TResult,
      runMutation: async <TResult>(ref: unknown, args: Record<string, unknown>) =>
        t.mutation(
          ref as FunctionReference<'mutation', 'public', Record<string, unknown>, TResult>,
          args,
        ),
    }
    return convexRuntimeStore({ ctx, component: runtimeComponent() })
  },
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
      throw new Error('rollback proof')
    }),
  ).rejects.toThrow('rollback proof')

  await expect(
    t.run(async (ctx) => {
      const workRows = await ctx.db.query('runtimeWork').collect()
      const eventRows = await ctx.db.query('runtimeEvents').collect()
      return { workRows: workRows.length, eventRows: eventRows.length }
    }),
  ).resolves.toEqual({ workRows: 0, eventRows: 0 })
})

function runtimeComponent(): ConvexRuntimeComponent {
  return {
    runtime: {
      state: {
        createWork: mutationRef('runtime/state:createWork'),
        getWork: mutationRef('runtime/state:getWork'),
        putWork: mutationRef('runtime/state:putWork'),
        listWork: mutationRef('runtime/state:listWork'),
        countWork: mutationRef('runtime/state:countWork'),
        setWorkPending: mutationRef('runtime/state:setWorkPending'),
        getSnapshot: mutationRef('runtime/state:getSnapshot'),
        putSnapshot: mutationRef('runtime/state:putSnapshot'),
        markSnapshotDelivered: mutationRef('runtime/state:markSnapshotDelivered'),
        hasIdempotencyKey: mutationRef('runtime/state:hasIdempotencyKey'),
        putIdempotencyKey: mutationRef('runtime/state:putIdempotencyKey'),
        incrementIdle: mutationRef('runtime/state:incrementIdle'),
        decrementIdle: mutationRef('runtime/state:decrementIdle'),
        getIdleCount: mutationRef('runtime/state:getIdleCount'),
      },
      events: {
        append: mutationRef('runtime/events:append'),
        read: mutationRef('runtime/events:read'),
      },
      waiters: {
        register: mutationRef('runtime/waiters:register'),
        resolve: mutationRef('runtime/waiters:resolve'),
        cancel: mutationRef('runtime/waiters:cancel'),
        attachTimer: mutationRef('runtime/waiters:attachTimer'),
        listByWork: mutationRef('runtime/waiters:listByWork'),
        claimExpired: mutationRef('runtime/waiters:claimExpired'),
        transition: mutationRef('runtime/waiters:transition'),
      },
      timers: {
        put: mutationRef('runtime/timers:put'),
        get: mutationRef('runtime/timers:get'),
        claimDue: mutationRef('runtime/timers:claimDue'),
        list: mutationRef('runtime/timers:list'),
        listByWork: mutationRef('runtime/timers:listByWork'),
        transition: mutationRef('runtime/timers:transition'),
      },
      outbox: {
        put: mutationRef('runtime/outbox:put'),
        get: mutationRef('runtime/outbox:get'),
        claimPending: mutationRef('runtime/outbox:claimPending'),
        list: mutationRef('runtime/outbox:list'),
        confirm: mutationRef('runtime/outbox:confirm'),
        retryLater: mutationRef('runtime/outbox:retryLater'),
      },
      leases: {
        claim: mutationRef('runtime/leases:claim'),
        extend: mutationRef('runtime/leases:extend'),
        release: mutationRef('runtime/leases:release'),
      },
    },
  }
}

function mutationRef(path: string): unknown {
  return makeFunctionReference<'mutation', Record<string, unknown>, unknown>(path)
}
