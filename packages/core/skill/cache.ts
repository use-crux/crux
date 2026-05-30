/**
 * Skill cache — in-memory Map with TTL.
 * Follows the contextResolverCache pattern from resolve.ts.
 */

import type { SkillReference } from './types'

/** Cached skill content (instructions + references). */
export interface SkillCacheEntry {
  readonly instructions: string
  readonly references: readonly SkillReference[]
  readonly name: string
  readonly description: string
  readonly version?: string
  readonly license?: string
  readonly tags?: readonly string[]
  readonly expiresAt: number
}

/** Default cache TTL: 1 hour. */
export const DEFAULT_CACHE_TTL = 60 * 60 * 1000

const skillCache = new Map<string, SkillCacheEntry>()

/** Get a cached skill entry, or null if not found or expired. */
export function getCached(key: string): SkillCacheEntry | null {
  const entry = skillCache.get(key)
  if (!entry) return null
  if (Date.now() >= entry.expiresAt) {
    skillCache.delete(key)
    return null
  }
  return entry
}

/** Store a skill entry in the cache with TTL. */
export function setCached(
  key: string,
  entry: Omit<SkillCacheEntry, 'expiresAt'>,
  ttl: number = DEFAULT_CACHE_TTL,
): void {
  skillCache.set(key, { ...entry, expiresAt: Date.now() + ttl })
}

/** Clear the entire skill cache. Useful for testing. */
export function clearCache(): void {
  skillCache.clear()
}

/** Get the number of entries in the cache. */
export function cacheSize(): number {
  return skillCache.size
}
