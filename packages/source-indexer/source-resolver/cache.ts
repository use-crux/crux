/**
 * Cache helpers for source resolver state.
 *
 * These helpers keep cache key construction and eviction policy explicit. They
 * return new `Map` instances so the resolver facade can remain a small mutable
 * shell around functional cache transitions.
 *
 * @module
 */

import type { ResolvedLocation } from './types'

/** Maximum number of resolved location entries kept by a `SourceResolver`. */
export const MAX_LOCATION_CACHE = 5000

/** Cache key for a generated source-map lookup. */
export type LocationCacheKey = `${string}:${number}:${number}`

/** Build the stable cache key for a bundled location lookup. */
export function locationCacheKey(file: string, line: number, column: number | undefined): LocationCacheKey {
  return `${file}:${line}:${column ?? 0}`
}

/**
 * Return a new location cache with `value` stored under `key`.
 *
 * Eviction is oldest-entry-first and preserves the current compatibility
 * behavior. The input cache is never mutated.
 */
export function putLocationCache(
  cache: ReadonlyMap<LocationCacheKey, ResolvedLocation>,
  key: LocationCacheKey,
  value: ResolvedLocation,
  limit = MAX_LOCATION_CACHE,
): Map<LocationCacheKey, ResolvedLocation> {
  const next = new Map(cache)
  if (next.size >= limit && !next.has(key)) {
    const firstKey = next.keys().next().value
    if (firstKey !== undefined) next.delete(firstKey)
  }
  next.set(key, value)
  return next
}
