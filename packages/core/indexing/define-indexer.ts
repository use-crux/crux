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
import { stableHash } from './hash'
import {
  emitIndexingOutputArtifact,
  runIndexOperation,
} from './observability'
import { normalizeChunk, normalizeParentChunk, validateChunks, validateDocuments } from './normalize'
import { applyParentProvenanceConfidence, applyProvenanceConfidence } from './provenance'
import { indexingPipeline, stageFingerprint } from './pipeline'
import { createIndexedKnowledgeStore } from '../indexed-knowledge'
import { observe } from '../observability'
import type { DataStore, SparseVector } from '../store/types'
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
  const dataStore = getIndexerDataStore(config)
  const vectorStore = config.vectors ?? config.storage?.vectors
  const records = createIndexedKnowledgeStore({
    indexerId: config.id,
    namespace: config.namespace,
    data: dataStore,
    vectors: vectorStore,
    legacyStore: config.store,
  })
  const cacheConfig = normalizePipelineCache(config.cache, dataStore, config.id)

  async function chunk(
    documentsInput: AsyncIterable<CruxDocument> | CruxDocument[],
    options?: { chunking?: ChunkingOptions; cache?: PipelineCacheMode },
  ): Promise<CruxChunk[]> {
    const documents = await collect(documentsInput)
    const span = observe.openSpan({
      name: `${config.id}.chunk`,
      family: 'indexing',
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
      span.end({ chunkCount: chunks.length })
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
      family: 'indexing',
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
      span.end({ sourceCount: result.sourceCount, chunkCount: result.chunkCount, dryRun: options?.dryRun === true })
      return result
    } catch (error) {
      span.error(error)
      throw error
    }
  }

  function indexChunks(
    chunksInput: AsyncIterable<CruxChunk> | CruxChunk[],
    options: { dryRun: true; replaceSources?: boolean },
  ): Promise<IndexDryRunResult>
  function indexChunks(
    chunksInput: AsyncIterable<CruxChunk> | CruxChunk[],
    options?: { dryRun?: false; replaceSources?: boolean },
  ): Promise<IndexResult>
  async function indexChunks(
    chunksInput: AsyncIterable<CruxChunk> | CruxChunk[],
    options?: { dryRun?: boolean; replaceSources?: boolean },
  ): Promise<IndexResult | IndexDryRunResult> {
    const chunks = (await collect(chunksInput)).map((inputChunk) => normalizeChunk(inputChunk, config.namespace))
    const sourceCount = unique(chunks.map((chunk) => chunk.sourceId)).length
    const span = observe.openSpan({
      name: `${config.id}.indexChunks`,
      family: 'indexing',
      primitive: 'indexing.pipeline',
      attributes: {
        indexerId: config.id,
        namespace: config.namespace,
        operation: 'indexChunks',
        sourceCount,
        chunkCount: chunks.length,
        replaceSources: options?.replaceSources ?? false,
        dryRun: options?.dryRun === true,
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
        })
        return result
      })
      span.end({ sourceCount: result.sourceCount, chunkCount: result.chunkCount, dryRun: options?.dryRun === true })
      return result
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
            return next
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
        normalizeChunk(applyProvenanceConfidence(item, provenanceConfidence), config.namespace),
      )
      let parents = (chunkingResult.parents ?? []).map((item) =>
        normalizeParentChunk(applyParentProvenanceConfidence(item, provenanceConfidence), config.namespace),
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
            return nextChunks.map((item) => normalizeChunk(item, config.namespace))
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
    options: { replaceSources: boolean; dryRun: boolean },
  ): Promise<IndexResult | IndexDryRunResult> {
    const chunks = prepared.chunks.map((inputChunk) => normalizeChunk(inputChunk, config.namespace))
    const parents = prepared.parents.map((inputParent) => normalizeParentChunk(inputParent, config.namespace))
    const sourceIds = unique(chunks.map((chunkItem) => chunkItem.sourceId))
    const embeddings = await prepareEmbeddings(chunks)

    if (options.dryRun) {
      return {
        namespace: config.namespace,
        sourceCount: sourceIds.length,
        chunkCount: chunks.length,
        dryRun: true,
        chunks,
        parents,
        ...(prepared.stages ? { stages: prepared.stages } : {}),
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
      ...(prepared.stages ? { stages: prepared.stages } : {}),
    }
  }

  async function prepareEmbeddings(chunks: CruxChunk[]): Promise<{
    dense?: number[][]
    sparse?: SparseVector[]
  }> {
    const contents = chunks.map((chunkItem) => chunkItem.content)
    const denseEmbeddings = config.dense ? await config.dense.embedMany(contents) : undefined
    const sparseEmbeddings = config.sparse ? await config.sparse.embedMany(contents) : undefined
    return {
      ...(denseEmbeddings ? { dense: denseEmbeddings } : {}),
      ...(sparseEmbeddings ? { sparse: sparseEmbeddings } : {}),
    }
  }

  function fingerprint(options?: IndexFingerprintOptions): string {
    return stableHash({
      indexerId: config.id,
      namespace: config.namespace,
      indexVersion: options?.indexVersion ?? 'default',
      chunking: normalizeChunkingOptions(options?.chunking),
      dense: config.dense
        ? { kind: config.dense.kind, name: config.dense.name, dimensions: config.dense.dimensions }
        : null,
      sparse: config.sparse ? { kind: config.sparse.kind, name: config.sparse.name } : null,
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

function getIndexerDataStore(config: IndexerConfig): DataStore {
  const data = config.data ?? config.storage?.data ?? config.store
  if (!data) throw new Error('indexer() requires data, storage.data, or store.')
  return data
}
