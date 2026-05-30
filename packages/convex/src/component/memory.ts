/**
 * Memory persistence functions for the crux Convex component.
 *
 * These provide the backing store for `cruxConvexStore({ component })`.
 * Accessible from the host app via `components.crux.memory.*`.
 *
 * @module
 */

import { v } from 'convex/values'
import { mutation, query } from './_generated/server.js'

/**
 * Get a memory entry by key.
 */
export const get = query({
  args: { key: v.string() },
  returns: v.any(),
  handler: async (ctx, { key }) => {
    return ctx.db
      .query('memories')
      .withIndex('by_key', (q) => q.eq('key', key))
      .first()
  },
})

/**
 * Upsert a memory entry by key.
 */
export const set = mutation({
  args: {
    key: v.string(),
    content: v.string(),
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
    updatedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('memories')
      .withIndex('by_key', (q) => q.eq('key', args.key))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, {
        content: args.content,
        metadata: args.metadata,
        embedding: args.embedding,
        updatedAt: args.updatedAt,
      })
    } else {
      await ctx.db.insert('memories', {
        key: args.key,
        content: args.content,
        metadata: args.metadata,
        embedding: args.embedding,
        createdAt: args.updatedAt,
        updatedAt: args.updatedAt,
      })
    }
    return null
  },
})

/**
 * Delete a memory entry by key.
 */
export const remove = mutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    const existing = await ctx.db
      .query('memories')
      .withIndex('by_key', (q) => q.eq('key', key))
      .first()
    if (existing) {
      await ctx.db.delete(existing._id)
    }
    return null
  },
})

/**
 * List memory entries with optional prefix filter and limit.
 */
export const list = query({
  args: {
    prefix: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    filter: v.optional(v.any()),
  },
  returns: v.any(),
  handler: async (ctx, { prefix, limit }) => {
    let results = await ctx.db
      .query('memories')
      .order('desc')
      .take(limit ?? 100)

    if (prefix) {
      results = results.filter((doc) => doc.key.startsWith(prefix))
    }

    return results
  },
})
