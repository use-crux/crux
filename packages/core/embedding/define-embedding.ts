/**
 * `embedding()` — author a dense or sparse embedding instance.
 *
 * Validates the config, normalizes governance (preprocessors, truncation,
 * retry, rate limit, cache, token counter + fingerprint), and wires the
 * provider batch call through the rate-limited/retrying batch executor and the
 * governed, cache-aware execution pipeline.
 *
 * @module
 */

import type { SparseVector } from '../store/types'
import { createBatchExecutor, createProviderBatchRunner } from './batch'
import { denseCacheCodec, sparseCacheCodec } from './cache'
import { runEmbeddingOperation } from './execute'
import { stableStringify } from './hashing'
import { estimateTokens, normalizePreprocessors } from './preprocess'
import type {
  BatchExecutionResult,
  CruxEmbedding,
  DenseBatchResult,
  DenseEmbedding,
  DenseEmbeddingConfig,
  NormalizedGovernance,
  SparseBatchResult,
  SparseEmbedding,
  SparseEmbeddingConfig,
} from './types'

/**
 * Author a dense or sparse embedding from a provider batch function.
 *
 * @param config - Dense or sparse embedding config (name, batch, governance, `embed`).
 * @returns A frozen {@link DenseEmbedding} or {@link SparseEmbedding} instance.
 *
 * @example
 * ```ts
 * const dense = embedding({
 *   kind: 'dense',
 *   name: 'text-embedding-3-small',
 *   dimensions: 1536,
 *   maxInputTokens: 8192,
 *   batch: { maxSize: 96 },
 *   embed: async (texts) => callProvider(texts),
 * })
 * const vector = await dense.embed('hello')
 * ```
 */
export function embedding(config: DenseEmbeddingConfig): DenseEmbedding
export function embedding(config: SparseEmbeddingConfig): SparseEmbedding
export function embedding(config: DenseEmbeddingConfig | SparseEmbeddingConfig): CruxEmbedding {
  validateConfig(config)

  const batch = Object.freeze({
    maxSize: config.batch.maxSize,
    concurrency: config.batch.concurrency ?? 1,
  })
  const governance = normalizeGovernance(config)

  if (config.kind === 'dense') {
    const execute = createBatchExecutor<number[]>(
      batch,
      createProviderBatchRunner(governance, async (texts) => normalizeDenseResult(await config.embed(texts))),
    )
    const embedMany: DenseEmbedding['embedMany'] = async (texts) =>
      (
        await runEmbeddingOperation({
          name: config.name,
          kind: config.kind,
          operation: 'embedMany',
          dimensions: config.dimensions,
          texts,
          batch,
          governance,
          cacheCodec: denseCacheCodec,
          execute,
        })
      ).embeddings
    const embed: DenseEmbedding['embed'] = async (text) =>
      (
        await runEmbeddingOperation({
          name: config.name,
          kind: config.kind,
          operation: 'embed',
          dimensions: config.dimensions,
          texts: [text],
          batch,
          governance,
          cacheCodec: denseCacheCodec,
          execute,
        })
      ).embeddings[0]

    return Object.freeze({
      _tag: 'Embedding' as const,
      kind: 'dense' as const,
      name: config.name,
      dimensions: config.dimensions,
      maxInputTokens: config.maxInputTokens,
      batch,
      embed,
      embedMany,
      asEmbedFn: () => embed,
    })
  }

  const execute = createBatchExecutor<SparseVector>(
    batch,
    createProviderBatchRunner(governance, async (texts) => normalizeSparseResult(await config.embed(texts))),
  )
  const embedMany: SparseEmbedding['embedMany'] = async (texts) =>
    (
      await runEmbeddingOperation({
        name: config.name,
        kind: config.kind,
        operation: 'embedMany',
        texts,
        batch,
        governance,
        cacheCodec: sparseCacheCodec,
        execute,
      })
    ).embeddings
  const embed: SparseEmbedding['embed'] = async (text) =>
    (
      await runEmbeddingOperation({
        name: config.name,
        kind: config.kind,
        operation: 'embed',
        texts: [text],
        batch,
        governance,
        cacheCodec: sparseCacheCodec,
        execute,
      })
    ).embeddings[0]

  return Object.freeze({
    _tag: 'Embedding' as const,
    kind: 'sparse' as const,
    name: config.name,
    maxInputTokens: config.maxInputTokens,
    batch,
    embed,
    embedMany,
  })
}

