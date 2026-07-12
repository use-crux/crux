import { v } from 'convex/values'
import { mutation } from '../_generated/server.js'
import { limitRows } from './shared'

export const getScope = mutation({
  args: { namespace: v.string(), scopeId: v.string() },
  returns: v.any(),
  handler: async (ctx, { namespace, scopeId }) =>
    await ctx.db
      .query('runtimeDeferredScopes')
      .withIndex('by_scope', (q) =>
        q.eq('namespace', namespace).eq('scopeId', scopeId),
      )
      .first(),
})

export const putScope = mutation({
  args: { scope: v.any() },
  returns: v.null(),
  handler: async (ctx, { scope }) => {
    const existing = await ctx.db
      .query('runtimeDeferredScopes')
      .withIndex('by_scope', (q) =>
        q.eq('namespace', scope.namespace).eq('scopeId', scope.scopeId),
      )
      .first()
    if (existing) await ctx.db.replace(existing._id, scope)
    else await ctx.db.insert('runtimeDeferredScopes', scope)
    return null
  },
})

export const listScopes = mutation({
  args: {
    namespace: v.string(),
    state: v.optional(v.string()),
    leaseExpiresBefore: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, options) => {
    const rows = options.state
      ? await ctx.db
          .query('runtimeDeferredScopes')
          .withIndex('by_namespace_state_expiry', (q) =>
            q
              .eq('namespace', options.namespace)
              .eq('finalizationState', options.state!),
          )
          .take(options.limit ?? 1_000)
      : await ctx.db
          .query('runtimeDeferredScopes')
          .withIndex('by_scope', (q) => q.eq('namespace', options.namespace))
          .take(options.limit ?? 1_000)
    return limitRows(
      rows.filter(
        (row) =>
          options.leaseExpiresBefore === undefined ||
          row.leaseExpiresAt < options.leaseExpiresBefore,
      ),
      options.limit,
    )
  },
})

export const getIntent = mutation({
  args: { namespace: v.string(), intentId: v.string() },
  returns: v.any(),
  handler: async (ctx, { namespace, intentId }) =>
    await ctx.db
      .query('runtimeDeferredIntents')
      .withIndex('by_intent', (q) =>
        q.eq('namespace', namespace).eq('intentId', intentId),
      )
      .first(),
})

export const putIntent = mutation({
  args: { intent: v.any() },
  returns: v.null(),
  handler: async (ctx, { intent }) => {
    const existing = await ctx.db
      .query('runtimeDeferredIntents')
      .withIndex('by_intent', (q) =>
        q.eq('namespace', intent.namespace).eq('intentId', intent.intentId),
      )
      .first()
    if (existing) await ctx.db.replace(existing._id, intent)
    else await ctx.db.insert('runtimeDeferredIntents', intent)
    return null
  },
})

export const listIntents = mutation({
  args: {
    namespace: v.string(),
    scopeId: v.string(),
    state: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, options) => {
    const rows = await ctx.db
      .query('runtimeDeferredIntents')
      .withIndex('by_scope_state', (q) => {
        const scope = q
          .eq('namespace', options.namespace)
          .eq('scopeId', options.scopeId)
        return options.state ? scope.eq('state', options.state) : scope
      })
      .take(options.limit ?? 1_000)
    return limitRows(rows, options.limit)
  },
})
