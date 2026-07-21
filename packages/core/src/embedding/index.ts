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
  EmbedOptions,
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

export type {
  EmbeddingInput,
  EmbeddingInputByModality,
  EmbeddingModality,
  NormalizedEmbeddingInput,
} from './modality'
export type { NormalizeEmbeddingInputOptions } from './input'
export type { EmbeddingSpace } from './space'

export { embedding } from './define-embedding'
export { embeddingIdentity } from './identity'
export { embeddingPreprocessor, normalizeText } from './preprocess'
export { embeddingCache } from './cache'
export { normalizeEmbeddingInput } from './input'
export { inferModality } from './modality'
export { deriveEmbeddingSpace, embeddingSpaceDigest } from './space'
export { EmbeddingModalityError, EmbeddingSpaceMismatchError } from './errors'
export type { EmbeddingSpaceDescriptor } from './errors'
