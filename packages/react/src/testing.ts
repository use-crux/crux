/**
 * Mock transport for testing Crux reactive hooks.
 *
 * Backed by an in-memory Map with `useSyncExternalStore` for reactivity.
 * Use `transport.put()` to update data and trigger re-renders in tests.
 *
 * @module
 */

import { useSyncExternalStore } from 'react'
import type { JsonObject, RecordEntry, RecordListOptions } from '@use-crux/core/storage'
import { matchesExactFilter } from '@use-crux/core/storage'
import type { CruxTransport } from './types'

/**
 * A mock transport that extends CruxTransport with a `put()` method
 * for updating data in tests.
 */
export interface MockTransport extends CruxTransport {
  /** Put a document value. Triggers re-renders for subscribed hooks. */
  put(key: string, value: JsonObject): void
  /** Delete a document. Triggers re-renders for subscribed hooks. */
  delete(key: string): void
  /** Get the raw data map (for assertions). */
  getData(): Map<string, JsonObject>
}

/**
 * Create a mock `CruxTransport` for testing.
 *
 * @example
 * ```tsx
 * const transport = createMockTransport()
 * transport.put('plan:abc', { id: 'abc', title: 'Test', ... })
 *
 * const { result } = renderHook(() => usePlan('abc'), {
 *   wrapper: ({ children }) => <CruxProvider transport={transport}>{children}</CruxProvider>,
 * })
 * expect(result.current?.title).toBe('Test')
 * ```
 */
export function createMockTransport(): MockTransport {
  const data = new Map<string, JsonObject>()
  const listeners = new Set<() => void>()

  // Snapshot cache: useSyncExternalStore requires stable references
  // when data hasn't changed. We cache by version number.
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

  /** Return a cached snapshot if version hasn't changed, otherwise compute and cache. */
  function cachedSnapshot<T>(cacheKey: string, compute: () => T): T {
    const cached = snapshotCache.get(cacheKey)
    if (cached && cached.version === version) return cached.value as T
    const value = compute()
    snapshotCache.set(cacheKey, { version, value })
    return value
  }

  return {
    put(key: string, value: JsonObject) {
      data.set(key, value)
      notify()
    },

    delete(key: string) {
      data.delete(key)
      notify()
    },

    getData() {
      return data
    },

    useDocument(key: string | undefined): JsonObject | null | undefined {
      return useSyncExternalStore(subscribe, () => {
        if (key === undefined) return undefined
        return cachedSnapshot(`doc:${key}`, () => data.get(key) ?? null)
      })
    },

    useDocumentList(prefix: string | undefined, options?: RecordListOptions): RecordEntry[] | undefined {
      const filterKey = options?.filter ? JSON.stringify(options.filter) : ''
      return useSyncExternalStore(subscribe, () => {
        if (prefix === undefined) return undefined
        return cachedSnapshot(`list:${prefix}:${filterKey}`, () => {
          let entries: RecordEntry[] = []
          for (const [key, value] of data) {
            if (key.startsWith(prefix)) {
              entries.push({ key, value })
            }
          }
          if (options?.filter) {
            const filter = options.filter
            entries = entries.filter((e) => matchesExactFilter(e.value, filter))
          }
          return entries
        })
      })
    },
  }
}
