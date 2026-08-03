import { v } from 'convex/values'
import { mutation } from '../_generated/server.js'
import type { MutationCtx } from '../_generated/server.js'
import { limitRows, pruneBatch, randomId } from './shared'

export const append = mutation({
  args: { event: v.any(), idempotencyKey: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { event, idempotencyKey }) => {
    const existing = await findDuplicate(ctx, event.namespace, event.eventId, idempotencyKey)
    if (existing) return toRuntimeEvent(existing)

    const record = {
      ...event,
      eventId: generatedEventCursor(),
      eventKey: event.eventId,
      idempotencyKey,
      appendedAt: event.appendedAt ?? Date.now(),
    }
    await ctx.db.insert('runtimeEvents', record)
    return toRuntimeEvent(record)
  },
})

export const read = mutation({
  args: {
    namespace: v.string(),
    after: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, { namespace, after, limit }) => {
    const rows = await ctx.db
      .query('runtimeEvents')
      .withIndex('by_namespace_event_id', (q) => q.eq('namespace', namespace))
      .collect()
    const sorted = [...rows].sort(compareEventRows)
    const afterIndex = after
      ? sorted.findIndex((row) => matchesEventCursor(row, after))
      : -1
    const events = limitRows(
      sorted.slice(afterIndex + 1).map(toRuntimeEvent),
      limit,
    )
    return {
      events,
      cursor: events.at(-1)?.eventId ?? after,
      ...(after ? { afterFound: afterIndex >= 0 } : {}),
    }
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
          .query('runtimeEvents')
          .withIndex('by_namespace_appended', (q) => q.eq('namespace', namespace))
          .take(Math.max(0, Math.floor(limit)) + 1)
      : await ctx.db
          .query('runtimeEvents')
          .withIndex('by_appended')
          .take(Math.max(0, Math.floor(limit)) + 1)
    const batch = pruneBatch(
      rows
        .filter((row) => row.appendedAt < before)
        .sort((left, right) => left.appendedAt - right.appendedAt),
      limit,
    )
    for (const row of batch.selected) await ctx.db.delete(row._id)
    return { removed: batch.selected.length, truncated: batch.truncated }
  },
})

async function findDuplicate(
  ctx: MutationCtx,
  namespace: string,
  eventKey: string | undefined,
  idempotencyKey: string | undefined,
) {
  if (eventKey) {
    const existing = await ctx.db
      .query('runtimeEvents')
      .withIndex('by_namespace_event_key', (q) => q.eq('namespace', namespace).eq('eventKey', eventKey))
      .first()
    if (existing) return existing
  }
  if (idempotencyKey) {
    return await ctx.db
      .query('runtimeEvents')
      .withIndex('by_namespace_idempotency_key', (q) =>
        q.eq('namespace', namespace).eq('idempotencyKey', idempotencyKey),
      )
      .first()
  }
  return null
}

function toRuntimeEvent(record: { eventId: string | number; eventKey?: string }) {
  const { _id, _creationTime, ...event } = record as Record<string, unknown> & {
    eventId: string | number
    eventKey?: string
  }
  void _id
  void _creationTime
  return { ...event, eventId: record.eventKey ?? String(record.eventId) }
}

function generatedEventCursor(): string {
  return `cvx:${randomId('event')}`
}

function matchesEventCursor(
  record: { eventId: string | number; eventKey?: string },
  cursor: string,
): boolean {
  return String(record.eventId) === cursor || record.eventKey === cursor
}

function compareEventRows(
  left: { eventId: string | number; appendedAt?: number; _creationTime?: number; _id?: unknown },
  right: { eventId: string | number; appendedAt?: number; _creationTime?: number; _id?: unknown },
): number {
  const appended = (left.appendedAt ?? 0) - (right.appendedAt ?? 0)
  if (appended !== 0) return appended
  const created = (left._creationTime ?? 0) - (right._creationTime ?? 0)
  if (created !== 0) return created
  return String(left._id ?? left.eventId).localeCompare(String(right._id ?? right.eventId))
}
