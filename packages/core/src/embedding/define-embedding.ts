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

import type { SparseVector } from '../storage'
import { createBatchExecutor, createProviderBatchRunner } from './batch'
import { denseCacheCodec, sparseCacheCodec } from './cache'
import { resolveEmbeddingConfig } from './config'
import { runEmbeddingOperation } from './execute'
import { normalizeEmbeddingInput } from './input'
import { deriveEmbeddingSpace } from './space'
import type { EmbeddingModality, NormalizedEmbeddingInput } from './modality'
import type {
  BatchExecutionResult,
  CruxEmbedding,
  DenseBatchResult,
  DenseEmbedding,
  DenseEmbeddingConfig,
  SparseBatchResult,
  SparseEmbedding,
  SparseEmbeddingConfig,
} from './types'

/**
 * Author a dense or sparse embedding from a provider batch function.
 *
 * @param config - Dense or sparse embedding config (name, batch, governance, `embed`).
 * @returns A frozen {@link DenseEmbedding} or {@link SparseEmbedding} instance.
 * @throws {@link EmbeddingModalityError} when a dense embedding receives an undeclared modality.
 *
 * @example
 * ```ts
 * const dense = embedding({
 *   kind: 'dense',
 *   name: 'native-multimodal',
 *   dimensions: 1408,
 *   maxInputTokens: 8192,
 *   modalities: ['text', 'image'],
 *   batch: { maxSize: 96 },
 *   embed: async (inputs, { role }) => callProvider(inputs, role),
 * })
 * const vector = await dense.embed({ type: 'image', source: imageBytes, mediaType: 'image/png' })
 * ```
 */
export function embedding<
  const TModality extends EmbeddingModality = 'text',
>(config: DenseEmbeddingConfig<TModality>): DenseEmbedding<TModality>
export function embedding(config: SparseEmbeddingConfig): SparseEmbedding
export function embedding(
  config: DenseEmbeddingConfig<EmbeddingModality> | SparseEmbeddingConfig,
): CruxEmbedding {
  const resolved = resolveEmbeddingConfig(config)

  const batch = Object.freeze({
    maxSize: config.batch.maxSize,
    concurrency: config.batch.concurrency ?? 1,
  })
  const modalities = Object.freeze([...resolved.modalities])
  const governance = resolved.governance

  if (config.kind === 'dense') {
    const execute = createBatchExecutor<NormalizedEmbeddingInput, number[], EmbedContext>(
      batch,
      createProviderBatchRunner(governance, async (inputs, context: EmbedContext) =>
        normalizeDenseResult(await config.embed(inputs, context))),
    )
    const normalizeOptions = { embeddingName: config.name, supported: modalities }
    const embedMany: DenseEmbedding['embedMany'] = async (inputs, options) => {
      const normalized = await Promise.all(
        inputs.map((input) => normalizeEmbeddingInput(input, normalizeOptions)),
      )
      const role = options?.role ?? 'document'
      return (
        await runEmbeddingOperation({
          name: config.name,
          kind: config.kind,
          operation: 'embedMany',
          dimensions: config.dimensions,
          inputs: normalized,
          role,
          batch,
          governance,
          cacheCodec: denseCacheCodec,
          execute: (batchInputs) => execute(batchInputs, { role }),
        })
      ).embeddings
    }
    const embed: DenseEmbedding['embed'] = async (input, options) => {
      const role = options?.role ?? 'document'
      const normalized = await normalizeEmbeddingInput(input, normalizeOptions)
      return (
        await runEmbeddingOperation({
          name: config.name,
          kind: config.kind,
          operation: 'embed',
          dimensions: config.dimensions,
          inputs: [normalized],
          role,
          batch,
          governance,
          cacheCodec: denseCacheCodec,
          execute: (batchInputs) => execute(batchInputs, { role }),
        })
      ).embeddings[0]
    }
    const space = Object.freeze(deriveEmbeddingSpace({
      name: config.name,
      version: config.version,
      dimensions: config.dimensions,
      modalities,
      normalization: resolved.normalization ?? 'unknown',
      tasks: resolved.tasks,
    }, governance.fingerprint))

    return Object.freeze({
      _tag: 'Embedding' as const,
      kind: 'dense' as const,
      name: config.name,
      dimensions: config.dimensions,
      modalities,
      space,
      maxInputTokens: config.maxInputTokens,
      batch,
      fingerprint: governance.fingerprint,
      embed,
      embedMany,
      asEmbedFn: () => embed,
    })
  }

  const execute = createBatchExecutor<NormalizedEmbeddingInput, SparseVector, EmbedContext>(
    batch,
    createProviderBatchRunner(governance, async (inputs) =>
      normalizeSparseResult(await config.embed(inputs.map(textFromNormalizedInput)))),
  )
  const embedMany: SparseEmbedding['embedMany'] = async (texts) =>
    (
      await runEmbeddingOperation({
        name: config.name,
        kind: config.kind,
        operation: 'embedMany',
        inputs: texts.map((text) => ({ type: 'text', text })),
        role: 'document',
        batch,
        governance,
        cacheCodec: sparseCacheCodec,
        execute: (inputs) => execute(inputs, { role: 'document' }),
      })
    ).embeddings
  const embed: SparseEmbedding['embed'] = async (text) =>
    (
      await runEmbeddingOperation({
        name: config.name,
        kind: config.kind,
        operation: 'embed',
        inputs: [{ type: 'text', text }],
        role: 'document',
        batch,
        governance,
        cacheCodec: sparseCacheCodec,
        execute: (inputs) => execute(inputs, { role: 'document' }),
      })
    ).embeddings[0]

  return Object.freeze({
    _tag: 'Embedding' as const,
    kind: 'sparse' as const,
    name: config.name,
    modalities: Object.freeze(['text'] as const),
    maxInputTokens: config.maxInputTokens,
    batch,
    fingerprint: governance.fingerprint,
    embed,
    embedMany,
  })
}

/** Normalize a dense provider result into a {@link BatchExecutionResult}. */
function normalizeDenseResult(result: DenseBatchResult): BatchExecutionResult<number[]> {
  return Array.isArray(result) ? { embeddings: result } : result
}

/** Normalize a sparse provider result into a {@link BatchExecutionResult}. */
function normalizeSparseResult(result: SparseBatchResult): BatchExecutionResult<SparseVector> {
  return Array.isArray(result) ? { embeddings: result } : result
}

type EmbedContext = { readonly role: 'query' | 'document' }

function textFromNormalizedInput(input: NormalizedEmbeddingInput): string {
  if (input.type !== 'text') {
    throw new Error('Sparse embedding execution received a non-text input.')
  }
  return input.text
}
