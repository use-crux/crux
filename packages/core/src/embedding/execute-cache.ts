/** Embedding-cache execution and observability. Internal. */

import { observe } from '../observability'
import { normalizedEmbeddingCacheKey } from './cache'
import { hashString } from './hashing'
import { combineGovernance, compactGovernance } from './metrics'
import type { NormalizedEmbeddingInput } from './modality'
import type {
  BatchExecutionResult,
  CacheCodec,
  EmbeddingGovernanceMetrics,
  NormalizedGovernance,
} from './types'

/** Resolve cache hits, execute misses, persist them, and merge one result. */
export async function executeWithEmbeddingCache<T>(args: {
  name: string
  kind: 'dense' | 'sparse'
  dimensions?: number
  inputs: readonly NormalizedEmbeddingInput[]
  role: 'query' | 'document'
  governance: NormalizedGovernance
  cacheCodec: CacheCodec<T>
  execute: (inputs: readonly NormalizedEmbeddingInput[]) => Promise<BatchExecutionResult<T>>
  metrics: EmbeddingGovernanceMetrics
}): Promise<BatchExecutionResult<T>> {
  const cache = args.governance.cache
  if (!cache) return args.execute(args.inputs)

  let cacheWriteCount = 0
  const span = observe.openSpan({
    name: `${args.name}.embedding-cache`,
    primitive: 'cache.lookup',
    attributes: {
      cacheKind: 'embedding',
      cacheOperation: 'lookup',
      cacheNamespace: cache.namespace,
      embeddingName: args.name,
      embeddingKind: args.kind,
      inputCount: args.inputs.length,
      fingerprintHash: hashString(args.governance.fingerprint),
      ...(args.dimensions !== undefined ? { dimensions: args.dimensions } : {}),
    },
  })

  try {
    const result = await span.withContext(async () => {
      const embeddings = new Array<T>(args.inputs.length)
      const misses = new Map<string, { key: string; input: NormalizedEmbeddingInput; indexes: number[] }>()
      const uncached: { input: NormalizedEmbeddingInput; index: number }[] = []

      for (let index = 0; index < args.inputs.length; index++) {
        const input = args.inputs[index]
        const key = normalizedEmbeddingCacheKey(cache.namespace, args.governance.fingerprint, input, {
          role: args.role,
          roleSensitive: args.governance.tasks !== undefined,
        })
        if (key === undefined) {
          args.metrics.cacheMissCount = (args.metrics.cacheMissCount ?? 0) + 1
          uncached.push({ input, index })
          observe.event({
            name: 'embedding-cache.entry',
            attributes: { cacheKind: 'embedding', hit: false, cacheable: false, inputIndex: index },
          })
          continue
        }

        const cached = args.cacheCodec.read(await cache.get(key))
        if (cached !== undefined) {
          embeddings[index] = cached
          args.metrics.cacheHitCount = (args.metrics.cacheHitCount ?? 0) + 1
          observe.event({
            name: 'embedding-cache.entry',
            attributes: { cacheKind: 'embedding', hit: true, inputIndex: index },
          })
          continue
        }

        args.metrics.cacheMissCount = (args.metrics.cacheMissCount ?? 0) + 1
        observe.event({
          name: 'embedding-cache.entry',
          attributes: { cacheKind: 'embedding', hit: false, inputIndex: index },
        })
        const existing = misses.get(key)
        if (existing) existing.indexes.push(index)
        else misses.set(key, { key, input, indexes: [index] })
      }

      if (misses.size === 0 && uncached.length === 0) {
        return { embeddings, governance: compactGovernance(args.metrics) }
      }

      const missEntries = [...misses.values()]
      const result = await args.execute([
        ...missEntries.map((entry) => entry.input),
        ...uncached.map((entry) => entry.input),
      ])

      for (let index = 0; index < missEntries.length; index++) {
        const entry = missEntries[index]
        const embedding = result.embeddings[index]
        await cache.set(entry.key, args.cacheCodec.write(embedding))
        cacheWriteCount += 1
        observe.event({
          name: 'embedding-cache.write',
          attributes: { cacheKind: 'embedding', outputIndexes: entry.indexes, cacheNamespace: cache.namespace },
        })
        for (const outputIndex of entry.indexes) embeddings[outputIndex] = embedding
      }

      for (let index = 0; index < uncached.length; index++) {
        embeddings[uncached[index].index] = result.embeddings[missEntries.length + index]
      }

      return {
        embeddings,
        usage: result.usage,
        cost: result.cost,
        governance: combineGovernance([args.metrics, result.governance]),
      }
    })
    span.end({
      attributes: {
        cacheKind: 'embedding',
        cacheOperation: 'lookup',
        cacheNamespace: cache.namespace,
        embeddingName: args.name,
        embeddingKind: args.kind,
        inputCount: args.inputs.length,
        hitCount: args.metrics.cacheHitCount ?? 0,
        missCount: args.metrics.cacheMissCount ?? 0,
        allHit: (args.metrics.cacheHitCount ?? 0) === args.inputs.length,
        writeCount: cacheWriteCount,
      },
    })
    return result
  } catch (error) {
    span.error(error, {
      cacheKind: 'embedding',
      cacheOperation: 'lookup',
      cacheNamespace: cache.namespace,
      embeddingName: args.name,
      embeddingKind: args.kind,
      inputCount: args.inputs.length,
      hitCount: args.metrics.cacheHitCount ?? 0,
      missCount: args.metrics.cacheMissCount ?? 0,
    })
    throw error
  }
}
