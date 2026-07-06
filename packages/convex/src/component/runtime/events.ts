import { v } from 'convex/values'
import { mutation } from '../_generated/server.js'
import type { MutationCtx } from '../_generated/server.js'
import { limitRows, pruneBatch } from './shared'

export const append = mutation({
  args: { event: v.any(), idempotencyKey: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { event, idempotencyKey }) => {
    const existing = await findDuplicate(ctx, event.namespace, event.eventId, idempotencyKey)
    if (existing) return toRuntimeEvent(existing)

    const eventId = await nextCounter(ctx, `${event.namespace}:events`)
    const record = {
      ...event,
      eventId,
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
    const afterNumber = after ? await cursorNumber(ctx, namespace, after) : 0
    const rows = await ctx.db
      .query('runtimeEvents')
      .withIndex('by_namespace_event_id', (q) => q.eq('namespace', namespace))
      .collect()
    const events = limitRows(
      rows
        .filter((row) => row.eventId > afterNumber)
        .sort((left, right) => left.eventId - right.eventId)
        .map(toRuntimeEvent),
      limit,
    )
    return { events, cursor: events.at(-1)?.eventId ?? after }
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

async function cursorNumber(ctx: MutationCtx, namespace: string, cursor: string): Promise<number> {
  const numeric = Number(cursor)
  if (Number.isFinite(numeric)) return numeric
  const event = await ctx.db
    .query('runtimeEvents')
    .withIndex('by_namespace_event_key', (q) => q.eq('namespace', namespace).eq('eventKey', cursor))
    .first()
  return event?.eventId ?? 0
}

function toRuntimeEvent(record: { eventId: number; eventKey?: string }) {
  const { _id, _creationTime, ...event } = record as Record<string, unknown> & {
    eventId: number
    eventKey?: string
  }
  void _id
  void _creationTime
  return { ...event, eventId: record.eventKey ?? String(record.eventId) }
}

async function nextCounter(ctx: MutationCtx, key: string): Promise<number> {
  const existing = await ctx.db
    .query('runtimeCounters')
    .withIndex('by_key', (q) => q.eq('key', key))
    .first()
  const value = (existing?.value ?? 0) + 1
  if (existing) await ctx.db.patch(existing._id, { value })
  else await ctx.db.insert('runtimeCounters', { key, value })
  return value
}
