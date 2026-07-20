/**
 * The {@link indexer} factory.
 *
 * Builds an {@link Indexer} that runs documents through the indexing pipeline
 * (document transforms → chunker → chunk transforms, each cache-aware), embeds
 * chunks, and persists chunk/parent records to the data + vector stores with
 * generation-based source replacement.
 *
 * @module
 */

import { normalizePipelineCache, resolveCacheMode, runCachedStage } from './cache'
import { collect, unique } from './collections'
import { normalizeChunkingOptions } from './chunking-options'
import { runEmbeddingStage } from './embedding-stage'
import { stableHash } from './hash'
import {
  emitIndexingOutputArtifact,
  runIndexOperation,
} from './observability'
import { normalizeChunk, normalizeParentChunk, validateChunks, validateDocuments } from './normalize'
import { applyParentProvenanceConfidence, applyProvenanceConfidence } from './provenance'
import { sourceFactsWithLocations } from './source-facts'
import { indexingPipeline, stageFingerprint } from './pipeline'
import { embeddingIdentity } from '../embedding'
import { createIndexedKnowledgeStore } from '../indexed-knowledge'
import { observe } from '../observability'
import { withOperationResultMeta } from '../observability/internal/result-meta'
import type { RecordStore, SparseVector } from '../storage'
import type {
  ChunkingOptions,
  ChunkingResult,
  ChunkProvenance,
  CruxChunk,
  CruxDocument,
  CruxParentChunk,
  IndexDryRunResult,
  IndexFingerprintOptions,
  Indexer,
  IndexerConfig,
  IndexResult,
  PipelineCacheMode,
  SourceStageRecord,
} from './types'

type IndexResultPayload = Omit<IndexResult, '_meta'>
type IndexDryRunResultPayload = Omit<IndexDryRunResult, '_meta'>
type IndexOperationPayload = IndexResultPayload | IndexDryRunResultPayload

/**
 * Create an {@link Indexer} for a namespace.
 *
 * @example
 * ```ts
 * const index = indexer({ id: 'docs', namespace: 'docs', store, dense })
 * await index.indexDocuments(documents)
 * ```
 */
