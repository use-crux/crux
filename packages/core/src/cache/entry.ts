/**
 * Semantic cache entry I/O, serialization, and hydration.
 *
 * Vector lookup of a stored entry, building the cache key, serializing a
 * generate result into a stored entry, and hydrating a stored entry back into a
 * middleware result (with semantic-cache hit metadata). Internal helpers.
 *
 * @module
 */

import type { ExactFilter, RecordStore, VectorStore } from '../storage'
import type { MiddlewareResult, PromptMiddlewareArgs } from '../runtime/types'
import type { CacheableResult, SemanticCacheEntry } from './types'

/** Hydrated semantic cache vector hit. */
export interface SemanticCacheHit {
  readonly key: string
  readonly value: SemanticCacheEntry
  readonly score: number
}

/** Vector-search the store for the closest matching cache entry above threshold. */
export async function lookupEntry(
  records: RecordStore,
  vectors: VectorStore,
  query: {
    namespace: string
    promptId?: string
    scopeHash: string
    version: string
    resultKind: 'text' | 'object'
    dense: number[]
    threshold: number
  },
): Promise<SemanticCacheHit | null> {
  const filter: ExactFilter = {
    cruxType: 'semantic-cache-entry',
    namespace: query.namespace,
    ...(query.promptId ? { promptId: query.promptId } : {}),
    scopeHash: query.scopeHash,
    version: query.version,
    resultKind: query.resultKind,
  }
  const results = await vectors.search({
    mode: 'dense',
    dense: query.dense,
    threshold: query.threshold,
    limit: 1,
    filter,
  })
  const hit = results[0]
  if (!hit) return null
  const value = await records.get(hit.key)
  return isSemanticCacheEntry(value) ? { key: hit.key, value, score: hit.score } : null
}

/**
 * Serialize a generate result into the persisted entry `result` shape.
 *
 * Operation trace/span IDs identify one invocation and are intentionally not
 * cacheable. Provider response and policy metadata remain durable.
 */
export function serializeResult(
  result: CacheableResult | undefined,
  resultKind: 'text' | 'object',
): SemanticCacheEntry['result'] {
  const meta = result?._meta ?? {}
  const cacheableMeta = stripOperationIds(meta)
  const finishReason = meta.finishReason ?? result?.finishReason
  const usage = meta.usage ?? result?.usage
  return {
    ...(typeof result?.text === 'string' ? { text: result.text } : {}),
    ...(resultKind === 'object' && result?.object !== undefined ? { object: result.object } : {}),
    ...(finishReason !== undefined ? { finishReason } : {}),
    ...(usage !== undefined ? { usage } : {}),
    meta: cacheableMeta,
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
    ...stripOperationIds(entry.result.meta ?? {}),
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

/** Clone JSON metadata without invocation identity or absent optional fields. */
function stripOperationIds(meta: Record<string, unknown>): Record<string, unknown> {
  const cacheableMeta: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (key === 'traceId' || key === 'spanId' || value === undefined) continue
    cacheableMeta[key] = value
  }
  return cacheableMeta
}

/**
 * Return a freshly written result with semantic-cache miss facts.
 *
 * Result envelopes and metadata may already be frozen by the owning operation
 * finalizer, so this preserves descriptors instead of mutating either object.
 */
export function attachMissMeta(result: MiddlewareResult): MiddlewareResult {
  const resultDescriptors = Object.getOwnPropertyDescriptors(result)
  delete resultDescriptors._meta

  const existingMeta = result._meta ?? {}
  const metaDescriptors = Object.getOwnPropertyDescriptors(existingMeta)
  delete metaDescriptors.semanticCache

  const meta = Object.create(Object.getPrototypeOf(existingMeta)) as object
  Object.defineProperties(meta, metaDescriptors)
  Object.defineProperty(meta, 'semanticCache', {
    enumerable: true,
    value: Object.freeze({ hit: false, written: true }),
  })
  if (!Object.isExtensible(existingMeta)) Object.preventExtensions(meta)

  const cloned = Object.create(Object.getPrototypeOf(result)) as MiddlewareResult
  Object.defineProperties(cloned, resultDescriptors)
  Object.defineProperty(cloned, '_meta', { enumerable: true, value: meta })
  if (!Object.isExtensible(result)) Object.preventExtensions(cloned)
  return cloned
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

function isSemanticCacheEntry(value: unknown): value is SemanticCacheEntry {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { cruxType?: unknown }).cruxType === 'semantic-cache-entry' &&
      typeof (value as { namespace?: unknown }).namespace === 'string' &&
      typeof (value as { queryHash?: unknown }).queryHash === 'string',
  )
}
