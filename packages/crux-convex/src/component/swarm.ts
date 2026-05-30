/**
 * Swarm state persistence functions for the crux Convex component.
 *
 * These are public component functions — accessible from the host app via
 * `ctx.runMutation(components.crux.swarm.saveState, args)` etc.
 *
 * @module
 */

import { v } from 'convex/values'
import { mutation, query } from './_generated/server.js'

/**
 * Upsert a swarm run state. Creates a new record if none exists for the
 * given swarmRunId, otherwise updates the existing one.
 */
export const saveState = mutation({
  args: {
    swarmRunId: v.string(),
    currentAgentId: v.string(),
    handoffPath: v.array(v.string()),
    handoffCount: v.number(),
    currentInput: v.any(),
    originalInput: v.any(),
    status: v.union(v.literal('running'), v.literal('completed'), v.literal('error')),
    output: v.optional(v.any()),
    error: v.optional(v.string()),
    flowId: v.string(),
    sessionId: v.optional(v.string()),
    observability: v.optional(v.any()),
    maxHandoffs: v.number(),
    history: v.union(v.literal('transfer-only'), v.literal('accumulate')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('swarmRuns')
      .withIndex('by_run_id', (q) => q.eq('swarmRunId', args.swarmRunId))
      .first()

    const now = Date.now()
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now })
    } else {
      await ctx.db.insert('swarmRuns', {
        ...args,
        createdAt: now,
        updatedAt: now,
      })
    }
    return null
  },
})

/**
 * Get a swarm run state by its run ID.
 */
export const getState = query({
  args: { swarmRunId: v.string() },
  returns: v.any(),
  handler: async (ctx, { swarmRunId }) => {
    return ctx.db
      .query('swarmRuns')
      .withIndex('by_run_id', (q) => q.eq('swarmRunId', swarmRunId))
      .first()
  },
})

/**
 * List swarm runs, optionally filtered by status.
 */
export const listRuns = query({
  args: {
    status: v.optional(v.union(v.literal('running'), v.literal('completed'), v.literal('error'))),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, { status, limit }) => {
    const q = status
      ? ctx.db.query('swarmRuns').withIndex('by_status', (q) => q.eq('status', status))
      : ctx.db.query('swarmRuns')
    return q.order('desc').take(limit ?? 50)
  },
})