/** Validate embedding config invariants (name, token/batch/dimension bounds, policies). */
function validateConfig(config: DenseEmbeddingConfig | SparseEmbeddingConfig): void {
  if (!config.name.trim()) {
    throw new Error('Embedding name must be non-empty.')
  }
  if (!Number.isFinite(config.maxInputTokens) || config.maxInputTokens <= 0) {
    throw new Error('Embedding maxInputTokens must be greater than 0.')
  }
  if (!Number.isInteger(config.batch.maxSize) || config.batch.maxSize <= 0) {
    throw new Error('Embedding batch.maxSize must be a positive integer.')
  }
  if (
    config.batch.concurrency !== undefined &&
    (!Number.isInteger(config.batch.concurrency) || config.batch.concurrency <= 0)
  ) {
    throw new Error('Embedding batch.concurrency must be a positive integer.')
  }
  if (config.kind === 'dense' && (!Number.isInteger(config.dimensions) || config.dimensions <= 0)) {
    throw new Error('Dense embedding dimensions must be a positive integer.')
  }
  if (
    config.truncate?.strategy === 'chars' &&
    (!Number.isInteger(config.truncate.maxChars) || config.truncate.maxChars <= 0)
  ) {
    throw new Error('Embedding truncate.maxChars must be a positive integer.')
  }
  if (config.retry !== undefined) {
    if (!Number.isInteger(config.retry.maxAttempts) || config.retry.maxAttempts <= 0) {
      throw new Error('Embedding retry.maxAttempts must be a positive integer.')
    }
    if (
      config.retry.baseDelayMs !== undefined &&
      (!Number.isFinite(config.retry.baseDelayMs) || config.retry.baseDelayMs < 0)
    ) {
      throw new Error('Embedding retry.baseDelayMs must be greater than or equal to 0.')
    }
    if (
      config.retry.maxDelayMs !== undefined &&
      (!Number.isFinite(config.retry.maxDelayMs) || config.retry.maxDelayMs < 0)
    ) {
      throw new Error('Embedding retry.maxDelayMs must be greater than or equal to 0.')
    }
  }
  if (
    config.rateLimit !== undefined &&
    (!Number.isInteger(config.rateLimit.concurrency) || config.rateLimit.concurrency <= 0)
  ) {
    throw new Error('Embedding rateLimit.concurrency must be a positive integer.')
  }
}

/** Normalize a dense provider result into a {@link BatchExecutionResult}. */
function normalizeDenseResult(result: DenseBatchResult): BatchExecutionResult<number[]> {
  return Array.isArray(result) ? { embeddings: result } : result
}

/** Normalize a sparse provider result into a {@link BatchExecutionResult}. */
function normalizeSparseResult(result: SparseBatchResult): BatchExecutionResult<SparseVector> {
  return Array.isArray(result) ? { embeddings: result } : result
}

/** Resolve config governance fields into {@link NormalizedGovernance} with a fingerprint. */
function normalizeGovernance(config: DenseEmbeddingConfig | SparseEmbeddingConfig): NormalizedGovernance {
  const preprocessors = normalizePreprocessors(config.preprocess)
  const truncate = config.truncate ?? { strategy: 'fail' as const }
  const countTokens = config.countTokens ?? estimateTokens
  const fingerprint = stableStringify({
    kind: config.kind,
    name: config.name,
    dimensions: config.kind === 'dense' ? config.dimensions : undefined,
    maxInputTokens: config.maxInputTokens,
    preprocessors: preprocessors.map((preprocessor) => preprocessor.fingerprint),
    truncate,
  })

  return {
    preprocessors,
    truncate,
    retry: config.retry,
    cache: config.cache,
    rateLimit: config.rateLimit,
    countTokens,
    maxInputTokens: config.maxInputTokens,
    fingerprint,
  }
}
