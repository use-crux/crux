/**
 * Server-side stream helpers for injecting Crux data into AI SDK streams.
 *
 * Subscribe to RecordStore changes during streaming and inject `data-crux`
 * parts into the active UI message stream.
 *
 * @module
 */

import type { JsonObject, RecordEvent, RecordStore } from '@use-crux/core/storage'
import type { CruxDataPart } from './types'

/**
 * Minimal interface for a UI message stream writer.
 * Compatible with AI SDK v6's `UIMessageStreamWriter`.
 */
interface StreamWriter {
  write(part: { type: string; data: unknown }): void
}

/**
 * Options for `createCruxStreamWriter`.
 */
interface CruxStreamWriterOptions {
  /**
   * Debounce interval for progress updates (milliseconds).
   * Task progress updates are rate-limited to avoid flooding the stream.
   * Default: 500ms.
   */
  debounceMs?: number
  /**
   * Additional key prefixes to stream beyond built-in plan/task/tasklist.
   * Maps entity name to key prefix, e.g. `{ blackboard: 'blackboard:', working: 'working:' }`.
   */
  additionalPrefixes?: Record<string, string>
}

/**
 * A crux stream writer handle. Call `close()` when the stream ends
 * to unsubscribe from record changes.
 */
interface CruxStreamWriterHandle {
  /** Unsubscribe from store changes and flush pending updates. */
  close(): void
}

/**
 * Create a crux data injector for an AI SDK UIMessageStream.
 *
 * Subscribes to `RecordStore.watch()` and writes `data-crux` parts
 * to the stream writer whenever plans, task lists, or tasks change.
 * Progress updates are debounced to avoid flooding the stream.
 *
 * @param writer - The UIMessageStreamWriter from `createUIMessageStream`'s execute callback.
 * @param records - The RecordStore to subscribe to.
 * @param options - Optional debounce configuration.
 * @returns A handle with a `close()` method to stop listening.
 *
 * @example
 * ```ts
 * import { createCruxStreamWriter } from '@use-crux/ai/stream'
 * import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
 *
 * const stream = createUIMessageStream({
 *   execute: async ({ writer }) => {
 *     const crux = createCruxStreamWriter(writer, store)
 *
 *     const result = streamText({ model, messages })
 *     writer.merge(result.toUIMessageStream())
 *
 *     await result.consumePromise
 *     crux.close()
 *   },
 * })
 *
 * return createUIMessageStreamResponse({ stream })
 * ```
 */
export function createCruxStreamWriter(
  writer: StreamWriter,
  records: RecordStore,
  options?: CruxStreamWriterOptions,
): CruxStreamWriterHandle {
  const debounceMs = options?.debounceMs ?? 500

  // Track pending progress updates for debouncing
  const pendingProgress = new Map<string, { timer: ReturnType<typeof setTimeout>; value: unknown }>()

  const additionalPrefixes = options?.additionalPrefixes ?? {}

  function classifyKey(key: string): string | null {
    if (key.startsWith('plan:')) return 'plan'
    if (key.startsWith('tasklist:')) return 'tasklist'
    if (key.startsWith('task:')) return 'task'
    for (const [entity, prefix] of Object.entries(additionalPrefixes)) {
      if (key.startsWith(prefix)) return entity
    }
    return null
  }

  function isProgressUpdate(event: RecordEvent): boolean {
    if (event.type !== 'put') return false
    const entity = classifyKey(event.key)
    if (entity !== 'task') return false
    // A progress-only update: status didn't change, just progress text
    const value = event.value as Record<string, unknown> | undefined
    return value?.progress !== undefined
  }

  function writePart(key: string, value: unknown | null, eventType: 'put' | 'delete') {
    const entity = classifyKey(key)
    if (!entity) return

    const part: CruxDataPart = {
      entity,
      key,
      value: value as JsonObject | null,
      event: eventType,
    }

    writer.write({ type: 'data-crux', data: part })
  }

  function handleEvent(event: RecordEvent) {
    const entity = classifyKey(event.key)
    if (!entity) return

    if (event.type === 'delete') {
      // Flush any pending progress for this key
      const pending = pendingProgress.get(event.key)
      if (pending) {
        clearTimeout(pending.timer)
        pendingProgress.delete(event.key)
      }
      writePart(event.key, null, 'delete')
      return
    }

    // Debounce progress updates
    if (isProgressUpdate(event) && debounceMs > 0) {
      const existing = pendingProgress.get(event.key)
      if (existing) {
        clearTimeout(existing.timer)
      }
      const timer = setTimeout(() => {
        pendingProgress.delete(event.key)
        writePart(event.key, event.value, 'put')
      }, debounceMs)
      pendingProgress.set(event.key, { timer, value: event.value })
      return
    }

    writePart(event.key, event.value, 'put')
  }

  const unsubscribe = records.watch?.('', handleEvent)

  return {
    close() {
      unsubscribe?.()
      // Flush all pending progress updates
      for (const [key, pending] of pendingProgress) {
        clearTimeout(pending.timer)
        writePart(key, pending.value, 'put')
      }
      pendingProgress.clear()
    },
  }
}
