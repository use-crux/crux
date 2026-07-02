import { v } from 'convex/values'
import { mutation } from '../_generated/server.js'
import type { MutationCtx } from '../_generated/server.js'
import { limitRows } from './shared'

export const createWork = mutation({
  args: { work: v.any() },
  returns: v.any(),
  handler: async (ctx, { work }) => {
    const existing = await ctx.db
      .query('runtimeWork')
      .withIndex('by_work_id', (q) => q.eq('workId', work.workId))
      .first()
    if (existing) return existing

    await ctx.db.insert('runtimeWork', work)
    if (typeof work.idleScope === 'string') {
      await updateIdle(ctx, work.namespace, work.idleScope, 1)
    }
    return work
  },
})

export const getWork = mutation({
  args: { workId: v.string(), namespace: v.string() },
  returns: v.any(),
  handler: async (ctx, { workId, namespace }) => {
    const work = await ctx.db
      .query('runtimeWork')
      .withIndex('by_work_id', (q) => q.eq('workId', workId))
      .first()
    return work?.namespace === namespace ? work : null
  },
})

export const putWork = mutation({
  args: { work: v.any() },
  returns: v.null(),
  handler: async (ctx, { work }) => {
    const existing = await ctx.db
      .query('runtimeWork')
      .withIndex('by_work_id', (q) => q.eq('workId', work.workId))
      .first()
    if (existing) await ctx.db.replace(existing._id, work)
    else await ctx.db.insert('runtimeWork', work)
    return null
  },
})

export const listWork = mutation({
  args: {
    namespace: v.string(),
    status: v.string(),
    updatedBefore: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, { namespace, status, updatedBefore, limit }) => {
    const rows = await ctx.db
      .query('runtimeWork')
      .withIndex('by_namespace_status_updated', (q) => q.eq('namespace', namespace).eq('status', status))
      .collect()
    return limitRows(
      rows.filter((row) => updatedBefore === undefined || row.updatedAt < updatedBefore),
      limit,
    )
  },
})

export const setWorkPending = mutation({
  args: {
    workId: v.string(),
    namespace: v.string(),
    work: v.any(),
    idempotencyKey: v.string(),
    now: v.number(),
    from: v.optional(v.union(v.string(), v.array(v.string()))),
  },
  returns: v.any(),
  handler: async (ctx, { workId, namespace, work, idempotencyKey, now, from }) => {
    const existing = await ctx.db
      .query('runtimeWork')
      .withIndex('by_work_id', (q) => q.eq('workId', workId))
      .first()
    if (!existing || existing.namespace !== namespace || !allowedStatus(existing.status, from)) {
      return null
    }
    const next = {
      ...existing,
      work: work,
      status: 'pending',
      attempt: 1,
      idempotencyKey,
      updatedAt: now,
    }
    delete next.notBefore
    delete next.leaseToken
    delete next.lastError
    await ctx.db.replace(existing._id, next)
    return next
  },
})

function allowedStatus(status: string, from: string | string[] | undefined): boolean {
  if (from === undefined) return status === 'suspended'
  return Array.isArray(from) ? from.includes(status) : status === from
}

export const putSnapshot = mutation({
  args: { snapshot: v.any() },
  returns: v.null(),
  handler: async (ctx, { snapshot }) => {
    const existing = await ctx.db
      .query('runtimeSnapshots')
      .withIndex('by_flow', (q) => q.eq('namespace', snapshot.namespace).eq('flowId', snapshot.flowId))
      .first()
    if (existing) await ctx.db.replace(existing._id, snapshot)
    else await ctx.db.insert('runtimeSnapshots', snapshot)
    return null
  },
})

export const getSnapshot = mutation({
  args: { namespace: v.string(), flowId: v.string() },
  returns: v.any(),
  handler: async (ctx, { namespace, flowId }) => {
    return await ctx.db
      .query('runtimeSnapshots')
      .withIndex('by_flow', (q) => q.eq('namespace', namespace).eq('flowId', flowId))
      .first()
  },
})

