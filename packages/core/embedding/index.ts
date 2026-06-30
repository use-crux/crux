/**
 * Embeddings — `@use-crux/core/embedding`.
 *
 * Author dense or sparse embeddings with {@link embedding}, add text
 * normalization via {@link embeddingPreprocessor} / {@link normalizeText}, and
 * cache vectors with {@link embeddingCache}. Embeddings carry governance
 * (preprocess, truncate, retry, rate limit, cache) and emit observability.
 *
 * @module
 */

export type {
  EmbeddingUsage,
  EmbeddingGovernanceMetrics,
  DenseBatchResult,
  SparseBatchResult,
  EmbeddingPreprocessor,
  NormalizeTextOptions,
  EmbeddingPreprocessorConfig,
  EmbeddingPreprocessConfig,
  EmbedFn,
  EmbeddingTruncatePolicy,
  EmbeddingRetryPolicy,
  EmbeddingRateLimitPolicy,
  EmbeddingCache,
  EmbeddingCacheOptions,
  DenseEmbedding,
  SparseEmbedding,
  CruxEmbedding,
} from './types'

export { embedding } from './define-embedding'
export { embeddingPreprocessor, normalizeText } from './preprocess'
export { embeddingCache } from './cache'
