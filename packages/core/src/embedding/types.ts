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

import type { JsonObject, RecordStore, SparseVector } from '../storage'
import type {
  EmbeddingInput,
  EmbeddingModality,
  NormalizedEmbeddingInput,
} from './modality'
import type { EmbeddingSpace } from './space'

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
  /**
   * Stable identity for vector-producing semantics.
   *
   * Covers configuration that can change vector values for identical input:
   * kind, name, dimensions, modalities, normalization, query/document tasks,
   * max input tokens, preprocessors, truncation, and declared `version`. It
   * excludes operational policy (batching, retry, rate limits, caching).
   * Always present on instances created by
   * {@link embedding}; optional so structurally-typed embeddings remain valid.
   * Embeddings without a fingerprint are computed on every indexing run —
   * the pipeline embedding-stage cache never guesses an identity.
   */
  readonly fingerprint?: string
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

/** Provider-independent dense embedding function. */
export type EmbedFn = (text: string) => Promise<number[]>

/** Options applied to one dense embedding operation. */
export interface EmbedOptions {
  /**
   * Retrieval role for providers that encode queries and documents differently.
   *
   * Both roles belong to one vector space. The indexing and retrieval
   * pipelines set this value; application callers normally leave it unset.
   * @defaultValue `'document'`
   */
  readonly role?: 'query' | 'document'
}

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
export interface DenseEmbedding<TModality extends EmbeddingModality = EmbeddingModality>
  extends EmbeddingBase {
  readonly kind: 'dense'
  readonly dimensions: number
  readonly modalities: readonly TModality[]
  readonly space: EmbeddingSpace
  embed(input: EmbeddingInput<TModality>, options?: EmbedOptions): Promise<number[]>
  embedMany(inputs: readonly EmbeddingInput<TModality>[], options?: EmbedOptions): Promise<number[][]>
  asEmbedFn(): EmbedFn
}

/** A sparse (index/value) embedding instance. */
export interface SparseEmbedding extends EmbeddingBase {
  readonly kind: 'sparse'
  readonly modalities: readonly ['text']
  embed(text: string): Promise<SparseVector>
  embedMany(texts: readonly string[]): Promise<SparseVector[]>
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
  /**
   * Model revision for cache invalidation.
   *
   * Bump when the provider changes vector output for identical input without
   * changing the embedding `name`.
   */
  version?: string
}

/** Config for a dense {@link embedding}. Internal. */
export interface DenseEmbeddingConfig<TModality extends EmbeddingModality = 'text'>
  extends EmbeddingGovernanceConfig {
  kind: 'dense'
  name: string
  dimensions: number
  maxInputTokens: number
  /** Modalities this model natively encodes. @defaultValue `['text']` */
  modalities?: readonly TModality[]
  /** Whether provider vectors are unit-normalized. @defaultValue `'unknown'` */
  normalization?: 'unit' | 'none' | 'unknown'
  /** Provider task identifiers for query/document role asymmetry. */
  tasks?: { readonly query?: string; readonly document?: string }
  batch: {
    maxSize: number
    concurrency?: number
  }
  /** Run one provider batch with validated, normalized inputs. */
  embed(
    inputs: readonly NormalizedEmbeddingInput[],
    context: { readonly role: 'query' | 'document' },
  ): Promise<DenseBatchResult>
}

/** Config for a sparse {@link embedding}. Internal. */
export interface SparseEmbeddingConfig extends EmbeddingGovernanceConfig {
  kind: 'sparse'
  name: string
  maxInputTokens: number
  /** Sparse embeddings accept text only. @defaultValue `['text']` */
  modalities?: readonly EmbeddingModality[]
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
  modalities: readonly EmbeddingModality[]
  normalization?: 'unit' | 'none' | 'unknown'
  tasks?: { readonly query?: string; readonly document?: string }
}

/** A concurrency limiter for provider batch calls. Internal. */
export interface RateLimiter {
  run<T>(fn: () => Promise<T>, onWait: (durationMs: number) => void): Promise<T>
}
