/** Provider-neutral embedding configuration validation and normalization. */

import { stableStringify } from './hashing'
import { estimateTokens, normalizePreprocessors } from './preprocess'
import type { EmbeddingModality } from './modality'
import type {
  DenseEmbeddingConfig,
  NormalizedGovernance,
  SparseEmbeddingConfig,
} from './types'

type EmbeddingConfig = DenseEmbeddingConfig<EmbeddingModality> | SparseEmbeddingConfig

/** Resolved vector-semantic fields shared by the factory and execution path. */
export interface ResolvedEmbeddingConfig {
  readonly modalities: readonly EmbeddingModality[]
  readonly normalization?: 'unit' | 'none' | 'unknown'
  readonly tasks?: { readonly query?: string; readonly document?: string }
  readonly governance: NormalizedGovernance
}

/** Validate and resolve an embedding config before constructing an instance. */
export function resolveEmbeddingConfig(config: EmbeddingConfig): ResolvedEmbeddingConfig {
  validateConfig(config)

  const modalities = [...(config.modalities ?? ['text'])]
  const normalization = config.kind === 'dense' ? config.normalization ?? 'unknown' : undefined
  const tasks = config.kind === 'dense' && config.tasks !== undefined ? { ...config.tasks } : undefined
  const preprocessors = normalizePreprocessors(config.preprocess)
  const truncate = config.truncate ?? { strategy: 'fail' as const }
  const fingerprint = stableStringify({
    kind: config.kind,
    name: config.name,
    dimensions: config.kind === 'dense' ? config.dimensions : undefined,
    maxInputTokens: config.maxInputTokens,
    preprocessors: preprocessors.map((preprocessor) => preprocessor.fingerprint),
    truncate,
    version: config.version,
    modalities: [...modalities].sort(),
    normalization,
    tasks,
  })

  return {
    modalities,
    normalization,
    tasks,
    governance: {
      preprocessors,
      truncate,
      retry: config.retry,
      cache: config.cache,
      rateLimit: config.rateLimit,
      countTokens: config.countTokens ?? estimateTokens,
      maxInputTokens: config.maxInputTokens,
      fingerprint,
      modalities,
      normalization,
      tasks,
    },
  }
}

function validateConfig(config: EmbeddingConfig): void {
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
  validateModalities(config)
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

function validateModalities(config: EmbeddingConfig): void {
  const modalities: readonly string[] = config.modalities ?? ['text']
  if (modalities.length === 0) {
    throw new Error('Embedding modalities must contain at least one modality.')
  }
  const supported = new Set<EmbeddingModality>(['text', 'image', 'audio', 'video', 'document'])
  for (const modality of modalities) {
    if (!supported.has(modality as EmbeddingModality)) {
      throw new Error(`Embedding modality "${modality}" is not supported.`)
    }
  }
  if (new Set(modalities).size !== modalities.length) {
    throw new Error('Embedding modalities must not contain duplicates.')
  }
  if (config.kind === 'sparse' && (modalities.length !== 1 || modalities[0] !== 'text')) {
    throw new Error('Sparse embeddings support the text modality only.')
  }
}
