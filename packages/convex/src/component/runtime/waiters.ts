import { v } from 'convex/values'
import { mutation } from '../_generated/server.js'
import type { MutationCtx } from '../_generated/server.js'
import { limitRows, matchesTopLevel, pruneBatch, randomId } from './shared'

export const register = mutation({
  args: { waiter: v.any() },
  returns: v.any(),
  handler: async (ctx, { waiter }) => {
    const record = {
      ...waiter,
      waiterId: waiter.waiterId ?? randomId('waiter'),
      state: 'armed',
    }
    await ctx.db.insert('runtimeWaiters', record)
    return record
  },
})

export const resolve = mutation({
  args: { eventName: v.string(), payload: v.any(), namespace: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { eventName, payload, namespace }) => {
    const rows = namespace
      ? await ctx.db
          .query('runtimeWaiters')
          .withIndex('by_namespace_event_state', (q) =>
            q.eq('namespace', namespace).eq('eventName', eventName).eq('state', 'armed'),
          )
          .collect()
      : await ctx.db.query('runtimeWaiters').collect()
    return rows.filter(
      (row) =>
        row.eventName === eventName &&
        row.state === 'armed' &&
        matchesTopLevel(payload, row.match as Record<string, unknown>),
    )
  },
})

export const cancel = mutation({
  args: { waiterId: v.string() },
  returns: v.null(),
  handler: async (ctx, { waiterId }) => {
    const waiter = await byId(ctx, waiterId)
    if (waiter?.state === 'armed') await ctx.db.patch(waiter._id, { state: 'cancelled', settledAt: Date.now() })
    return null
  },
})

export const attachTimer = mutation({
  args: { waiterId: v.string(), timerId: v.string() },
  returns: v.null(),
  handler: async (ctx, { waiterId, timerId }) => {
    const waiter = await byId(ctx, waiterId)
    if (waiter) await ctx.db.patch(waiter._id, { timerId })
    return null
  },
})

export const listByWork = mutation({
  args: { workId: v.string() },
  returns: v.any(),
  handler: async (ctx, { workId }) => {
    return await ctx.db.query('runtimeWaiters').withIndex('by_work', (q) => q.eq('workId', workId)).collect()
  },
})

export const claimExpired = mutation({
  args: { namespace: v.optional(v.string()), now: v.number(), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { namespace, now, limit }) => {
    const rows = namespace
      ? await ctx.db
          .query('runtimeWaiters')
          .withIndex('by_namespace_state_timeout', (q) => q.eq('namespace', namespace).eq('state', 'armed'))
          .collect()
      : await ctx.db.query('runtimeWaiters').collect()
    return limitRows(
      rows.filter((row) => row.state === 'armed' && typeof row.timeoutAt === 'number' && row.timeoutAt <= now),
      limit,
    )
  },
})

export const transition = mutation({
  args: { waiterId: v.string(), from: v.string(), to: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { waiterId, from, to }) => {
    const waiter = await byId(ctx, waiterId)
    if (!waiter || waiter.state !== from) return false
    await ctx.db.patch(waiter._id, {
      state: to,
      ...(to !== 'armed' ? { settledAt: Date.now() } : {}),
    })
    return true
  },
})

export const prune = mutation({
  args: {
    namespace: v.optional(v.string()),
    before: v.number(),
    limit: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, { namespace, before, limit }) => {
    const rows = await rowsByStates(ctx, namespace, ['fired', 'timed-out', 'cancelled'], limit)
    const batch = pruneBatch(
      rows.filter((row) => row.settledAt === undefined || row.settledAt < before),
      limit,
    )
    for (const row of batch.selected) await ctx.db.delete(row._id)
    return { removed: batch.selected.length, truncated: batch.truncated }
  },
})

async function byId(ctx: MutationCtx, waiterId: string) {
  return await ctx.db
    .query('runtimeWaiters')
    .withIndex('by_waiter_id', (q) => q.eq('waiterId', waiterId))
    .first()
}

async function rowsByStates(ctx: MutationCtx, namespace: string | undefined, states: readonly string[], limit: number) {
  const take = Math.max(0, Math.floor(limit)) + 1
  const rows = (
    await Promise.all(
      states.map((state) =>
        namespace
          ? ctx.db
              .query('runtimeWaiters')
              .withIndex('by_namespace_state_settled', (q) => q.eq('namespace', namespace).eq('state', state))
              .take(take)
          : ctx.db
              .query('runtimeWaiters')
              .withIndex('by_state_settled', (q) => q.eq('state', state))
              .take(take),
      ),
    )
  ).flat()
  return rows.sort((left, right) => (left.settledAt ?? 0) - (right.settledAt ?? 0))
}
