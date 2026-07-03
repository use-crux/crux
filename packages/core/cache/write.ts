/**
 * The semantic cache write phase.
 *
 * {@link performWrite} applies the cache gate, and on success embeds the query
 * text, serializes the produced result into a {@link SemanticCacheEntry}, writes
 * it to the store (with ttl), emits write telemetry + artifact, and attaches
 * miss metadata to the returned result. Skips emit a `semantic-cache.skip` span.
 *
 * @module
 */

import { observe } from '../observability'
import { getRuntime } from '../runtime/runtime'
import type { JsonObject } from '../storage'
import type { MiddlewareResult } from '../runtime/types'
import {
  attachMissMeta,
  cacheKey,
  extractFinishReason,
  extractToolCalls,
  resultKindFromResult,
  serializeResult,
} from './entry'
import { emitSemanticCacheArtifact, emitSemanticCacheSkipSpan } from './observability'
import { hashStable, resolveQueryText, resolveSemanticCacheStores } from './query'
import { shouldCache } from './policies'
import type { CacheableResult, SemanticCacheCall, SemanticCacheEntry, SemanticCacheWriteContext } from './types'

/**
 * Run the cache write phase for a produced result.
 *
 * @param call - The per-call cache context.
 * @param result - The result produced by the downstream middleware chain.
 * @returns The same result, with miss metadata attached when it was written.
 */
export async function performWrite(call: SemanticCacheCall, result: MiddlewareResult): Promise<MiddlewareResult> {
  const { config, namespace, args, promptHint, cacheId, scopeHash, ttl, lookupCtx } = call
  const stores = resolveSemanticCacheStores(config)
  const { promptId, operation, version, mode } = lookupCtx
  const cacheableResult = result as unknown as CacheableResult

  const writeCtx: SemanticCacheWriteContext = {
    ...lookupCtx,
    result,
    finishReason: extractFinishReason(cacheableResult),
    toolCallsPresent: extractToolCalls(cacheableResult).length > 0,
  }

  if (!(await shouldCache(config, writeCtx))) {
    emitSemanticCacheSkipSpan({
      cacheId,
      namespace,
      promptId,
      operation,
      scopeHash,
      version,
      mode,
      reason: 'shouldCache returned false',
    })
    return result
  }

  const writeStarted = Date.now()
  const writeSpan = observe.openSpan({
    name: 'semantic-cache.write',
    family: 'cache',
    primitive: 'cache.lookup',
    attributes: {
      cacheKind: 'semantic',
      cacheOperation: 'write',
      cacheId,
      namespace,
      promptId,
      operation,
      scopeHash,
      version,
      mode,
      ttl,
    },
  })

  try {
    await writeSpan.withContext(async () => {
      const queryText = await resolveQueryText(promptHint, args)
      const dense = await config.embedding.embed(queryText)
      const now = Date.now()
      const resultKind = args.outputMode ?? resultKindFromResult(cacheableResult)
      const entry: SemanticCacheEntry = {
        cruxType: 'semantic-cache-entry',
        namespace,
        ...(promptId ? { promptId } : {}),
        scopeHash,
        version,
        queryHash: hashStable(queryText),
        queryText,
        embedding: dense,
        resultKind,
        result: serializeResult(cacheableResult, resultKind),
        createdAt: now,
        updatedAt: now,
        expiresAt: now + ttl,
      }

      const key = cacheKey(namespace, promptId, scopeHash, version, entry.queryHash)
      await stores.records.put(key, entry as unknown as JsonObject, { ttlMs: ttl })
      await stores.vectors.upsert([
        {
          key,
          dense,
          metadata: {
            cruxType: 'semantic-cache-entry',
            namespace,
            ...(promptId ? { promptId } : {}),
            scopeHash,
            version,
            resultKind,
          },
        },
      ])
      observe.event({
        name: 'semantic-cache.write',
        attributes: {
          cacheKind: 'semantic',
          cacheOperation: 'write',
          cacheId,
          promptId,
          operation,
          scopeHash,
          version,
          queryHash: entry.queryHash,
          ttl,
          resultKind,
        },
      })
      emitSemanticCacheArtifact(writeSpan.spanId, 'write', {
        cacheId,
        promptId,
        operation,
        scopeHash,
        version,
        queryHash: entry.queryHash,
        ttl,
        resultKind,
        written: true,
      })

      writeSpan.end({
        attributes: {
          cacheKind: 'semantic',
          cacheOperation: 'write',
          cacheId,
          promptId,
          operation,
          scopeHash,
          version,
          queryHash: entry.queryHash,
          ttl,
          resultKind,
          written: true,
          durationMs: Date.now() - writeStarted,
        },
      })
    })
  } catch (error) {
    writeSpan.error(error, {
      cacheKind: 'semantic',
      cacheOperation: 'write',
      cacheId,
      promptId,
      operation,
      scopeHash,
      version,
      ttl,
      durationMs: Date.now() - writeStarted,
    })
    throw error
  }

  attachMissMeta(result)
  return result
}
