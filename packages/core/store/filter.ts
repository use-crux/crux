/**
 * Shared filter matching for CruxStore implementations.
 *
 * Supports dot-path notation for nested field access:
 * `{ 'metadata.threadId': 'abc' }` matches `value.metadata.threadId === 'abc'`.
 *
 * @module
 */

import type { JsonObject } from './types'

/**
 * Resolve a potentially nested field path on a JsonObject.
 *
 * @param obj - The object to traverse.
 * @param path - Dot-separated path, e.g. `'metadata.threadId'` or `'status'`.
 * @returns The value at the path, or `undefined` if any segment is missing.
 *
 * @example
 * ```ts
 * resolveFieldPath({ metadata: { threadId: 'abc' } }, 'metadata.threadId')
 * // → 'abc'
 * ```
 */
export function resolveFieldPath(obj: JsonObject, path: string): unknown {
  if (!path.includes('.')) return obj[path]

  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Check if a value matches a filter.
 *
 * Supports:
 * - Top-level exact match: `{ status: 'active' }`
 * - Dot-path nested match: `{ 'metadata.threadId': 'abc' }`
 * - Null matching: `{ removedAt: null }` matches missing or null fields
 *
 * @param value - The stored value to check.
 * @param filter - Key-value pairs to match against.
 * @returns `true` if all filter entries match.
 */
export function matchesFilter(value: JsonObject, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => {
    const actual = resolveFieldPath(value, k)
    if (v === null) return actual == null
    return actual === v
  })
}