export function indexer(config: IndexerConfig): Indexer {
  validateConfig(config)

  const pipeline = config.pipeline ?? indexingPipeline()
  const recordStore = getIndexerRecordStore(config)
  const vectorStore = config.vectors ?? config.storage?.vectors
  const records = createIndexedKnowledgeStore({
    indexerId: config.id,
    namespace: config.namespace,
    records: recordStore,
    vectors: vectorStore,
  })
  const cacheConfig = normalizePipelineCache(config.cache, recordStore, config.id)

  async function chunk(
    documentsInput: AsyncIterable<CruxDocument> | CruxDocument[],
    options?: { chunking?: ChunkingOptions; cache?: PipelineCacheMode },
  ): Promise<CruxChunk[]> {
    const documents = await collect(documentsInput)
    const span = observe.openSpan({
      name: `${config.id}.chunk`,
      primitive: 'indexing.pipeline',
      attributes: {
        indexerId: config.id,
        namespace: config.namespace,
        operation: 'chunk',
        sourceCount: unique(documents.map((document) => document.sourceId)).length,
        cacheMode: options?.cache ?? 'default',
      },
    })
    try {
      const chunks = await span.withContext(async () => {
        validateDocuments(documents, config.namespace)
        const prepared = await preparePipelineOutput(documents, {
          chunking: options?.chunking,
          cache: options?.cache,
        })
        emitIndexingOutputArtifact(span.spanId, {
          indexerId: config.id,
          namespace: config.namespace,
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
    documentsInput: AsyncIterable<CruxDocument> | CruxDocument[],
    options: { dryRun: true; replaceSources?: boolean; chunking?: ChunkingOptions; cache?: PipelineCacheMode },
  ): Promise<IndexDryRunResult>
  function indexDocuments(
    documentsInput: AsyncIterable<CruxDocument> | CruxDocument[],
    options?: { dryRun?: false; replaceSources?: boolean; chunking?: ChunkingOptions; cache?: PipelineCacheMode },
  ): Promise<IndexResult>
  async function indexDocuments(
    documentsInput: AsyncIterable<CruxDocument> | CruxDocument[],
    options?: { dryRun?: boolean; replaceSources?: boolean; chunking?: ChunkingOptions; cache?: PipelineCacheMode },
  ): Promise<IndexResult | IndexDryRunResult> {
    const documents = await collect(documentsInput)
    const sourceCount = unique(documents.map((document) => document.sourceId)).length
    const span = observe.openSpan({
      name: `${config.id}.indexDocuments`,
      primitive: 'indexing.pipeline',
      attributes: {
        indexerId: config.id,
        namespace: config.namespace,
        operation: 'indexDocuments',
        sourceCount,
        replaceSources: options?.replaceSources ?? true,
        dryRun: options?.dryRun === true,
        cacheMode: options?.cache ?? 'default',
      },
    })
    try {
      const result = await span.withContext(async () => {
        validateDocuments(documents, config.namespace)

        const prepared = await preparePipelineOutput(documents, {
          chunking: options?.chunking,
          cache: options?.cache,
        })
        const replaceSources = options?.replaceSources ?? true
        const result = await runIndexOperation({
          indexerId: config.id,
          namespace: config.namespace,
          operation: 'indexDocuments',
          sourceCount,
          chunkCount: prepared.chunks.length,
          replaceSources,
          dryRun: options?.dryRun === true,
          instrument: false,
          run: () =>
            indexPreparedChunks(prepared, {
              replaceSources,
              dryRun: options?.dryRun === true,
              cacheMode: resolveCacheMode(cacheConfig, options?.cache),
            }),
        })
        emitIndexingOutputArtifact(span.spanId, {
          indexerId: config.id,
          namespace: config.namespace,
          operation: 'indexDocuments',
          sourceCount,
          chunkCount: result.chunkCount,
          dryRun: options?.dryRun === true,
          stages: 'stages' in result ? result.stages : undefined,
        })
        return result
      })
      const observedResult = withOperationResultMeta(result, {
        traceId: span.traceId,
        spanId: span.spanId,
      })
      span.end({
        attributes: { sourceCount: result.sourceCount, chunkCount: result.chunkCount, dryRun: options?.dryRun === true },
      })
      return observedResult
    } catch (error) {
      span.error(error)
      throw error
    }
  }

  function indexChunks(
    chunksInput: AsyncIterable<CruxChunk> | CruxChunk[],
    options: { dryRun: true; replaceSources?: boolean; cache?: PipelineCacheMode },
  ): Promise<IndexDryRunResult>
  function indexChunks(
    chunksInput: AsyncIterable<CruxChunk> | CruxChunk[],
    options?: { dryRun?: false; replaceSources?: boolean; cache?: PipelineCacheMode },
  ): Promise<IndexResult>
  async function indexChunks(
    chunksInput: AsyncIterable<CruxChunk> | CruxChunk[],
    options?: { dryRun?: boolean; replaceSources?: boolean; cache?: PipelineCacheMode },
  ): Promise<IndexResult | IndexDryRunResult> {
    const chunks = (await collect(chunksInput)).map((inputChunk) => normalizeChunk(inputChunk, config.namespace))
    const sourceCount = unique(chunks.map((chunk) => chunk.sourceId)).length
    const span = observe.openSpan({
      name: `${config.id}.indexChunks`,
      primitive: 'indexing.pipeline',
      attributes: {
        indexerId: config.id,
        namespace: config.namespace,
        operation: 'indexChunks',
        sourceCount,
        chunkCount: chunks.length,
        replaceSources: options?.replaceSources ?? false,
        dryRun: options?.dryRun === true,
        cacheMode: options?.cache ?? 'default',
      },
    })
    try {
      const result = await span.withContext(async () => {
        validateChunks(chunks, config.namespace)

        const replaceSources = options?.replaceSources ?? false
        const result = await runIndexOperation({
          indexerId: config.id,
          namespace: config.namespace,
          operation: 'indexChunks',
          sourceCount,
          chunkCount: chunks.length,
          replaceSources,
          dryRun: options?.dryRun === true,
          instrument: false,
          run: () =>
            indexPreparedChunks(
              { chunks, parents: [] },
              {
                replaceSources,
                dryRun: options?.dryRun === true,
                cacheMode: resolveCacheMode(cacheConfig, options?.cache),
              },
            ),
        })
        emitIndexingOutputArtifact(span.spanId, {
          indexerId: config.id,
          namespace: config.namespace,
          operation: 'indexChunks',
          sourceCount,
          chunkCount: result.chunkCount,
          dryRun: options?.dryRun === true,
          stages: 'stages' in result ? result.stages : undefined,
        })
        return result
      })
      const observedResult = withOperationResultMeta(result, {
        traceId: span.traceId,
        spanId: span.spanId,
      })
      span.end({
        attributes: { sourceCount: result.sourceCount, chunkCount: result.chunkCount, dryRun: options?.dryRun === true },
      })
      return observedResult
    } catch (error) {
      span.error(error)
      throw error
    }
  }

  async function preparePipelineOutput(
    documents: CruxDocument[],
    options: { chunking?: ChunkingOptions; cache?: PipelineCacheMode },
  ): Promise<Required<Pick<ChunkingResult, 'chunks' | 'parents'>> & { stages: SourceStageRecord[] }> {
    const normalizedChunking = normalizeChunkingOptions(options.chunking)
    const cacheMode = resolveCacheMode(cacheConfig, options.cache)
    const allChunks: CruxChunk[] = []
    const allParents: CruxParentChunk[] = []
    const allStages: SourceStageRecord[] = []

    for (const inputDocument of documents) {
      let document = inputDocument
      let sourceHash = stableHash({
        content: document.content,
        metadata: document.metadata ?? {},
        parts: document.parts ?? [],
      })
      let provenanceConfidence: ChunkProvenance['confidence'] = 'exact'

      for (const documentTransform of pipeline.documents) {
        const before = document
        document = await runCachedStage({
          cacheConfig,
          cacheMode,
          namespace: config.namespace,
          sourceId: document.sourceId,
          sourceHash,
          previousHash: sourceHash,
          stageKind: 'document-transform',
          stageName: documentTransform.name,
          stageVersion: documentTransform.version,
          stageFingerprint: stageFingerprint(documentTransform),
          onStage: (stage) => allStages.push(stage),
          run: async () => {
            let markedDerived = false
            const next = await documentTransform.run(document, {
              sourceHash,
              markDerived() {
                markedDerived = true
              },
            })
            if (next.namespace !== before.namespace || next.sourceId !== before.sourceId) {
              throw new Error(`Document transform "${documentTransform.name}" must preserve namespace and sourceId.`)
            }
            if (next.content !== before.content && !markedDerived) {
              provenanceConfidence = 'derived'
            }
            return { ...next, ...(before.source ? { source: before.source } : {}) }
          },
        })
        sourceHash = stableHash({
          content: document.content,
          metadata: document.metadata ?? {},
          parts: document.parts ?? [],
        })
      }

      const chunkingResult = await runCachedStage({
        cacheConfig,
        cacheMode,
        namespace: config.namespace,
        sourceId: document.sourceId,
        sourceHash,
        previousHash: sourceHash,
        stageKind: 'chunker',
        stageName: pipeline.chunker.name,
        stageVersion: pipeline.chunker.version,
        stageFingerprint: pipeline.chunker.fingerprint(),
        summarize: (value) => ({
          chunkCount: value.chunks.length,
          parentCount: value.parents?.length ?? 0,
        }),
        onStage: (stage) => allStages.push(stage),
        run: () => pipeline.chunker.chunkDocument(document, { chunking: normalizedChunking }),
      })

      let chunks = chunkingResult.chunks.map((item) =>
        normalizeChunk(applyProvenanceConfidence({
          ...item,
          source: sourceFactsWithLocations(item.source ?? document.source, item.provenance?.sourceLocations ?? []),
        }, provenanceConfidence), config.namespace),
      )
      let parents = (chunkingResult.parents ?? []).map((item) =>
        normalizeParentChunk(applyParentProvenanceConfidence({
          ...item,
          source: sourceFactsWithLocations(item.source ?? document.source, item.provenance?.sourceLocations ?? []),
        }, provenanceConfidence), config.namespace),
      )

      for (const chunkTransform of pipeline.chunks) {
        chunks = await runCachedStage({
          cacheConfig,
          cacheMode,
          namespace: config.namespace,
          sourceId: document.sourceId,
          sourceHash,
          previousHash: stableHash(chunks),
          stageKind: 'chunk-transform',
          stageName: chunkTransform.name,
          stageVersion: chunkTransform.version,
          stageFingerprint: stageFingerprint(chunkTransform),
          summarize: (value) => ({ chunkCount: value.length }),
          onStage: (stage) => allStages.push(stage),
          run: async () => {
            const nextChunks = await chunkTransform.run(chunks, { sourceHash })
            return nextChunks.map((item) => normalizeChunk({
              ...item,
              source: sourceFactsWithLocations(
                item.source ?? document.source,
                item.provenance?.sourceLocations ?? [],
              ),
            }, config.namespace))
          },
        })
      }

      allChunks.push(...chunks)
      allParents.push(...parents)
    }

    return { chunks: allChunks, parents: allParents, stages: allStages }
  }

  async function indexPreparedChunks(
    prepared: Required<Pick<ChunkingResult, 'chunks' | 'parents'>> & { stages?: SourceStageRecord[] },
    options: { replaceSources: boolean; dryRun: boolean; cacheMode: PipelineCacheMode | 'disabled' },
  ): Promise<IndexOperationPayload> {
    const chunks = prepared.chunks.map((inputChunk) => normalizeChunk(inputChunk, config.namespace))
    const parents = prepared.parents.map((inputParent) => normalizeParentChunk(inputParent, config.namespace))
    const sourceIds = unique(chunks.map((chunkItem) => chunkItem.sourceId))
    const embeddings = await prepareEmbeddings(chunks, options.cacheMode)
    const stages = [...(prepared.stages ?? []), ...embeddings.stages]

    if (options.dryRun) {
      return {
        namespace: config.namespace,
        sourceCount: sourceIds.length,
        chunkCount: chunks.length,
        dryRun: true,
        chunks,
        parents,
        ...(stages.length > 0 ? { stages } : {}),
        embeddings: {
          dense: embeddings.dense !== undefined,
          sparse: embeddings.sparse !== undefined,
        },
      }
    }

    await records.persistGeneration({
      chunks,
      parents,
      dense: embeddings.dense,
      sparse: embeddings.sparse,
      replaceSources: options.replaceSources,
    })

    return {
      namespace: config.namespace,
      sourceCount: sourceIds.length,
      chunkCount: chunks.length,
      ...(stages.length > 0 ? { stages } : {}),
    }
  }

  async function prepareEmbeddings(chunks: CruxChunk[], cacheMode: PipelineCacheMode | 'disabled'): Promise<{
    dense?: number[][]
    sparse?: SparseVector[]
    stages: SourceStageRecord[]
  }> {
    const denseResult = config.dense
      ? await runEmbeddingStage({
          embedding: config.dense,
          chunks,
          namespace: config.namespace,
          cacheConfig,
          cacheMode,
        })
      : undefined
    const sparseResult = config.sparse
      ? await runEmbeddingStage({
          embedding: config.sparse,
          chunks,
          namespace: config.namespace,
          cacheConfig,
          cacheMode,
        })
      : undefined
    return {
      ...(denseResult ? { dense: denseResult.embeddings } : {}),
      ...(sparseResult ? { sparse: sparseResult.embeddings } : {}),
      stages: [...(denseResult?.stages ?? []), ...(sparseResult?.stages ?? [])],
    }
  }

  function fingerprint(options?: IndexFingerprintOptions): string {
    return stableHash({
      indexerId: config.id,
      namespace: config.namespace,
      indexVersion: options?.indexVersion ?? 'default',
      chunking: normalizeChunkingOptions(options?.chunking),
      dense: config.dense ? embeddingIdentity(config.dense) : null,
      sparse: config.sparse ? embeddingIdentity(config.sparse) : null,
      pipeline: pipeline.fingerprint(),
    })
  }

  async function deleteSource(sourceId: string): Promise<number> {
    return runIndexOperation({
      indexerId: config.id,
      namespace: config.namespace,
      operation: 'deleteSource',
      sourceCount: 1,
      chunkCount: 0,
      sourceId,
      run: () => records.deleteSource(sourceId),
    })
  }

  async function clear(): Promise<number> {
    return runIndexOperation({
      indexerId: config.id,
      namespace: config.namespace,
      operation: 'clear',
      sourceCount: 0,
      chunkCount: 0,
      run: () => records.clearNamespace(),
    })
  }

  return Object.freeze({
    id: config.id,
    namespace: config.namespace,
    chunk,
    indexDocuments,
    indexChunks,
    fingerprint,
    deleteSource,
    clear,
  })
}

function validateConfig(config: IndexerConfig): void {
  if (!config.id.trim()) {
    throw new Error('Indexer id must be non-empty.')
  }
  if (!config.namespace.trim()) {
    throw new Error('Indexer namespace must be non-empty.')
  }
}

function getIndexerRecordStore(config: IndexerConfig): RecordStore {
  const records = config.records ?? config.storage?.records
  if (!records) throw new Error('indexer() requires records or storage.records.')
  return records
}
