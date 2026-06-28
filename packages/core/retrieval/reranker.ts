/**
 * Reranker authoring and application.
 *
 * A reranker reorders retrieved hits (e.g. via a cross-encoder). Rerankers run
 * in sequence after the base retrieve, each receiving the prior reranker's hits.
 *
 * @module
 */

import type { RerankerInput, RetrieverHit, RetrieverReranker } from './types'

/**
 * Define a reranker.
 *
 * @param config.name - Non-empty reranker name.
 * @param config.rerank - Reorders the input hits.
 * @returns A frozen {@link RetrieverReranker}.
 */
export function reranker(config: {
  name: string
  rerank(input: RerankerInput): Promise<RetrieverHit[]> | RetrieverHit[]
}): RetrieverReranker {
  if (!config.name.trim()) {
    throw new Error('Reranker name must be non-empty.')
  }

  return Object.freeze({
    _tag: 'Reranker' as const,
    name: config.name,
    rerank: config.rerank,
  })
}

/** Normalize a reranker or reranker array into an array. */
export function normalizeRerankers(rerank?: RetrieverReranker | RetrieverReranker[]): RetrieverReranker[] {
  if (!rerank) return []
  return Array.isArray(rerank) ? rerank : [rerank]
}

/** Apply rerankers in sequence, threading hits through each. */
export async function applyRerankers(rerankers: RetrieverReranker[], input: RerankerInput): Promise<RetrieverHit[]> {
  let hits = input.hits
  for (const reranker of rerankers) {
    hits = await reranker.rerank({ ...input, hits })
  }
  return hits
}
