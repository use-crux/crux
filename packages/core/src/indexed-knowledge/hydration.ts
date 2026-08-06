/**
 * Hydration diagnostics for indexed knowledge search hits.
 *
 * Search stores can return keys that no longer hydrate to active chunk records
 * after adapter bugs, key mismatches, or stale physical search records. This module
 * centralizes the fail-fast diagnostics required by the Retrieval beta runtime
 * contract.
 *
 * @module
 */

import { RetrievalRunError } from '../retrieval/errors'

/** Reason a search hit could not hydrate into an active indexed chunk. */
export type IndexedHydrationMissReason = 'missing_record' | 'inactive_or_wrong_namespace' | 'invalid_record'

/** One search-hit hydration miss. */
export interface IndexedHydrationMiss {
  /** Search hit key that could not become a retrieval hit. */
  readonly key: string
  /** Stable diagnostic reason for trace consumers. */
  readonly reason: IndexedHydrationMissReason
}

/** Fail when every search hit missed because its backing record was absent. */
export function assertSearchHitsHydrated(input: {
  readonly searchHitCount: number
  readonly hydratedCount: number
  readonly misses: readonly IndexedHydrationMiss[]
}): void {
  if (input.searchHitCount === 0 || input.hydratedCount > 0) return
  const missing = input.misses.filter((miss) => miss.reason === 'missing_record')
  if (missing.length === 0) return

  throw new RetrievalRunError(
    'hydration_miss',
    `Search hits could not be hydrated from indexed knowledge records. Check for a search/record key or indexer id mismatch. Missing keys: ${missing
      .map((miss) => miss.key)
      .join(', ')}`,
    {
      trace: {
        searchHitCount: input.searchHitCount,
        hydratedCount: input.hydratedCount,
        misses: input.misses,
      },
    },
  )
}

/** Fail when every hydrated record was not a valid indexed chunk record. */
export function assertValidHydratedChunks(input: {
  readonly scoredKeys: readonly string[]
  readonly hitCount: number
}): void {
  if (input.scoredKeys.length === 0 || input.hitCount > 0) return

  throw new RetrievalRunError(
    'hydration_miss',
    `Search hits could not be hydrated from valid indexed chunk records. Check for a search/record key or indexer id mismatch. Invalid keys: ${input.scoredKeys.join(
      ', ',
    )}`,
    {
      trace: {
        searchHitCount: input.scoredKeys.length,
        hydratedCount: 0,
        misses: input.scoredKeys.map((key) => ({ key, reason: 'invalid_record' })),
      },
    },
  )
}
