/** Public chunk/index operation wrappers with tracing and dry-run overloads. @module */

import { observe } from '../observability'
import { withOperationResultMeta } from '../observability/internal/result-meta'
import { resolveCacheMode } from './cache'
import type { ResolvedPipelineCache } from './cache'
import { collect, unique } from './collections'
import { emitIndexingOutputArtifact, runIndexOperation } from './observability'
import { normalizeChunk, validateChunks, validateDocuments } from './normalize'
import type { PreparePipelineOutput } from './pipeline-runner'
import type { WritePreparedChunks } from './index-writer'
import type {
  ChunkingOptions,
  CruxChunk,
  CruxDocument,
  IndexDryRunResult,
  Indexer,
  IndexResult,
  PipelineCacheMode,
} from './types'

/** Create the three input-processing operations exposed by an indexer. */
export function createIndexerOperations(args: {
  readonly indexerId: string
  readonly namespace: string
  readonly cache: ResolvedPipelineCache
  readonly preparePipeline: PreparePipelineOutput
  readonly writePrepared: WritePreparedChunks
}): Pick<Indexer, 'chunk' | 'indexDocuments' | 'indexChunks'> {
  async function chunk(
    documentsInput: AsyncIterable<CruxDocument> | CruxDocument[],
    options?: { chunking?: ChunkingOptions; cache?: PipelineCacheMode },
  ): Promise<CruxChunk[]> {
    const documents = await collect(documentsInput)
    const span = operationSpan('chunk', {
      sourceCount: unique(documents.map((document) => document.sourceId)).length,
      cacheMode: options?.cache ?? 'default',
    })
    try {
      const chunks = await span.withContext(async () => {
        validateDocuments(documents, args.namespace)
        const prepared = await args.preparePipeline(documents, options ?? {})
        emitIndexingOutputArtifact(span.spanId, {
          indexerId: args.indexerId,
          namespace: args.namespace,
          operation: 'chunk',
          sourceCount: unique(documents.map((document) => document.sourceId)).length,
          chunkCount: prepared.chunks.length,
          dryRun: true,
          stages: prepared.stages,
        })
        return prepared.chunks
      })
      span.end({ attributes: { chunkCount: chunks.length } })
      return chunks
    } catch (error) {
      span.error(error)
      throw error
    }
  }

  function indexDocuments(
    documents: AsyncIterable<CruxDocument> | CruxDocument[],
    options: { dryRun: true; replaceSources?: boolean; chunking?: ChunkingOptions; cache?: PipelineCacheMode },
  ): Promise<IndexDryRunResult>
  function indexDocuments(
    documents: AsyncIterable<CruxDocument> | CruxDocument[],
    options?: { dryRun?: false; replaceSources?: boolean; chunking?: ChunkingOptions; cache?: PipelineCacheMode },
  ): Promise<IndexResult>
  async function indexDocuments(
    documentsInput: AsyncIterable<CruxDocument> | CruxDocument[],
    options?: { dryRun?: boolean; replaceSources?: boolean; chunking?: ChunkingOptions; cache?: PipelineCacheMode },
  ): Promise<IndexResult | IndexDryRunResult> {
    const documents = await collect(documentsInput)
    const sourceCount = unique(documents.map((document) => document.sourceId)).length
    const span = operationSpan('indexDocuments', {
      sourceCount,
      replaceSources: options?.replaceSources ?? true,
      dryRun: options?.dryRun === true,
      cacheMode: options?.cache ?? 'default',
    })
    try {
      const result = await span.withContext(async () => {
        validateDocuments(documents, args.namespace)
        const prepared = await args.preparePipeline(documents, {
          chunking: options?.chunking,
          cache: options?.cache,
          dryRun: options?.dryRun === true,
        })
        return runObservedWrite('indexDocuments', sourceCount, prepared.chunks.length, prepared, {
          replaceSources: options?.replaceSources ?? true,
          dryRun: options?.dryRun === true,
          cacheMode: resolveCacheMode(args.cache, options?.cache),
        }, span)
      })
      return finishResult(span, result, options?.dryRun === true)
    } catch (error) {
      span.error(error)
      throw error
    }
  }

  function indexChunks(
    chunks: AsyncIterable<CruxChunk> | CruxChunk[],
    options: { dryRun: true; replaceSources?: boolean; cache?: PipelineCacheMode },
  ): Promise<IndexDryRunResult>
  function indexChunks(
    chunks: AsyncIterable<CruxChunk> | CruxChunk[],
    options?: { dryRun?: false; replaceSources?: boolean; cache?: PipelineCacheMode },
  ): Promise<IndexResult>
  async function indexChunks(
    chunksInput: AsyncIterable<CruxChunk> | CruxChunk[],
    options?: { dryRun?: boolean; replaceSources?: boolean; cache?: PipelineCacheMode },
  ): Promise<IndexResult | IndexDryRunResult> {
    const chunks = (await collect(chunksInput)).map((chunk) => normalizeChunk(chunk, args.namespace))
    const sourceCount = unique(chunks.map((chunk) => chunk.sourceId)).length
    const span = operationSpan('indexChunks', {
      sourceCount,
      chunkCount: chunks.length,
      replaceSources: options?.replaceSources ?? false,
      dryRun: options?.dryRun === true,
      cacheMode: options?.cache ?? 'default',
    })
    try {
      const result = await span.withContext(async () => {
        validateChunks(chunks, args.namespace)
        return runObservedWrite('indexChunks', sourceCount, chunks.length, { chunks, parents: [] }, {
          replaceSources: options?.replaceSources ?? false,
          dryRun: options?.dryRun === true,
          cacheMode: resolveCacheMode(args.cache, options?.cache),
        }, span)
      })
      return finishResult(span, result, options?.dryRun === true)
    } catch (error) {
      span.error(error)
      throw error
    }
  }

  function operationSpan(operation: string, attributes: Record<string, unknown>) {
    return observe.openSpan({
      name: `${args.indexerId}.${operation}`,
      primitive: 'indexing.pipeline',
      attributes: { indexerId: args.indexerId, namespace: args.namespace, operation, ...attributes },
    })
  }

  async function runObservedWrite(
    operation: 'indexDocuments' | 'indexChunks',
    sourceCount: number,
    chunkCount: number,
    prepared: Parameters<WritePreparedChunks>[0],
    options: Parameters<WritePreparedChunks>[1],
    span: ReturnType<typeof observe.openSpan>,
  ) {
    const result = await runIndexOperation({
      indexerId: args.indexerId,
      namespace: args.namespace,
      operation,
      sourceCount,
      chunkCount,
      replaceSources: options.replaceSources,
      dryRun: options.dryRun,
      instrument: false,
      run: () => args.writePrepared(prepared, options),
    })
    emitIndexingOutputArtifact(span.spanId, {
      indexerId: args.indexerId,
      namespace: args.namespace,
      operation,
      sourceCount,
      chunkCount: result.chunkCount,
      dryRun: options.dryRun,
      stages: result.stages,
    })
    return result
  }

  function finishResult(
    span: ReturnType<typeof observe.openSpan>,
    result: Awaited<ReturnType<WritePreparedChunks>>,
    dryRun: boolean,
  ) {
    const observed = withOperationResultMeta(result, { traceId: span.traceId, spanId: span.spanId })
    span.end({ attributes: { sourceCount: result.sourceCount, chunkCount: result.chunkCount, dryRun } })
    return observed
  }

  return { chunk, indexDocuments, indexChunks }
}
