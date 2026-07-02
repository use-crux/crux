import { v } from 'convex/values'
import { mutation } from '../_generated/server.js'
import type { MutationCtx } from '../_generated/server.js'
import { randomId } from './shared'

export const claim = mutation({
  args: {
    resource: v.string(),
    ttlMs: v.number(),
    ownerId: v.optional(v.string()),
    now: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, { resource, ttlMs, ownerId, now }) => {
    const existing = await byResource(ctx, resource)
    if (existing && existing.expiresAt > now) return null
    const token = randomId('lease')
    const record = { resource, token, ownerId, expiresAt: now + ttlMs }
    if (existing) await ctx.db.patch(existing._id, record)
    else await ctx.db.insert('runtimeLeases', record)
    return record
  },
})

export const extend = mutation({
  args: { lease: v.any(), ttlMs: v.number(), now: v.number() },
  returns: v.any(),
  handler: async (ctx, { lease, ttlMs, now }) => {
    const existing = await byResource(ctx, lease.resource)
    if (!existing || existing.token !== lease.token) {
      throw new Error(`Runtime lease ${lease.resource} is no longer owned by this worker.`)
    }
    const next = { ...lease, expiresAt: now + ttlMs }
    await ctx.db.patch(existing._id, next)
    return next
  },
})

export const release = mutation({
  args: { lease: v.any() },
  returns: v.null(),
  handler: async (ctx, { lease }) => {
    const existing = await byResource(ctx, lease.resource)
    if (existing && existing.token === lease.token) {
      await ctx.db.delete(existing._id)
    }
    return null
  },
})

async function byResource(ctx: MutationCtx, resource: string) {
  return await ctx.db.query('runtimeLeases').withIndex('by_resource', (q) => q.eq('resource', resource)).first()
}
