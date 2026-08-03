import { v } from 'convex/values'
import { mutation, type MutationCtx } from '../_generated/server.js'

/** Persist one content-addressed Runtime result and its ordered chunks atomically. */
export const put = mutation({
  args: {
    namespace: v.string(),
    sha256: v.string(),
    size: v.number(),
    mediaType: v.string(),
    location: v.string(),
    chunks: v.array(v.string()),
    createdAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('runtimeResults')
      .withIndex('by_location', (query) => query.eq('location', args.location))
      .unique()
    if (existing) {
      if (
        existing.namespace !== args.namespace ||
        existing.sha256 !== args.sha256 ||
        existing.size !== args.size ||
        existing.mediaType !== args.mediaType ||
        existing.chunkCount !== args.chunks.length
      ) {
        throw new Error('Runtime result location is already bound to different content.')
      }
      const chunks = await ctx.db
        .query('runtimeResultChunks')
        .withIndex('by_location_index', (query) => query.eq('location', args.location))
        .collect()
      if (chunks.some((chunk, index) => chunk.content !== args.chunks[index])) {
        throw new Error('Runtime result location is already bound to different content.')
      }
      return null
    }
    await ctx.db.insert('runtimeResults', {
      namespace: args.namespace,
      sha256: args.sha256,
      size: args.size,
      mediaType: args.mediaType,
      location: args.location,
      chunkCount: args.chunks.length,
      createdAt: args.createdAt,
    })
    for (const [index, content] of args.chunks.entries()) {
      await ctx.db.insert('runtimeResultChunks', {
        location: args.location,
        index,
        content,
      })
    }
    return null
  },
})

/** Read one Runtime result and its ordered chunks in a single component call. */
export const get = mutation({
  args: { location: v.string() },
  returns: v.any(),
  handler: async (ctx, { location }) => {
    const result = await ctx.db
      .query('runtimeResults')
      .withIndex('by_location', (query) => query.eq('location', location))
      .unique()
    if (!result) return null
    const chunks = await ctx.db
      .query('runtimeResultChunks')
      .withIndex('by_location_index', (query) => query.eq('location', location))
      .collect()
    return {
      namespace: result.namespace,
      sha256: result.sha256,
      size: result.size,
      mediaType: result.mediaType,
      location: result.location,
      chunks: chunks.map((chunk) => chunk.content),
      createdAt: result.createdAt,
    }
  },
})

/** Delete one Runtime result and every chunk idempotently. */
export const deleteResult = mutation({
  args: { ref: v.any() },
  returns: v.null(),
  handler: async (ctx, { ref }) => {
    await deleteLocation(ctx, String(ref.location))
    return null
  },
})

/** Delete a bounded batch of old results no work row references. */
export const pruneUnreferenced = mutation({
  args: {
    namespace: v.string(),
    before: v.number(),
    limit: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, { namespace, before, limit }) => {
    const candidates = await ctx.db
      .query('runtimeResults')
      .withIndex('by_namespace_created', (query) => query.eq('namespace', namespace).lt('createdAt', before))
      .take(Math.min(limit * 4 + 1, 1_001))
    let removed = 0
    for (const result of candidates) {
      if (removed >= limit) break
      const referenced = await ctx.db
        .query('runtimeWork')
        .withIndex('by_namespace_status_updated', (query) => query.eq('namespace', namespace).eq('status', 'completed'))
        .filter((query) => query.eq(query.field('resultRef.location'), result.location))
        .first()
      if (referenced) continue
      await deleteLocation(ctx, result.location)
      removed += 1
    }
    return { removed, truncated: candidates.length > limit }
  },
})

async function deleteLocation(ctx: MutationCtx, location: string): Promise<void> {
  const result = await ctx.db
    .query('runtimeResults')
    .withIndex('by_location', (query) => query.eq('location', location))
    .unique()
  const chunks = await ctx.db
    .query('runtimeResultChunks')
    .withIndex('by_location_index', (query) => query.eq('location', location))
    .collect()
  for (const chunk of chunks) await ctx.db.delete(chunk._id)
  if (result) await ctx.db.delete(result._id)
}
