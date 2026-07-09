/**
 * Small bounded map for short-lived telemetry registry grace windows.
 *
 * The map performs lazy age sweeps on reads and writes. It is intentionally
 * timer-free so observability bookkeeping cannot keep serverless or test
 * processes alive.
 *
 * @module
 */

interface TtlEntry<TValue> {
  readonly value: TValue
  readonly insertedAtMs: number
}

export interface TtlMapOptions {
  /** Maximum number of entries retained after a write. */
  readonly maxEntries: number
  /** Maximum age in milliseconds before an entry is considered expired. */
  readonly ttlMs: number
}

export interface TtlMap<TKey, TValue> {
  /** Store a value and evict expired or least-recently inserted entries. */
  set(key: TKey, value: TValue): void
  /** Return a live value, or `undefined` after lazy expiry. */
  get(key: TKey): TValue | undefined
  /** Remove all entries. */
  clear(): void
}

/**
 * Create a bounded TTL map with insertion-order eviction.
 *
 * This is intentionally minimal: Phase 7 uses it for recently-ended span
 * references, where preserving any recent ref is better than keeping perfect
 * access recency metadata.
 *
 * @param options - Entry cap and max age.
 * @returns A lazy-sweeping TTL map.
 */
export function createTtlMap<TKey, TValue>(options: TtlMapOptions): TtlMap<TKey, TValue> {
  const entries = new Map<TKey, TtlEntry<TValue>>()

  return {
    set(key, value) {
      sweepExpired(entries, options.ttlMs)
      entries.delete(key)
      entries.set(key, { value, insertedAtMs: Date.now() })
      while (entries.size > options.maxEntries) {
        const oldestKey = entries.keys().next().value
        if (oldestKey === undefined) return
        entries.delete(oldestKey)
      }
    },

    get(key) {
      const entry = entries.get(key)
      if (!entry) return undefined
      if (isExpired(entry, options.ttlMs)) {
        entries.delete(key)
        return undefined
      }
      return entry.value
    },

    clear() {
      entries.clear()
    },
  }
}

function sweepExpired<TKey, TValue>(entries: Map<TKey, TtlEntry<TValue>>, ttlMs: number): void {
  for (const [key, entry] of entries) {
    if (isExpired(entry, ttlMs)) {
      entries.delete(key)
    }
  }
}

function isExpired<TValue>(entry: TtlEntry<TValue>, ttlMs: number): boolean {
  return Date.now() - entry.insertedAtMs > ttlMs
}
