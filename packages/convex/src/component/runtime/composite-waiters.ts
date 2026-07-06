import type {
  NewRuntimeWaiter,
  RuntimeWaiter,
  RuntimeWaiterStorePort,
} from '@use-crux/core/runtime'
import type { WithoutSystemFields } from 'convex/server'
import type { Doc } from '../_generated/dataModel.js'
import type { MutationCtx } from '../_generated/server.js'
import { decodeWaiter, encodeWaiter } from '../../../runtime-engine/codec'
import { matchesTopLevel, randomId } from './shared'
import { unsupported } from './composite-utils'

type RuntimeWaiterRow = WithoutSystemFields<Doc<'runtimeWaiters'>>

export function createCompositeWaiterPort(ctx: MutationCtx): RuntimeWaiterStorePort {
  return {
    register: (waiter) => registerWaiterRecord(ctx, waiter),
    resolve: (eventName, payload, read = {}) =>
      resolveWaiterRecords(ctx, eventName, payload, read.namespace),
    cancel: async (waiterId) => {
      const waiter = await waiterById(ctx, waiterId)
      if (waiter?.state === 'armed') {
        await ctx.db.patch(waiter._id, {
          state: 'cancelled',
          settledAt: Date.now(),
        })
      }
    },
    attachTimer: async (waiterId, timerId) => {
      const waiter = await waiterById(ctx, waiterId)
      if (waiter) await ctx.db.patch(waiter._id, { timerId })
    },
    listByWork: async (workId) =>
      (
        await ctx.db
          .query('runtimeWaiters')
          .withIndex('by_work', (q) => q.eq('workId', workId))
          .collect()
      ).map(decodeWaiter),
    claimExpired: unsupported('waiters.claimExpired'),
    transition: (waiterId, from, to) =>
      transitionWaiterRecord(ctx, waiterId, from, to),
    prune: unsupported('waiters.prune'),
  }
}

async function registerWaiterRecord(
  ctx: MutationCtx,
  waiter: NewRuntimeWaiter,
): Promise<RuntimeWaiter> {
  const record = {
    ...encodeWaiter(waiter),
    waiterId: randomId('waiter'),
    state: 'armed',
  } as RuntimeWaiterRow
  await ctx.db.insert('runtimeWaiters', record)
  return decodeWaiter(record as unknown)
}

async function resolveWaiterRecords(
  ctx: MutationCtx,
  eventName: string,
  payload: unknown,
  namespace: string | undefined,
): Promise<readonly RuntimeWaiter[]> {
  const rows = namespace
    ? await ctx.db
        .query('runtimeWaiters')
        .withIndex('by_namespace_event_state', (q) =>
          q.eq('namespace', namespace).eq('eventName', eventName).eq('state', 'armed'),
        )
        .collect()
    : await ctx.db.query('runtimeWaiters').collect()
  return rows
    .filter(
      (row) =>
        row.eventName === eventName &&
        row.state === 'armed' &&
        matchesTopLevel(payload, row.match as Record<string, unknown>),
    )
    .map(decodeWaiter)
}

async function transitionWaiterRecord(
  ctx: MutationCtx,
  waiterId: string,
  from: RuntimeWaiter['state'],
  to: RuntimeWaiter['state'],
): Promise<boolean> {
  const waiter = await waiterById(ctx, waiterId)
  if (!waiter || waiter.state !== from) return false
  await ctx.db.patch(waiter._id, {
    state: to,
    ...(to !== 'armed' ? { settledAt: Date.now() } : {}),
  })
  return true
}

async function waiterById(ctx: MutationCtx, waiterId: string) {
  return await ctx.db
    .query('runtimeWaiters')
    .withIndex('by_waiter_id', (q) => q.eq('waiterId', waiterId))
    .first()
}
