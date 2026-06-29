/**
 * The semantic cache lookup phase.
 *
 * {@link performLookup} embeds the query text, searches the store for a hit
 * above threshold, and on a hit emits hit telemetry + artifact and returns the
 * hydrated (or, for streams, replayed) result. On a miss it emits miss
 * telemetry and returns `undefined`. Wrapped in a `semantic-cache.lookup` span.
 *
 * @module
 */

import { observe } from '../observability'
import { getRuntime } from '../runtime/runtime'
import type { MiddlewareResult } from '../runtime/types'
import { buildHitMeta, hydrateResult, lookupEntry, resultKindFromArgs } from './entry'
import { emitSemanticCacheArtifact } from './observability'
import { hashStable, resolveQueryText } from './query'
import type { SemanticCacheCall, SemanticCacheEntry } from './types'

/**
 * Run the cache lookup phase for a call.
 *
 * @param call - The per-call cache context.
 * @returns The cached result on a hit, or `undefined` on a miss.
 */
export async function performLookup(call: SemanticCacheCall): Promise<MiddlewareResult | undefined> {
  const { config, namespace, args, promptHint, cacheId, scopeHash } = call
  const { promptId, operation, version, mode, toolsPresent, threshold: effectiveThreshold } = call.lookupCtx

  const lookupStarted = Date.now()
  const lookupSpan = observe.openSpan({
    name: 'semantic-cache.lookup',
    family: 'cache',
    primitive: 'cache.lookup',
    attributes: {
      cacheKind: 'semantic',
      cacheOperation: 'lookup',
      cacheId,
      namespace,
      promptId,
      operation,
      scopeHash,
      version,
      threshold: effectiveThreshold,
      mode,
      toolsPresent,
      resultKind: args.outputMode ?? resultKindFromArgs(args),
    },
  })

  return lookupSpan.withContext(async () => {
    let queryHash: string | undefined

    try {
      const queryText = await resolveQueryText(promptHint, args)
      const dense = await config.embedding.embed(queryText)
      queryHash = hashStable(queryText)

      getRuntime().instrumentationHooks?.onSemanticCacheLookupStart?.({
        cacheId,
        promptId,
        operation,
        scopeHash,
        version,
        threshold: effectiveThreshold,
      })

      const hit = await lookupEntry(config.store, {
        namespace,
        promptId,
        scopeHash,
        version,
        resultKind: args.outputMode ?? resultKindFromArgs(args),
        dense,
        threshold: effectiveThreshold,
      })

      getRuntime().instrumentationHooks?.onSemanticCacheLookupEnd?.({
        cacheId,
        promptId,
        operation,
        scopeHash,
        version,
        durationMs: Date.now() - lookupStarted,
        hit: Boolean(hit),
        score: hit?.score,
      })

      if (hit) {
        const entry = hit.value as SemanticCacheEntry
        const ageMs = Date.now() - entry.createdAt
        getRuntime().instrumentationHooks?.onSemanticCacheHit?.({
          cacheId,
          promptId,
          operation,
          scopeHash,
          version,
          score: hit.score,
          ageMs,
        })
        observe.event({
          name: 'semantic-cache.hit',
          attributes: {
            cacheKind: 'semantic',
            cacheOperation: 'lookup',
            cacheId,
            promptId,
            operation,
            scopeHash,
            version,
            queryHash,
            score: hit.score,
            ageMs,
            resultKind: entry.resultKind,
          },
        })
        emitSemanticCacheArtifact(lookupSpan.spanId, 'lookup-hit', {
          cacheId,
          promptId,
          operation,
          scopeHash,
          version,
          queryHash,
          score: hit.score,
          ageMs,
          resultKind: entry.resultKind,
          hit: true,
        })
        lookupSpan.end({
          cacheKind: 'semantic',
          cacheOperation: 'lookup',
          cacheId,
          promptId,
          operation,
          scopeHash,
          version,
          queryHash,
          hit: true,
          score: hit.score,
          ageMs,
          durationMs: Date.now() - lookupStarted,
        })
        if (operation === 'stream') {
          getRuntime().instrumentationHooks?.onSemanticCacheReplayStart?.({
            cacheId,
            promptId,
            scopeHash,
            version,
          })
          const replayStarted = Date.now()
          const replay = args.createCachedStreamResult?.({
            text: entry.result.text,
            object: entry.result.object,
            meta: buildHitMeta(entry, hit.score),
          })
          getRuntime().instrumentationHooks?.onSemanticCacheReplayEnd?.({
            cacheId,
            promptId,
            scopeHash,
            version,
            durationMs: Date.now() - replayStarted,
          })
          if (replay !== undefined) return replay
        }
        return hydrateResult(entry, hit.score)
      }

      observe.event({
        name: 'semantic-cache.miss',
        attributes: {
          cacheKind: 'semantic',
          cacheOperation: 'lookup',
          cacheId,
          promptId,
          operation,
          scopeHash,
          version,
          queryHash,
        },
      })
      getRuntime().instrumentationHooks?.onSemanticCacheMiss?.({
        cacheId,
        promptId,
        operation,
        scopeHash,
        version,
      })
      lookupSpan.end({
        cacheKind: 'semantic',
        cacheOperation: 'lookup',
        cacheId,
        promptId,
        operation,
        scopeHash,
        version,
        queryHash,
        hit: false,
        durationMs: Date.now() - lookupStarted,
      })
      return undefined
    } catch (error) {
      getRuntime().instrumentationHooks?.onSemanticCacheLookupEnd?.({
        cacheId,
        promptId,
        operation,
        scopeHash,
        version,
        durationMs: Date.now() - lookupStarted,
        hit: false,
        error: error instanceof Error ? error.message : String(error),
      })
      lookupSpan.error(error, {
        cacheKind: 'semantic',
        cacheOperation: 'lookup',
        cacheId,
        promptId,
        operation,
        scopeHash,
        version,
        queryHash,
        hit: false,
        durationMs: Date.now() - lookupStarted,
      })
      throw error
    }
  })
}
