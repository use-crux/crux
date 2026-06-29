/**
 * Memory persistence functions for the crux Convex component.
 *
 * These provide the backing store for the Convex store document contract.
 * Accessible from the host app via `components.crux.memory.*`.
 *
 * @module
 */

import { v } from 'convex/values'
import { STORE_DOC_COMPONENT_SPEC } from '../../store-doc/manifest'
import { mutation, query } from './_generated/server.js'

/**
 * Get a memory entry by key.
 */
export const get = query({
  args: { key: v.string() },
  returns: v.any(),
  handler: async (ctx, { key }) => {
    return ctx.db
      .query(STORE_DOC_COMPONENT_SPEC.table)
      .withIndex(STORE_DOC_COMPONENT_SPEC.indexes.byKey, (q) => q.eq(STORE_DOC_COMPONENT_SPEC.fields.key, key))
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
      .query(STORE_DOC_COMPONENT_SPEC.table)
      .withIndex(STORE_DOC_COMPONENT_SPEC.indexes.byKey, (q) => q.eq(STORE_DOC_COMPONENT_SPEC.fields.key, args.key))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, {
        content: args.content,
        metadata: args.metadata,
        embedding: args.embedding,
        updatedAt: args.updatedAt,
      })
    } else {
      await ctx.db.insert(STORE_DOC_COMPONENT_SPEC.table, {
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
 * Insert a memory entry by key only when no entry exists.
 */
export const insert = mutation({
  args: {
    key: v.string(),
    content: v.string(),
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
    updatedAt: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query(STORE_DOC_COMPONENT_SPEC.table)
      .withIndex(STORE_DOC_COMPONENT_SPEC.indexes.byKey, (q) => q.eq(STORE_DOC_COMPONENT_SPEC.fields.key, args.key))
      .first()

    if (existing) {
      return false
    }

    await ctx.db.insert(STORE_DOC_COMPONENT_SPEC.table, {
      key: args.key,
      content: args.content,
      metadata: args.metadata,
      embedding: args.embedding,
      createdAt: args.updatedAt,
      updatedAt: args.updatedAt,
    })
    return true
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
      .query(STORE_DOC_COMPONENT_SPEC.table)
      .withIndex(STORE_DOC_COMPONENT_SPEC.indexes.byKey, (q) => q.eq(STORE_DOC_COMPONENT_SPEC.fields.key, key))
      .first()
    if (existing) {
      await ctx.db.delete(existing._id)
    }
    return null
  },
})

/**
 * List one memory page by key prefix.
 *
 * The component owns only Convex-native I/O concerns here: key-indexed range
 * selection, pagination, and page shaping. Decoded JSON filtering is handled by
 * the store-document policy module in `@use-crux/convex`.
 */
export const list = query({
  args: {
    prefix: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    docs: v.array(v.any()),
    cursor: v.optional(v.string()),
  }),
  handler: async (ctx, { prefix = '', limit, cursor }) => {
    const numItems = normalizeListLimit(limit)
    if (numItems <= 0) {
      return { docs: [] }
    }

    const lowerBound = cursor ?? prefix
    const query = ctx.db
      .query(STORE_DOC_COMPONENT_SPEC.table)
      .withIndex(
        STORE_DOC_COMPONENT_SPEC.indexes.byKey,
        lowerBound || prefix
          ? (q) => {
              const upper = prefixUpperBound(prefix)
              const lower = cursor
                ? q.gt(STORE_DOC_COMPONENT_SPEC.fields.key, cursor)
                : q.gte(STORE_DOC_COMPONENT_SPEC.fields.key, prefix)
              return upper === undefined ? lower : lower.lt(STORE_DOC_COMPONENT_SPEC.fields.key, upper)
            }
          : undefined,
      )
      .order('asc')

    const docs = await query.take(numItems + 1)
    const page = docs.slice(0, numItems)
    const hasMore = docs.length > numItems
    const last = page.at(-1)

    return {
      docs: page,
      ...(hasMore && last ? { cursor: last.key } : {}),
    }
  },
})

function normalizeListLimit(limit: number | undefined): number {
  return Math.max(0, Math.floor(limit ?? STORE_DOC_COMPONENT_SPEC.defaultListLimit))
}

function prefixUpperBound(prefix: string): string | undefined {
  for (let index = prefix.length - 1; index >= 0; index -= 1) {
    const code = prefix.charCodeAt(index)
    if (code < 0xffff) {
      return `${prefix.slice(0, index)}${String.fromCharCode(code + 1)}`
    }
  }
  return undefined
}
