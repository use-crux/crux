/**
 * The governed embedding execution pipeline.
 *
 * {@link runEmbeddingOperation} wraps an operation in an `embedding.call` span,
 * emits start/end hooks + the output artifact, and delegates to
 * {@link executeGovernedEmbedding}, which preprocesses/truncates inputs and either
 * calls the executor directly or routes through the embedding cache. Internal.
 *
 * @module
 */

import { observe } from '../observability'
import { markErrorForObservation } from '../observability/error-projection'
import { getHooks } from '../runtime/runtime'
import { executeWithEmbeddingCache } from './execute-cache'
import { combineGovernance, eventGovernance } from './metrics'
import { emitEmbeddingOutputArtifact } from './observability'
import { applyPreprocessors, applyTruncation } from './preprocess'
import type { NormalizedEmbeddingInput } from './modality'
import { embeddingSpaceDigest } from './space'
import type {
  BatchExecutionResult,
  CacheCodec,
  EmbeddingGovernanceMetrics,
  NormalizedGovernance,
} from './types'

let embeddingOperationCounter = 0

/** Run an embed/embedMany operation under a span, emitting hooks + artifact. */
export async function runEmbeddingOperation<T>(args: {
  name: string
  kind: 'dense' | 'sparse'
  operation: 'embed' | 'embedMany'
  inputs: readonly NormalizedEmbeddingInput[]
  role: 'query' | 'document'
  batch: Readonly<{ maxSize: number; concurrency: number }>
  governance: NormalizedGovernance
  cacheCodec: CacheCodec<T>
  execute: (inputs: readonly NormalizedEmbeddingInput[]) => Promise<BatchExecutionResult<T>>
  dimensions?: number
}): Promise<BatchExecutionResult<T>> {
  const startedAt = Date.now()
  const embedId = `${startedAt}-embed-${++embeddingOperationCounter}`
  const modalityCounts = inputModalityCounts(args.inputs)
  const embeddingSpace = args.kind === 'dense'
    ? embeddingSpaceDigest(args.governance.fingerprint)
    : undefined
  const eventBase = {
    embedId,
    name: args.name,
    kind: args.kind,
    operation: args.operation,
    inputCount: args.inputs.length,
    chunkCount: args.inputs.length === 0 ? 0 : Math.ceil(args.inputs.length / args.batch.maxSize),
    maxChunkSize: args.inputs.length === 0 ? 0 : Math.min(args.batch.maxSize, args.inputs.length),
    ...(args.dimensions !== undefined ? { dimensions: args.dimensions } : {}),
  }
  const span = observe.openSpan({
    name: `${args.name}.${args.operation}`,
    primitive: 'embedding.call',
    attributes: {
      embedId,
      embeddingName: args.name,
      embeddingKind: args.kind,
      operation: args.operation,
      role: args.role,
      modalityCounts,
      ...(embeddingSpace ? { embeddingSpace } : {}),
      inputCount: args.inputs.length,
      chunkCount: eventBase.chunkCount,
      maxChunkSize: eventBase.maxChunkSize,
      batchConcurrency: args.batch.concurrency,
      maxInputTokens: args.governance.maxInputTokens,
      preprocessorCount: args.governance.preprocessors.length,
      truncateStrategy: args.governance.truncate.strategy ?? 'fail',
      cacheEnabled: Boolean(args.governance.cache),
      ...(args.governance.cache ? { cacheNamespace: args.governance.cache.namespace } : {}),
      ...(args.dimensions !== undefined ? { dimensions: args.dimensions } : {}),
    },
  })


  try {
    const result = await span.withContext(async () => {
      const executionResult = await executeGovernedEmbedding(args)
      emitEmbeddingOutputArtifact(span.spanId, {
        ...args,
        modalityCounts,
        ...(embeddingSpace ? { embeddingSpace } : {}),
      }, executionResult)
      return executionResult
    })
    span.end({
      attributes: {
        embeddingName: args.name,
        embeddingKind: args.kind,
        operation: args.operation,
        role: args.role,
        modalityCounts,
        ...(embeddingSpace ? { embeddingSpace } : {}),
        inputCount: args.inputs.length,
        outputCount: result.embeddings.length,
        durationMs: Date.now() - startedAt,
        ...(result.usage?.inputTokens !== undefined ? { inputTokens: result.usage.inputTokens } : {}),
        ...(result.usage?.totalTokens !== undefined ? { totalTokens: result.usage.totalTokens } : {}),
        ...(result.cost !== undefined ? { cost: result.cost } : {}),
        ...eventGovernance(result.governance),
      },
    })
    return result
  } catch (error) {
    span.error(error, {
      embeddingName: args.name,
      embeddingKind: args.kind,
      operation: args.operation,
      role: args.role,
      modalityCounts,
      ...(embeddingSpace ? { embeddingSpace } : {}),
      inputCount: args.inputs.length,
      durationMs: Date.now() - startedAt,
    })
    throw error
  }
}

function inputModalityCounts(inputs: readonly NormalizedEmbeddingInput[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const input of inputs) counts[input.type] = (counts[input.type] ?? 0) + 1
  return counts
}

/** Preprocess + truncate inputs, then execute directly or via the cache. */
async function executeGovernedEmbedding<T>(args: {
  name: string
  kind: 'dense' | 'sparse'
  dimensions?: number
  inputs: readonly NormalizedEmbeddingInput[]
  role: 'query' | 'document'
  governance: NormalizedGovernance
  cacheCodec: CacheCodec<T>
  execute: (inputs: readonly NormalizedEmbeddingInput[]) => Promise<BatchExecutionResult<T>>
}): Promise<BatchExecutionResult<T>> {
  const metrics: EmbeddingGovernanceMetrics = {}
  const processedInputs = new Array<NormalizedEmbeddingInput>(args.inputs.length)

  for (let index = 0; index < args.inputs.length; index++) {
    const input = args.inputs[index]
    if (input.type !== 'text') {
      processedInputs[index] = input
      continue
    }
    const preprocessed = await applyPreprocessors(input.text, args.governance.preprocessors)
    const text = applyTruncation(preprocessed, args.governance, metrics)
    processedInputs[index] = { type: 'text', text }
  }

  const execute = async (inputs: readonly NormalizedEmbeddingInput[]) => {
    try {
      return await args.execute(inputs)
    } catch (error) {
      if (inputs.some((input) => input.type !== 'text')) {
        markErrorForObservation(error, 'Embedding provider call failed for media input.')
      }
      throw error
    }
  }

  if (!args.governance.cache) {
    const result = await execute(processedInputs)
    return {
      ...result,
      governance: combineGovernance([metrics, result.governance]),
    }
  }

  return executeWithEmbeddingCache({
    ...args,
    inputs: processedInputs,
    execute,
    metrics,
  })
}
