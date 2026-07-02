import { v } from 'convex/values'
import { mutation } from '../_generated/server.js'
import type { MutationCtx } from '../_generated/server.js'
import { limitRows, randomId } from './shared'

export const put = mutation({
  args: { envelope: v.any(), nextAttemptAt: v.number() },
  returns: v.any(),
  handler: async (ctx, { envelope, nextAttemptAt }) => {
    const record = {
      outboxId: randomId('outbox'),
      namespace: envelope.ns,
      envelope,
      state: 'pending',
      attempts: 0,
      nextAttemptAt,
    }
    await ctx.db.insert('runtimeOutbox', record)
    return record
  },
})

export const get = mutation({
  args: { outboxId: v.string() },
  returns: v.any(),
  handler: async (ctx, { outboxId }) => byId(ctx, outboxId),
})

export const claimPending = mutation({
  args: { namespace: v.optional(v.string()), now: v.number(), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { namespace, now, limit }) => {
    const rows = namespace
      ? await ctx.db
          .query('runtimeOutbox')
          .withIndex('by_namespace_state_next', (q) => q.eq('namespace', namespace).eq('state', 'pending'))
          .collect()
      : await ctx.db.query('runtimeOutbox').collect()
    const due = limitRows(rows.filter((row) => row.state === 'pending' && row.nextAttemptAt <= now), limit)
    for (const row of due) {
      await ctx.db.patch(row._id, { state: 'dispatched', attempts: row.attempts + 1 })
    }
    return due.map((row) => ({ ...row, state: 'dispatched', attempts: row.attempts + 1 }))
  },
})

export const confirm = mutation({
  args: { outboxId: v.string() },
  returns: v.null(),
  handler: async (ctx, { outboxId }) => {
    const item = await byId(ctx, outboxId)
    if (item) await ctx.db.patch(item._id, { state: 'confirmed' })
    return null
  },
})

export const retryLater = mutation({
  args: { outboxId: v.string(), nextAttemptAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { outboxId, nextAttemptAt }) => {
    const item = await byId(ctx, outboxId)
    if (item) await ctx.db.patch(item._id, { state: 'pending', nextAttemptAt })
    return null
  },
})

async function byId(ctx: MutationCtx, outboxId: string) {
  return await ctx.db.query('runtimeOutbox').withIndex('by_outbox_id', (q) => q.eq('outboxId', outboxId)).first()
}
