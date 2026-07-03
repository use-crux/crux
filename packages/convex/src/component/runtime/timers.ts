import { v } from 'convex/values'
import { mutation } from '../_generated/server.js'
import type { MutationCtx } from '../_generated/server.js'
import { limitRows, randomId } from './shared'

const TIMER_STATES = ['scheduled', 'fired', 'cancelled'] as const

export const put = mutation({
  args: { timer: v.any() },
  returns: v.any(),
  handler: async (ctx, { timer }) => {
    const record = {
      ...timer,
      timerId: timer.timerId ?? randomId('timer'),
      state: 'scheduled',
    }
    await ctx.db.insert('runtimeTimers', record)
    return record
  },
})

export const get = mutation({
  args: { timerId: v.string() },
  returns: v.any(),
  handler: async (ctx, { timerId }) => byId(ctx, timerId),
})

export const claimDue = mutation({
  args: { namespace: v.optional(v.string()), now: v.number(), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { namespace, now, limit }) => {
    const rows = namespace
      ? await ctx.db
          .query('runtimeTimers')
          .withIndex('by_namespace_state_fire', (q) => q.eq('namespace', namespace).eq('state', 'scheduled'))
          .collect()
      : await ctx.db.query('runtimeTimers').collect()
    return limitRows(rows.filter((row) => row.state === 'scheduled' && row.fireAt <= now), limit)
  },
})

export const list = mutation({
  args: { namespace: v.string(), state: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { namespace, state, limit }) => {
    const states = state === undefined ? TIMER_STATES : [state]
    const rows = (
      await Promise.all(
        states.map((rowState) =>
          ctx.db
            .query('runtimeTimers')
            .withIndex('by_namespace_state_fire', (q) =>
              q.eq('namespace', namespace).eq('state', rowState),
            )
            .take(limit ?? 1_000),
        ),
      )
    ).flat()
    return limitRows(rows, limit)
  },
})

export const listByWork = mutation({
  args: { workId: v.string() },
  returns: v.any(),
  handler: async (ctx, { workId }) => {
    return await ctx.db.query('runtimeTimers').withIndex('by_work', (q) => q.eq('workId', workId)).collect()
  },
})

export const transition = mutation({
  args: { timerId: v.string(), from: v.string(), to: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { timerId, from, to }) => {
    const timer = await byId(ctx, timerId)
    if (!timer || timer.state !== from) return false
    await ctx.db.patch(timer._id, { state: to })
    return true
  },
})

async function byId(ctx: MutationCtx, timerId: string) {
  return await ctx.db.query('runtimeTimers').withIndex('by_timer_id', (q) => q.eq('timerId', timerId)).first()
}
