import type {
  AppendEventOptions,
  DurableEventPort,
  NewRuntimeEvent,
  ReadEventsOptions,
  ReadEventsResult,
  RuntimeEvent,
} from '../../ports/events'
import type { EventCursor } from '../../ports/ids'
import type { MemoryRuntimeData, MemoryWriteRecorder } from './data'
import { scopedKey } from './data'
import { cloneJsonValue } from './json'
import { matchesPruneNamespace, olderThan, pruneArray } from './retention'

export function createMemoryEventPort(
  data: MemoryRuntimeData,
  recordWrite?: MemoryWriteRecorder,
): DurableEventPort {
  return {
    async append(
      event: NewRuntimeEvent,
      options?: AppendEventOptions,
    ): Promise<RuntimeEvent> {
      const duplicateKey = eventDuplicateKey(event, options)
      const existing = duplicateKey
        ? data.eventsByDuplicateKey.get(duplicateKey)
        : undefined
      if (existing) return cloneRuntimeEvent(existing)

      recordWrite?.()
      const stored: RuntimeEvent = Object.freeze({
        namespace: event.namespace,
        name: event.name,
        payload: cloneJsonValue(event.payload, 'event payload'),
        eventId: (event.eventId ?? `evt_${data.nextEventId}`) as EventCursor,
        appendedAt: new Date(),
      })
      data.nextEventId += 1
      data.events.push(stored)
      data.eventsByDuplicateKey.set(eventIdentityKey(stored), stored)
      if (options?.idempotencyKey) {
        data.eventsByDuplicateKey.set(
          scopedKey(event.namespace, options.idempotencyKey),
          stored,
        )
      }
      return cloneRuntimeEvent(stored)
    },

    async read(options: ReadEventsOptions): Promise<ReadEventsResult> {
      const namespaceEvents = data.events.filter(
        (event) => event.namespace === options.namespace,
      )
      const afterIndex =
        options.after === undefined
          ? -1
          : namespaceEvents.findIndex((event) => event.eventId === options.after)
      const selected = namespaceEvents.slice(afterIndex + 1)
      const limited =
        options.limit === undefined ? selected : selected.slice(0, options.limit)
      const events = limited.map((event) => cloneRuntimeEvent(event))
      const cursor = events.at(-1)?.eventId
      return {
        events,
        ...(cursor ? { cursor } : {}),
        ...(options.after === undefined
          ? {}
          : { afterFound: afterIndex >= 0 }),
      }
    },

    async prune(options) {
      const result = pruneArray(
        data.events,
        options,
        (event) =>
          matchesPruneNamespace(event, options.namespace) &&
          olderThan(event.appendedAt, options.before),
        (event) => {
          for (const [key, value] of data.eventsByDuplicateKey.entries()) {
            if (value === event) data.eventsByDuplicateKey.delete(key)
          }
        },
      )
      if (result.removed > 0) recordWrite?.()
      return result
    },
  }
}

function eventDuplicateKey(
  event: NewRuntimeEvent,
  options: AppendEventOptions | undefined,
): string | undefined {
  if (event.eventId) return scopedKey(event.namespace, event.eventId)
  if (options?.idempotencyKey)
    return scopedKey(event.namespace, options.idempotencyKey)
  return undefined
}

function eventIdentityKey(event: RuntimeEvent): string {
  return scopedKey(event.namespace, event.eventId)
}

function cloneRuntimeEvent(event: RuntimeEvent): RuntimeEvent {
  return Object.freeze({
    namespace: event.namespace,
    name: event.name,
    payload: cloneJsonValue(event.payload, 'event payload'),
    eventId: event.eventId,
    appendedAt: new Date(event.appendedAt),
  })
}
