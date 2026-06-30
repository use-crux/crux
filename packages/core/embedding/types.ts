/**
 * Type contracts for the embedding domain.
 *
 * Public surface: usage/governance metrics, batch result shapes, preprocessor
 * and governance policy types (truncate/retry/rate-limit/cache), and the
 * {@link DenseEmbedding} / {@link SparseEmbedding} / {@link CruxEmbedding}
 * instance contracts. The remaining types (config inputs, normalized
 * governance, batch execution result, cache codec, rate limiter) are internal.
 *
 * @module
 */

import type { EmbedFn } from '../store/types'
import type { JsonObject, RecordStore, SparseVector } from '../storage'

/** Token usage reported by an embedding provider. */
export interface EmbeddingUsage {
  inputTokens?: number
  totalTokens?: number
}

/** Governance counters accumulated across an embedding operation. */
export interface EmbeddingGovernanceMetrics {
  cacheHitCount?: number
  cacheMissCount?: number
  retryCount?: number
  truncatedCount?: number
  rateLimitWaitMs?: number
}

/** A provider dense-batch result: bare vectors or vectors plus usage/cost. */
export type DenseBatchResult =
  | number[][]
  | {
      embeddings: number[][]
      usage?: EmbeddingUsage
      cost?: number
    }

/** A provider sparse-batch result: bare vectors or vectors plus usage/cost. */
export type SparseBatchResult =
  | SparseVector[]
  | {
      embeddings: SparseVector[]
      usage?: EmbeddingUsage
      cost?: number
    }

/** Fields shared by dense and sparse embedding instances. */
export interface EmbeddingBase {
  readonly _tag: 'Embedding'
  readonly name: string
  readonly maxInputTokens: number
  readonly batch: Readonly<{
    maxSize: number
    concurrency: number
  }>
}

/** A value that may be returned synchronously or as a promise. */
export type MaybePromise<T> = T | Promise<T>

/** A text preprocessor run before embedding. */
export interface EmbeddingPreprocessor {
  readonly _tag: 'EmbeddingPreprocessor'
  readonly id: string
  readonly fingerprint: string
  run(text: string): MaybePromise<string>
}

/** Options for the built-in {@link normalizeText} preprocessor. */
export interface NormalizeTextOptions {
  trim?: boolean
  collapseWhitespace?: boolean
  lowercase?: boolean
}

/** Config for {@link embeddingPreprocessor}. */
export interface EmbeddingPreprocessorConfig {
  id: string
  fingerprint?: string
  run(text: string): MaybePromise<string>
}

/** One or more preprocessors. */
export type EmbeddingPreprocessConfig = EmbeddingPreprocessor | readonly EmbeddingPreprocessor[]

/** Truncation policy: fail on overflow, or truncate to a character cap. */
export type EmbeddingTruncatePolicy = { strategy?: 'fail' } | { strategy: 'chars'; maxChars: number }

/** Retry policy for transient provider errors. */
export interface EmbeddingRetryPolicy {
  maxAttempts: number
  baseDelayMs?: number
  maxDelayMs?: number
  shouldRetry?: (error: unknown, attempt: number) => MaybePromise<boolean>
}

/** Concurrency-limit policy for provider calls. */
export interface EmbeddingRateLimitPolicy {
  concurrency: number
}

/** A namespaced embedding cache backed by a {@link RecordStore}. */
export interface EmbeddingCache {
  readonly _tag: 'EmbeddingCache'
  readonly namespace: string
  readonly ttlMs?: number
  get(key: string): Promise<JsonObject | null>
  set(key: string, value: JsonObject): Promise<void>
}

/** Options for {@link embeddingCache}. */
export interface EmbeddingCacheOptions {
  records: RecordStore
  namespace: string
  ttlMs?: number
}

/** A dense (float-vector) embedding instance. */
export interface DenseEmbedding extends EmbeddingBase {
  readonly kind: 'dense'
  readonly dimensions: number
  embed(text: string): Promise<number[]>
  embedMany(texts: string[]): Promise<number[][]>
  asEmbedFn(): EmbedFn
}

/** A sparse (index/value) embedding instance. */
export interface SparseEmbedding extends EmbeddingBase {
  readonly kind: 'sparse'
  embed(text: string): Promise<SparseVector>
  embedMany(texts: string[]): Promise<SparseVector[]>
}

/** A dense or sparse embedding instance. */
export type CruxEmbedding = DenseEmbedding | SparseEmbedding

/** The result of executing one batch of embeddings. Internal. */
export interface BatchExecutionResult<T> {
  embeddings: T[]
  usage?: EmbeddingUsage
  cost?: number
  governance?: EmbeddingGovernanceMetrics
}

/** Governance fields shared by dense/sparse embedding configs. Internal. */
export interface EmbeddingGovernanceConfig {
  preprocess?: EmbeddingPreprocessConfig
  truncate?: EmbeddingTruncatePolicy
  retry?: EmbeddingRetryPolicy
  cache?: EmbeddingCache
  rateLimit?: EmbeddingRateLimitPolicy
  countTokens?: (text: string) => number
}

/** Config for a dense {@link embedding}. Internal. */
export interface DenseEmbeddingConfig extends EmbeddingGovernanceConfig {
  kind: 'dense'
  name: string
  dimensions: number
  maxInputTokens: number
  batch: {
    maxSize: number
    concurrency?: number
  }
  embed(texts: string[]): Promise<DenseBatchResult>
}

/** Config for a sparse {@link embedding}. Internal. */
export interface SparseEmbeddingConfig extends EmbeddingGovernanceConfig {
  kind: 'sparse'
  name: string
  maxInputTokens: number
  batch: {
    maxSize: number
    concurrency?: number
  }
  embed(texts: string[]): Promise<SparseBatchResult>
}

/** Reads/writes a typed embedding to/from a cache {@link JsonObject}. Internal. */
export interface CacheCodec<T> {
  kind: 'dense' | 'sparse'
  read(entry: JsonObject | null): T | undefined
  write(embedding: T): JsonObject
}

/** Resolved governance settings used by the execution pipeline. Internal. */
export interface NormalizedGovernance {
  preprocessors: readonly EmbeddingPreprocessor[]
  truncate: EmbeddingTruncatePolicy
  retry?: EmbeddingRetryPolicy
  cache?: EmbeddingCache
  rateLimit?: EmbeddingRateLimitPolicy
  countTokens: (text: string) => number
  maxInputTokens: number
  fingerprint: string
}

/** A concurrency limiter for provider batch calls. Internal. */
export interface RateLimiter {
  run<T>(fn: () => Promise<T>, onWait: (durationMs: number) => void): Promise<T>
}
