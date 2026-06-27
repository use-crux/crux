import type { StaticSyntaxFileRecord } from '../../static-index/syntax/record'
import { withStaticExtractionTiming, type StaticExtractionInstrumentation } from '../instrumentation'
import { cacheKeyInputFromSyntaxRecord, type StaticParseCacheKeyContext } from './cache-key'
import type { ParseMemo } from './source-io'
import type { StaticFileExtraction, StaticParseCacheEntryMetadata, StaticParseCacheStore } from './types'

/** Cache lookup state derived after a native/provided syntax record is available. */
export interface ParsedBatchMissCacheState {
  readonly cacheKey?: string
  readonly cacheMetadata?: StaticParseCacheEntryMetadata
  readonly cached?: StaticFileExtraction
}

/**
 * Builds cache state for a parsed batch miss without reparsing imports through
 * TypeScript. Cache metadata comes from the syntax record's normalized imports
 * and source hash.
 */
export async function cacheStateForParsedBatchMiss(input: {
  readonly root: string
  readonly file: string
  readonly compilerInputs: readonly unknown[]
  readonly store: StaticParseCacheStore
  readonly parseMemo: ParseMemo
  readonly recordsByFile: ReadonlyMap<string, StaticSyntaxFileRecord>
  readonly cacheKeyContext: StaticParseCacheKeyContext
  readonly instrumentation: StaticExtractionInstrumentation | undefined
}): Promise<ParsedBatchMissCacheState> {
  const record = input.recordsByFile.get(input.file)
  if (!record) return {}
  const key = await withStaticExtractionTiming(input.instrumentation, 'static.cache.key', input.file, () =>
    cacheKeyInputFromSyntaxRecord({
      root: input.root,
      record,
      parseMemo: input.parseMemo,
      compilerInputs: input.compilerInputs,
      context: input.cacheKeyContext,
    }),
  )
  if (!key) return {}
  const cacheKey = JSON.stringify(key)
  const cached = await withStaticExtractionTiming(input.instrumentation, 'static.cache.read', input.file, () =>
    input.store.get(cacheKey),
  )
  if (cached) return { cacheKey, cacheMetadata: key, cached: { ...cached, fromCache: true } }
  return { cacheKey, cacheMetadata: key }
}

/** Small bounded writer pool size for async static cache writes. */
export function staticCacheWriteConcurrency(extractionConcurrency: number): number {
  return Math.min(4, Math.max(2, extractionConcurrency))
}
