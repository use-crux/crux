/**
 * SSE transport — reactive CruxStore access via Server-Sent Events.
 *
 * Connects to a `cruxSSEHandler` endpoint and accumulates `data-crux`
 * events into a local cache for use with `useSyncExternalStore`.
 *
 * @module
 */

import { useSyncExternalStore } from 'react'
import type { JsonObject, StoreEntry, ListOptions } from '@use-crux/core/store'
import { matchesFilter } from '@use-crux/core/store'
import type { CruxTransport } from './types'

/**
 * A `CruxTransport` backed by Server-Sent Events.
 */
export interface SSETransport extends CruxTransport {
  /** Close the EventSource connection. */
  close(): void
  /** Current connection state: 'connecting' | 'open' | 'closed'. */
  readonly readyState: 'connecting' | 'open' | 'closed'
}

/**
 * Options for `createSSETransport`.
 */
export interface SSETransportOptions {
  /**
   * Whether to automatically reconnect on connection drop.
   * Default: true.
   */
  reconnect?: boolean
  /**
   * Delay before reconnect attempt in milliseconds.
   * Default: 1000.
   */
  reconnectDelayMs?: number
}

/**
 * Create a `CruxTransport` backed by Server-Sent Events.
 *
 * Connects to a `cruxSSEHandler` endpoint and automatically accumulates
 * `data-crux` events. Hooks (`usePlan`, `useTaskList`, `useTasks`) read
 * from the accumulated cache.
 *
 * @param url - The SSE endpoint URL (e.g., '/api/crux/events').
 * @param options - Reconnect configuration.
 * @returns An `SSETransport` with `close()` for cleanup.
 *
 * @example
 * ```tsx
 * import { createSSETransport } from '@use-crux/react'
 * import { CruxProvider, usePlan } from '@use-crux/react'
 *
 * const transport = createSSETransport('/api/crux/events')
 *
 * <CruxProvider transport={transport}>
 *   <App />
 * </CruxProvider>
 *
 * // Don't forget cleanup:
 * useEffect(() => () => transport.close(), [])
 * ```
 */
export function createSSETransport(url: string, options?: SSETransportOptions): SSETransport {
  const reconnect = options?.reconnect ?? true
  const reconnectDelayMs = options?.reconnectDelayMs ?? 1000

  const cache = new Map<string, JsonObject>()
  const listeners = new Set<() => void>()
  let version = 0
  const snapshotCache = new Map<string, { version: number; value: unknown }>()

  let eventSource: EventSource | null = null
  let readyState: 'connecting' | 'open' | 'closed' = 'connecting'
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

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

  function connect() {
    if (typeof EventSource === 'undefined') return // SSR guard

    eventSource = new EventSource(url)
    readyState = 'connecting'

    eventSource.onopen = () => {
      readyState = 'open'
    }

    eventSource.addEventListener('data-crux', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as {
          entity: string
          key: string
          value: JsonObject | null
          event: 'set' | 'delete'
        }

        if (data.event === 'delete' || data.value === null) {
          cache.delete(data.key)
        } else {
          cache.set(data.key, data.value)
        }
        notify()
      } catch {
        // Ignore malformed events
      }
    })

    eventSource.onerror = () => {
      readyState = 'closed'
      eventSource?.close()
      eventSource = null

      if (reconnect) {
        reconnectTimer = setTimeout(connect, reconnectDelayMs)
      }
    }
  }

  // Start connection
  connect()

  return {
    get readyState() {
      return readyState
    },

    close() {
      readyState = 'closed'
      eventSource?.close()
      eventSource = null
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
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
