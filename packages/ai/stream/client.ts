/**
 * Client-side stream transport for Crux reactive hooks.
 *
 * Accumulates `data-crux` parts from AI SDK streams and exposes them
 * as a `CruxTransport` for use with `<CruxProvider>`.
 *
 * @module
 */

import { useSyncExternalStore } from 'react'
import type { CruxTransport } from '@use-crux/react'
import type { JsonObject, StoreEntry, ListOptions } from '@use-crux/core/store'
import { matchesFilter } from '@use-crux/core/store'
import type { CruxDataPart } from './types'

/**
 * A `CruxTransport` that accumulates data from AI SDK stream data parts.
 * Feed it with `transport.ingest(part)` from `useChat`'s `onData` callback.
 */
export interface StreamTransport extends CruxTransport {
  /**
   * Ingest a data part from the AI SDK stream.
   * Call this from `useChat`'s `onData` callback.
   * Non-crux parts are silently ignored.
   */
  ingest(part: { type: string; data?: unknown }): void

  /**
   * Clear all accumulated data. Useful when starting a new conversation.
   */
  clear(): void
}

/**
 * Create a `CruxTransport` backed by accumulated AI SDK stream data.
 *
 * @example
 * ```tsx
 * import { createStreamTransport } from '@use-crux/ai/stream'
 * import { CruxProvider, usePlan } from '@use-crux/react'
 *
 * function Chat() {
 *   const transport = useRef(createStreamTransport()).current
 *   const { messages } = useChat({
 *     onData: (part) => transport.ingest(part),
 *   })
 *   return (
 *     <CruxProvider transport={transport}>
 *       <PlanPanel />
 *     </CruxProvider>
 *   )
 * }
 * ```
 */
export function createStreamTransport(): StreamTransport {
  const cache = new Map<string, JsonObject>()
  const listeners = new Set<() => void>()
  let version = 0
  const snapshotCache = new Map<string, { version: number; value: unknown }>()

  function notify() {
    version++
    for (const listener of listeners) {
      listener()
    }
  }

  function subscribe(callback: () => void): () => void {
    listeners.add(callback)
    return () => listeners.delete(callback)
  }

  function cachedSnapshot<T>(cacheKey: string, compute: () => T): T {
    const cached = snapshotCache.get(cacheKey)
    if (cached && cached.version === version) return cached.value as T
    const value = compute()
    snapshotCache.set(cacheKey, { version, value })
    return value
  }

  return {
    ingest(part: { type: string; data?: unknown }) {
      if (part.type !== 'data-crux') return
      const data = part.data as CruxDataPart
      if (!data || !data.key) return

      if (data.event === 'delete' || data.value === null) {
        cache.delete(data.key)
      } else {
        cache.set(data.key, data.value)
      }
      notify()
    },

    clear() {
      cache.clear()
      notify()
    },

    useDocument(key: string | undefined): JsonObject | null | undefined {
      return useSyncExternalStore(subscribe, () => {
        if (key === undefined) return undefined
        return cachedSnapshot(`doc:${key}`, () => cache.get(key) ?? null)
      })
    },

    useDocumentList(prefix: string | undefined, options?: ListOptions): StoreEntry[] | undefined {
      const filterKey = options?.filter ? JSON.stringify(options.filter) : ''
      return useSyncExternalStore(subscribe, () => {
        if (prefix === undefined) return undefined
        return cachedSnapshot(`list:${prefix}:${filterKey}`, () => {
          let entries: StoreEntry[] = []
          for (const [key, value] of cache) {
            if (key.startsWith(prefix)) {
              entries.push({ key, value })
            }
          }
          if (options?.filter) {
            const filter = options.filter
            entries = entries.filter((e) => matchesFilter(e.value, filter))
          }
          return entries
        })
      })
    },
  }
}
