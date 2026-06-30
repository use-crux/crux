/**
 * Exact Storage Beta filter helpers.
 *
 * These utilities implement the public filter contract used by record and
 * vector metadata filters: top-level JSON scalar equality only.
 *
 * @module
 */

import type { ExactFilter, JsonObject } from './types'

/**
 * Check whether a JSON object satisfies an exact top-level scalar filter.
 *
 * Missing fields never match, including `null` filters; `null` only matches an
 * explicit JSON `null` value.
 *
 * @param value - JSON object to inspect.
 * @param filter - Exact top-level scalar equality constraints.
 * @returns `true` when every filter key matches exactly.
 */
export function matchesExactFilter(value: JsonObject, filter: ExactFilter): boolean {
  return Object.entries(filter).every(([key, expected]) =>
    Object.prototype.hasOwnProperty.call(value, key) ? value[key] === expected : false,
  )
}
