/**
 * Semantic cache entry I/O, serialization, and hydration.
 *
 * Vector lookup of a stored entry, building the cache key, serializing a
 * generate result into a stored entry, and hydrating a stored entry back into a
 * middleware result (with semantic-cache hit metadata). Internal helpers.
 *
 * @module
 */

import type { CruxStore, ScoredEntry } from '../store/types'
import type { MiddlewareResult, PromptMiddlewareArgs } from '../types'
import type { CacheableResult, SemanticCacheEntry } from './types'

/** Vector-search the store for the closest matching cache entry above threshold. */
export async function lookupEntry(
  store: CruxStore,
  query: {
    namespace: string
    promptId?: string
    scopeHash: string
    version: string
    resultKind: 'text' | 'object'
    dense: number[]
    threshold: number
  },
): Promise<ScoredEntry | null> {
  const filter = {
    cruxType: 'semantic-cache-entry',
    namespace: query.namespace,
    ...(query.promptId ? { promptId: query.promptId } : {}),
    scopeHash: query.scopeHash,
    version: query.version,
    resultKind: query.resultKind,
  }
  const results = store.searchVectors
    ? await store.searchVectors({ dense: query.dense, threshold: query.threshold, limit: 1, filter })
    : await store.vectorSearch!(query.dense, { threshold: query.threshold, limit: 1, filter })
  return results[0] ?? null
}

/** Serialize a generate result into the persisted entry `result` shape. */
export function serializeResult(
  result: CacheableResult | undefined,
  resultKind: 'text' | 'object',
): SemanticCacheEntry['result'] {
  const meta = result?._meta ?? {}
  return {
    ...(typeof result?.text === 'string' ? { text: result.text } : {}),
    ...(resultKind === 'object' && result?.object !== undefined ? { object: result.object } : {}),
    finishReason: meta.finishReason ?? result?.finishReason,
    usage: meta.usage ?? result?.usage,
    meta,
  }
}

/** Hydrate a stored entry into a middleware result with hit metadata. */
export function hydrateResult(entry: SemanticCacheEntry, score: number): MiddlewareResult {
  return {
    ...(entry.result.text !== undefined ? { text: entry.result.text } : {}),
    ...(entry.result.object !== undefined ? { object: entry.result.object } : {}),
    _meta: buildHitMeta(entry, score) as MiddlewareResult['_meta'],
  }
}

/** Build the `_meta` payload for a cache hit, including semantic-cache details. */
export function buildHitMeta(entry: SemanticCacheEntry, score: number): Record<string, unknown> {
  return {
    ...(entry.result.meta ?? {}),
    usage: entry.result.usage,
    finishReason: entry.result.finishReason,
    semanticCache: {
      hit: true,
      score,
      ageMs: Date.now() - entry.createdAt,
      scopeHash: entry.scopeHash,
      version: entry.version,
    },
  }
}

/** Attach miss metadata to a freshly produced (and now written) result, in place. */
export function attachMissMeta(result: unknown): void {
  if (!result || typeof result !== 'object') return
  const ref = result as CacheableResult
  ref._meta = {
    ...(ref._meta ?? {}),
    semanticCache: { hit: false, written: true },
  }
}

/** Extract tool calls from a result's `_meta` or top-level fields. */
export function extractToolCalls(result: CacheableResult | undefined): unknown[] {
  return result?._meta?.toolCalls ?? result?.toolCalls ?? []
}

/** Extract the finish reason from a result's `_meta` or top-level field. */
export function extractFinishReason(result: CacheableResult | undefined): string | undefined {
  return result?._meta?.finishReason ?? result?.finishReason
}

/** Determine whether a call expects text or object output from its args. */
export function resultKindFromArgs(args: PromptMiddlewareArgs): 'text' | 'object' {
  return args.outputMode ?? (args.resolved?.schema ? 'object' : 'text')
}

/** Determine whether a produced result is text or object output. */
export function resultKindFromResult(result: CacheableResult | undefined): 'text' | 'object' {
  return result?.object !== undefined ? 'object' : 'text'
}

/** Build the deterministic store key for a cache entry. */
export function cacheKey(
  namespace: string,
  promptId: string | undefined,
  scopeHash: string,
  version: string,
  queryHash: string,
): string {
  return `crux:semantic-cache:${namespace}:${promptId ?? 'anonymous'}:${scopeHash}:${version}:${queryHash}`
}