export const markSnapshotDelivered = mutation({
  args: { workId: v.string(), namespace: v.string(), waiterId: v.string(), eventId: v.string() },
  returns: v.null(),
  handler: async (ctx, { workId, namespace, waiterId, eventId }) => {
    const snapshot = await ctx.db
      .query('runtimeSnapshots')
      .withIndex('by_flow', (q) => q.eq('namespace', namespace))
      .filter((q) => q.eq(q.field('workId'), workId))
      .first()
    if (!snapshot) return null
    const pendingSuspends = (snapshot.pendingSuspends as Array<Record<string, unknown>>).map((suspend) =>
      suspend.waiterId === waiterId ? { ...suspend, delivered: { eventId } } : suspend,
    )
    const deliveredSuspends = mergeDeliveredSuspend(
      snapshot.deliveredSuspends as Record<string, unknown> | undefined,
      snapshot.pendingSuspends as Array<Record<string, unknown>>,
      waiterId,
      eventId,
    )
    await ctx.db.patch(snapshot._id, { pendingSuspends, deliveredSuspends })
    return null
  },
})

function mergeDeliveredSuspend(
  current: Record<string, unknown> | undefined,
  pendingSuspends: Array<Record<string, unknown>>,
  waiterId: string,
  eventId: string,
): Record<string, unknown> | undefined {
  const suspend = pendingSuspends.find((pending) => pending.waiterId === waiterId)
  const deliveryKey = typeof suspend?.deliveryKey === 'string'
    ? suspend.deliveryKey
    : typeof suspend?.label === 'string'
      ? suspend.label
      : undefined
  if (!deliveryKey) return current
  return {
    ...(current ?? {}),
    [deliveryKey]: { eventId },
  }
}

export const hasIdempotencyKey = mutation({
  args: { namespace: v.string(), key: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { namespace, key }) => {
    const existing = await ctx.db
      .query('runtimeIdempotency')
      .withIndex('by_namespace_key', (q) => q.eq('namespace', namespace).eq('key', key))
      .first()
    return Boolean(existing)
  },
})

export const putIdempotencyKey = mutation({
  args: { record: v.any() },
  returns: v.null(),
  handler: async (ctx, { record }) => {
    const existing = await ctx.db
      .query('runtimeIdempotency')
      .withIndex('by_namespace_key', (q) => q.eq('namespace', record.namespace).eq('key', record.key))
      .first()
    if (!existing) await ctx.db.insert('runtimeIdempotency', record)
    return null
  },
})

export const getIdleCount = mutation({
  args: { namespace: v.string(), scope: v.string() },
  returns: v.number(),
  handler: async (ctx, { namespace, scope }) => {
    return await readIdle(ctx, namespace, scope)
  },
})

export const incrementIdle = mutation({
  args: { namespace: v.string(), scope: v.string() },
  returns: v.number(),
  handler: async (ctx, { namespace, scope }) => updateIdle(ctx, namespace, scope, 1),
})

export const decrementIdle = mutation({
  args: { namespace: v.string(), scope: v.string() },
  returns: v.number(),
  handler: async (ctx, { namespace, scope }) => updateIdle(ctx, namespace, scope, -1),
})

async function readIdle(ctx: MutationCtx, namespace: string, scope: string): Promise<number> {
  const existing = await ctx.db
    .query('runtimeIdleCounters')
    .withIndex('by_namespace_scope', (q) => q.eq('namespace', namespace).eq('scope', scope))
    .first()
  return existing?.count ?? 0
}

async function updateIdle(
  ctx: MutationCtx,
  namespace: string,
  scope: string,
  delta: number,
): Promise<number> {
  const existing = await ctx.db
    .query('runtimeIdleCounters')
    .withIndex('by_namespace_scope', (q) => q.eq('namespace', namespace).eq('scope', scope))
    .first()
  const count = (existing?.count ?? 0) + delta
  if (count < 0) throw new Error(`Runtime idle counter ${namespace}:${scope} went negative.`)
  if (existing) await ctx.db.patch(existing._id, { count })
  else await ctx.db.insert('runtimeIdleCounters', { namespace, scope, count })
  return count
}
