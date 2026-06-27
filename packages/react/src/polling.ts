/**
 * Polling transport — universal fallback for any CruxStore.
 *
 * Periodically fetches data from a CruxStore and exposes it as a
 * `CruxTransport` via `useSyncExternalStore`. Works with any backend
 * that implements CruxStore (no `subscribe()` required).
 *
 * @module
 */

import { useSyncExternalStore } from 'react'
import type { CruxStore, JsonObject, StoreEntry, ListOptions } from '@use-crux/core/store'
import { matchesFilter } from '@use-crux/core/store'
import type { CruxTransport } from './types'

/**
 * A `CruxTransport` backed by periodic polling of a `CruxStore`.
 */
export interface PollingTransport extends CruxTransport {
  /** Manually trigger a poll (useful in tests). */
  poll(): Promise<void>
  /** Stop the polling interval. */
  stop(): void
}

/**
 * Options for `createPollingTransport`.
 */
export interface PollingTransportOptions {
  /** Polling interval in milliseconds. Default: 1000. */
  intervalMs?: number
}

/**
 * Create a `CruxTransport` that polls a `CruxStore` at a regular interval.
 *
 * This is the universal fallback — works with any backend that implements
 * `CruxStore`, even without `subscribe()` support.
 *
 * @param store - The CruxStore to poll.
 * @param options - Polling interval configuration.
 * @returns A `PollingTransport` with `poll()` and `stop()` controls.
 *
 * @example
 * ```tsx
 * import { createPollingTransport } from '@use-crux/react'
 *
 * const transport = createPollingTransport(store, { intervalMs: 2000 })
 *
 * <CruxProvider transport={transport}>
 *   <App />
 * </CruxProvider>
 * ```
 */
export function createPollingTransport(store: CruxStore, options?: PollingTransportOptions): PollingTransport {
  const intervalMs = options?.intervalMs ?? 1000
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

  async function poll() {
    // Fetch all entries from the store
    const result = await store.list('')
    cache.clear()
    for (const entry of result.entries) {
      cache.set(entry.key, entry.value)
    }
    notify()
  }

  // Start polling
  const interval = setInterval(poll, intervalMs)

  return {
    poll,

    stop() {
      clearInterval(interval)
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
