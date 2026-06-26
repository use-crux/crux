/**
 * Provider-specific extensions for the AI SDK runtime.
 *
 * These capabilities sit beside generation on `aiSdkProviderRuntime.create()`
 * and keep non-generation AI SDK calls behind the same scripted gateway seam.
 *
 * @module
 */

import type { EmbeddingModel, RerankingModel } from 'ai'
import { embedding as coreEmbedding, type DenseEmbedding } from '@use-crux/core/embedding'
import { reranker as coreReranker, type RetrieverHit, type RetrieverReranker } from '@use-crux/core/retrieval'
import type { SdkGateway } from './gateway'

export interface AIRerankerConfig {
  name: string
  model: RerankingModel
  topN?: number
  maxRetries?: number
  document?: (hit: RetrieverHit) => string
}

export interface AIEmbeddingConfig {
  name: string
  model: EmbeddingModel
  dimensions: number
  maxInputTokens: number
  batch?: {
    maxSize?: number
    concurrency?: number
  }
  maxRetries?: number
  maxParallelCalls?: number
  headers?: Record<string, string>
  providerOptions?: Record<string, unknown>
}

/** Extensions attached to a bound `aiSdkProviderRuntime`. */
export interface AiSdkRuntimeExtensions {
  /** Create a dense Crux embedding backed by AI SDK `embedMany()`. */
  embedding(config: AIEmbeddingConfig): DenseEmbedding
  /** Create a Crux retriever reranker backed by AI SDK `rerank()`. */
  reranker(config: AIRerankerConfig): RetrieverReranker
}

/** Bind AI SDK non-generation capabilities to a scripted or live gateway. */
export function createAiSdkRuntimeExtensions(gateway: SdkGateway): AiSdkRuntimeExtensions {
  return Object.freeze({
    embedding(config: AIEmbeddingConfig) {
      return coreEmbedding({
        kind: 'dense',
        name: config.name,
        dimensions: config.dimensions,
        maxInputTokens: config.maxInputTokens,
        batch: {
          maxSize: config.batch?.maxSize ?? 100,
          concurrency: config.batch?.concurrency ?? 1,
        },
        async embed(texts) {
          const result = await gateway.embedMany({
            model: config.model,
            values: texts,
            maxRetries: config.maxRetries,
            maxParallelCalls: config.maxParallelCalls ?? 1,
            headers: config.headers,
            providerOptions: config.providerOptions as Parameters<SdkGateway['embedMany']>[0]['providerOptions'],
          })

          return {
            embeddings: result.embeddings.map((embedding) => [...embedding]),
            usage: {
              inputTokens: result.usage.tokens,
              totalTokens: result.usage.tokens,
            },
          }
        },
      })
    },
    reranker(config: AIRerankerConfig) {
      return coreReranker({
        name: config.name,
        async rerank({ query, hits }) {
          if (hits.length === 0) return hits

          const result = await gateway.rerank({
            model: config.model,
            query,
            documents: hits.map((hit) => (config.document ? config.document(hit) : hit.content)),
            topN: config.topN,
            maxRetries: config.maxRetries,
          })

          return result.ranking.map(({ originalIndex, score }) => ({
            ...hits[originalIndex],
            score,
          }))
        },
      })
    },
  })
}
