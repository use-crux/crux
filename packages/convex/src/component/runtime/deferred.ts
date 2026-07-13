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

export const createScope = mutation({
  args: { scope: v.any() },
  returns: v.any(),
  handler: async (ctx, { scope }) => {
    const existing = await ctx.db
      .query('runtimeDeferredScopes')
      .withIndex('by_scope', (q) =>
        q.eq('namespace', scope.namespace).eq('scopeId', scope.scopeId),
      )
      .first()
    if (existing) return existing
    await ctx.db.insert('runtimeDeferredScopes', scope)
    return scope
  },
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
    // Updates only — creation is createScope. Scope lifecycle is monotonic:
    // open may renew or close; terminal never reopens or flips terminals.
    if (!existing) return null
    const nextState =
      typeof scope.finalizationState === 'string'
        ? scope.finalizationState
        : scope.finalization?.state
    if (!isScopeLifecycleAllowed(existing.finalizationState, nextState)) {
      return null
    }
    await ctx.db.replace(existing._id, scope)
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

export const createIntent = mutation({
  args: { intent: v.any() },
  returns: v.any(),
  handler: async (ctx, { intent }) => {
    const existing = await ctx.db
      .query('runtimeDeferredIntents')
      .withIndex('by_intent', (q) =>
        q.eq('namespace', intent.namespace).eq('intentId', intent.intentId),
      )
      .first()
    if (existing) return existing
    await ctx.db.insert('runtimeDeferredIntents', intent)
    return intent
  },
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
    // Updates only — creation is createIntent. Preserve identity columns and
    // never switch an intent after it chooses a terminal state.
    if (!existing) return null
    if (existing.state !== 'staged' && intent.state !== existing.state) {
      return null
    }
    await ctx.db.replace(existing._id, {
      ...existing,
      state: intent.state,
      updatedAt: intent.updatedAt,
    })
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

/** Open may renew or close; terminal must not reopen or flip. */
function isScopeLifecycleAllowed(
  fromState: string | null | undefined,
  toState: string | null | undefined,
): boolean {
  if (fromState === 'open') return true
  if (toState === 'open') return false
  return fromState === toState && fromState !== undefined && fromState !== null
}
