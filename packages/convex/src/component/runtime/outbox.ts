import { v } from 'convex/values'
import { mutation } from '../_generated/server.js'
import type { MutationCtx } from '../_generated/server.js'
import { limitRows, pruneBatch, randomId } from './shared'

const OUTBOX_STATES = ['pending', 'dispatched', 'confirmed'] as const

export const put = mutation({
  args: { envelope: v.any(), nextAttemptAt: v.number() },
  returns: v.any(),
  handler: async (ctx, { envelope, nextAttemptAt }) => {
    const existing = await ctx.db
      .query('runtimeOutbox')
      .withIndex('by_namespace_state_next', (q) =>
        q.eq('namespace', envelope.ns).eq('state', 'pending').eq('nextAttemptAt', nextAttemptAt),
      )
      .filter((q) => q.eq(q.field('envelope.idempotencyKey'), envelope.idempotencyKey))
      .first()
    if (existing) return existing

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

export const list = mutation({
  args: { namespace: v.string(), state: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { namespace, state, limit }) => {
    const states = state === undefined ? OUTBOX_STATES : [state]
    const rows = (
      await Promise.all(
        states.map((rowState) =>
          ctx.db
            .query('runtimeOutbox')
            .withIndex('by_namespace_state_next', (q) =>
              q.eq('namespace', namespace).eq('state', rowState),
            )
            .take(limit ?? 1_000),
        ),
      )
    ).flat()
    return limitRows(rows, limit)
  },
})

export const confirm = mutation({
  args: { outboxId: v.string() },
  returns: v.null(),
  handler: async (ctx, { outboxId }) => {
    const item = await byId(ctx, outboxId)
    if (item) await ctx.db.patch(item._id, { state: 'confirmed', confirmedAt: Date.now() })
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

export const prune = mutation({
  args: {
    namespace: v.optional(v.string()),
    before: v.number(),
    limit: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, { namespace, before, limit }) => {
    const rows = namespace
      ? await ctx.db
          .query('runtimeOutbox')
          .withIndex('by_namespace_state_confirmed', (q) => q.eq('namespace', namespace).eq('state', 'confirmed'))
          .take(Math.max(0, Math.floor(limit)) + 1)
      : await ctx.db
          .query('runtimeOutbox')
          .withIndex('by_state_confirmed', (q) => q.eq('state', 'confirmed'))
          .take(Math.max(0, Math.floor(limit)) + 1)
    const batch = pruneBatch(
      rows
        .filter((row) => row.state === 'confirmed' && (row.confirmedAt === undefined || row.confirmedAt < before))
        .sort((left, right) => (left.confirmedAt ?? 0) - (right.confirmedAt ?? 0)),
      limit,
    )
    for (const row of batch.selected) await ctx.db.delete(row._id)
    return { removed: batch.selected.length, truncated: batch.truncated }
  },
})

async function byId(ctx: MutationCtx, outboxId: string) {
  return await ctx.db.query('runtimeOutbox').withIndex('by_outbox_id', (q) => q.eq('outboxId', outboxId)).first()
}
