/**
 * Bounded in-memory registry with LRU capacity eviction and lazy age sweeps.
 *
 * OTel integration registries are process-local bookkeeping. They must not
 * grow without bound when an application emits starts without corresponding
 * ends, and they must not install timers that keep short-lived runtimes alive.
 *
 * @module
 */

export type RegistryEvictionReason = 'capacity' | 'expired'

interface RegistryEntry<TValue> {
  readonly value: TValue
  readonly insertedAtMs: number
}

export interface BoundedRegistryOptions<TKey, TValue> {
  /** Maximum retained entries. */
  readonly maxEntries: number
  /** Maximum entry age before lazy eviction. */
  readonly maxAgeMs: number
  /** Called for every entry evicted by capacity or age. */
  readonly onEvict?: (key: TKey, value: TValue, reason: RegistryEvictionReason) => void
}

export interface BoundedRegistry<TKey, TValue> {
  /** Store a value, refreshing recency when the key already exists. */
  set(key: TKey, value: TValue): void
  /** Read a live value and refresh its recency. */
  get(key: TKey): TValue | undefined
  /** Remove a value without treating it as an eviction. */
  delete(key: TKey): TValue | undefined
  /** Remove all entries without treating them as evictions. */
  clear(): void
}

/**
 * Create an LRU registry with lazy max-age enforcement.
 *
 * @param options - Capacity, age, and optional eviction hook.
 * @returns A small registry facade over `Map`.
 */
export function createBoundedRegistry<TKey, TValue>(
  options: BoundedRegistryOptions<TKey, TValue>,
): BoundedRegistry<TKey, TValue> {
  const entries = new Map<TKey, RegistryEntry<TValue>>()

  return {
    set(key, value) {
      sweepExpired(entries, options)
      entries.delete(key)
      entries.set(key, { value, insertedAtMs: Date.now() })
      evictOverCapacity(entries, options)
    },

    get(key) {
      const entry = entries.get(key)
      if (!entry) return undefined
      if (isExpired(entry, options.maxAgeMs)) {
        entries.delete(key)
        options.onEvict?.(key, entry.value, 'expired')
        return undefined
      }
      entries.delete(key)
      entries.set(key, entry)
      return entry.value
    },

    delete(key) {
      const entry = entries.get(key)
      if (!entry) return undefined
      entries.delete(key)
      return entry.value
    },

    clear() {
      entries.clear()
    },
  }
}

function sweepExpired<TKey, TValue>(
  entries: Map<TKey, RegistryEntry<TValue>>,
  options: BoundedRegistryOptions<TKey, TValue>,
): void {
  for (const [key, entry] of entries) {
    if (isExpired(entry, options.maxAgeMs)) {
      entries.delete(key)
      options.onEvict?.(key, entry.value, 'expired')
    } else {
      break
    }
  }
}

function evictOverCapacity<TKey, TValue>(
  entries: Map<TKey, RegistryEntry<TValue>>,
  options: BoundedRegistryOptions<TKey, TValue>,
): void {
  while (entries.size > options.maxEntries) {
    const oldest = entries.entries().next().value
    if (!oldest) return
    const [key, entry] = oldest
    entries.delete(key)
    options.onEvict?.(key, entry.value, 'capacity')
  }
}

function isExpired<TValue>(entry: RegistryEntry<TValue>, maxAgeMs: number): boolean {
  return Date.now() - entry.insertedAtMs > maxAgeMs
}
