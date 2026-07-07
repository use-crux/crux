import type {
  AppendEventOptions,
  DurableEventPort,
  EventCursor,
  NewRuntimeEvent,
  RuntimeEvent,
} from '@use-crux/core/runtime'
import type { MutationCtx } from '../_generated/server.js'
import { decodeEvent } from '../../../runtime-engine/codec'
import { clean, cleanDoc, unsupported } from './composite-utils'
import { randomId } from './shared'

export function createCompositeEventPort(ctx: MutationCtx): DurableEventPort {
  return {
    append: (event, options) => appendEventRecord(ctx, event, options),
    read: unsupported('events.read'),
    prune: unsupported('events.prune'),
  }
}

async function appendEventRecord(
  ctx: MutationCtx,
  event: NewRuntimeEvent,
  options?: AppendEventOptions,
): Promise<RuntimeEvent> {
  const existing = await findDuplicateEvent(
    ctx,
    event.namespace,
    event.eventId,
    options?.idempotencyKey,
  )
  if (existing) return runtimeEventFromRecord(existing)

  const record = clean({
    ...event,
    eventId: generatedEventCursor(),
    eventKey: event.eventId,
    idempotencyKey: options?.idempotencyKey,
    appendedAt: Date.now(),
  })
  await ctx.db.insert('runtimeEvents', record)
  return runtimeEventFromRecord(record)
}

async function findDuplicateEvent(
  ctx: MutationCtx,
  namespace: string,
  eventKey: string | undefined,
  idempotencyKey: string | undefined,
) {
  if (eventKey) {
    const existing = await ctx.db
      .query('runtimeEvents')
      .withIndex('by_namespace_event_key', (q) =>
        q.eq('namespace', namespace).eq('eventKey', eventKey),
      )
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

function runtimeEventFromRecord(
  record: Record<string, unknown> & { eventId: string | number; eventKey?: string },
): RuntimeEvent {
  return decodeEvent({
    ...cleanDoc(record),
    eventId: (record.eventKey ?? String(record.eventId)) as EventCursor,
  })
}

function generatedEventCursor(): string {
  return `cvx:${randomId('event')}`
}
