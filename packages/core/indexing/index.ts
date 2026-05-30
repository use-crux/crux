import type { DenseEmbedding, SparseEmbedding } from '../embedding'
import { observe } from '../observability'
import { getRuntime } from '../runtime'
import type { CruxStore, DataStore, JsonObject, SparseVector, Storage, StoreEntry, VectorStore } from '../store/types'

export interface CruxDocument {
  namespace: string
  sourceId: string
  content: string
  title?: string
  metadata?: Record<string, unknown>
  parts?: CruxIngestPart[]
  warnings?: CruxIngestWarning[]
}

export interface CruxChunk {
  namespace: string
  sourceId: string
  chunkId: string
  generationId?: string
  active?: boolean
  ordinal: number
  content: string
  metadata: Record<string, unknown>
  parent?: {
    parentId?: string
    key?: string
    title?: string
    summary?: string
  }
  provenance?: ChunkProvenance
}

export interface CruxParentChunk {
  namespace: string
  sourceId: string
  parentId: string
  generationId?: string
  active?: boolean
  ordinal: number
  content: string
  metadata: Record<string, unknown>
  provenance?: ChunkProvenance
}

export interface CruxIngestWarning {
  code: string
  message: string
  partId?: string
  metadata?: Record<string, unknown>
}

export type CruxIngestPart =
  | {
      id: string
      kind: 'text'
      content: string
      role?: string
      headingPath?: string[]
      metadata?: Record<string, unknown>
    }
  | {
      id: string
      kind: 'page'
      content: string
      pageNumber: number
      headingPath?: string[]
      metadata?: Record<string, unknown>
    }
  | {
      id: string
      kind: 'table'
      content: string
      rows?: string[][]
      caption?: string
      columns?: string[]
      pageNumber?: number
      sheetName?: string
      rowStart?: number
      rowEnd?: number
      metadata?: Record<string, unknown>
    }
  | {
      id: string
      kind: 'sheet'
      content: string
      sheetName: string
      index: number
      metadata?: Record<string, unknown>
    }
  | {
      id: string
      kind: 'json'
      content: string
      path: string
      valueType?: string
      metadata?: Record<string, unknown>
    }

export interface ChunkProvenance {
  partIds?: string[]
  pages?: number[]
  sheets?: string[]
  tables?: string[]
  jsonPaths?: string[]
  sourceSpans?: Array<{
    start: number
    end: number
    partId?: string
  }>
  confidence?: 'exact' | 'derived'
}

export type CruxIngestLoadResultLike =
  | { ok: true; document: CruxDocument }
  | {
      ok: false
      namespace: string
      sourceId: string
      error: { message: string; stack?: string; code?: string; parser?: string }
      metadata?: Record<string, unknown>
    }

export interface ChunkingOptions {
  maxChars?: number
  overlapChars?: number
}

export type PipelineCacheMode = 'readwrite' | 'refresh' | 'bypass'

export type PipelineCacheConfig =
  | false
  | true
  | {
      store?: DataStore
      scope?: string
    }

export interface ChunkingResult {
  chunks: CruxChunk[]
  parents?: CruxParentChunk[]
  stages?: SourceStageRecord[]
}

export interface ChunkerContext {
  chunking: Required<ChunkingOptions>
}

export interface Chunker {
  readonly _tag: 'Chunker'
  readonly name: string
  readonly version: string
  fingerprint(): string
  chunkDocument(document: CruxDocument, ctx: ChunkerContext): Promise<ChunkingResult> | ChunkingResult
}

export interface DocumentTransformContext {
  sourceHash: string
  markDerived(): void
}

export interface DocumentTransform {
  readonly _tag: 'DocumentTransform'
  readonly name: string
  readonly version: string
  readonly options?: JsonObject
  readonly fingerprint?: unknown
  run(document: CruxDocument, ctx: DocumentTransformContext): Promise<CruxDocument> | CruxDocument
}

export interface ChunkTransformContext {
  sourceHash: string
}

export interface ChunkTransform {
  readonly _tag: 'ChunkTransform'
  readonly name: string
  readonly version: string
  readonly options?: JsonObject
  readonly fingerprint?: unknown
  run(chunks: CruxChunk[], ctx: ChunkTransformContext): Promise<CruxChunk[]> | CruxChunk[]
}

export interface IndexingPipeline {
  readonly _tag: 'IndexingPipeline'
  readonly documents: readonly DocumentTransform[]
  readonly chunker: Chunker
  readonly chunks: readonly ChunkTransform[]
  fingerprint(): string
}

export interface IndexingPipelineConfig {
  documents?: DocumentTransform[]
  chunker?: Chunker
  chunks?: ChunkTransform[]
}

export interface StructuredChunkerOptions extends ChunkingOptions {
  tableRowsPerChunk?: number
}

export interface ParentChildChunkerOptions {
  parentMaxChars?: number
  childMaxChars?: number
  childOverlapChars?: number
}

export type SemanticChunkerOptions =
  | ({
      strategy: 'embedding'
      dense: DenseEmbedding
      minChars?: number
      maxChars?: number
      similarityThreshold?: number
    } & ChunkingOptions)
  | ({
      strategy: 'model' | 'custom'
      segment: SemanticSegmentFn
      minChars?: number
      maxChars?: number
    } & ChunkingOptions)
  | ({
      strategy: 'hybrid'
      dense: DenseEmbedding
      segment: SemanticSegmentFn
      minChars?: number
      maxChars?: number
      similarityThreshold?: number
    } & ChunkingOptions)

export interface SemanticBoundary {
  start: number
  end: number
  reason?: string
  confidence?: number
}

export type SemanticSegmentFn = (
  input: { document: CruxDocument; segments: Array<{ text: string; start: number; end: number }> },
  ctx: { maxChars: number; minChars: number },
) => Promise<SemanticBoundary[]> | SemanticBoundary[]

export interface IndexResult {
  namespace: string
  sourceCount: number
  chunkCount: number
  stages?: SourceStageRecord[]
  dryRun?: false
}

export interface IndexDryRunResult {
  namespace: string
  sourceCount: number
  chunkCount: number
  dryRun: true
  chunks: CruxChunk[]
  parents?: CruxParentChunk[]
  stages?: SourceStageRecord[]
  embeddings: {
    dense: boolean
    sparse: boolean
  }
}

export interface IndexFingerprintOptions {
  chunking?: ChunkingOptions
  indexVersion?: string
}

export interface Indexer {
  readonly id: string
  readonly namespace: string
  chunk(
    documents: AsyncIterable<CruxDocument> | CruxDocument[],
    options?: { chunking?: ChunkingOptions; cache?: PipelineCacheMode },
  ): Promise<CruxChunk[]>
  indexDocuments(
    documents: AsyncIterable<CruxDocument> | CruxDocument[],
    options: { dryRun: true; replaceSources?: boolean; chunking?: ChunkingOptions; cache?: PipelineCacheMode },
  ): Promise<IndexDryRunResult>
  indexDocuments(
    documents: AsyncIterable<CruxDocument> | CruxDocument[],
    options?: { dryRun?: false; replaceSources?: boolean; chunking?: ChunkingOptions; cache?: PipelineCacheMode },
  ): Promise<IndexResult>
  indexChunks(
    chunks: AsyncIterable<CruxChunk> | CruxChunk[],
    options: { dryRun: true; replaceSources?: boolean },
  ): Promise<IndexDryRunResult>
  indexChunks(
    chunks: AsyncIterable<CruxChunk> | CruxChunk[],
    options?: { dryRun?: false; replaceSources?: boolean },
  ): Promise<IndexResult>
  fingerprint(options?: IndexFingerprintOptions): string
  deleteSource(sourceId: string): Promise<number>
  clear(): Promise<number>
}

interface IndexerConfig {
  id: string
  namespace: string
  data?: DataStore
  vectors?: VectorStore
  storage?: Storage
  store?: CruxStore
  dense?: DenseEmbedding
  sparse?: SparseEmbedding
  pipeline?: IndexingPipeline
  cache?: PipelineCacheConfig
}

export type SourceStatus = 'indexed' | 'failed' | 'deleted'
export type CorpusSyncMode = 'replaceChanged' | 'appendOnly'
export type CorpusStalePolicy = 'keep' | 'delete'
export type CorpusSourceSet = 'partial' | 'complete'

export interface SourceError {
  message: string
  stack?: string
}

export interface SourceStageRecord {
  name: string
  kind?: 'parser' | 'document-transform' | 'chunker' | 'chunk-transform' | 'embedding' | 'promotion' | 'sync'
  version?: string
  status: 'pending' | 'success' | 'failed' | 'skipped'
  cache?: 'hit' | 'miss' | 'write' | 'refresh' | 'bypass'
  hash?: string
  inputHash?: string
  outputHash?: string
  durationMs?: number
  chunkCount?: number
  parentCount?: number
  error?: SourceError
  updatedAt: number
}

export interface SourceRecord extends JsonObject {
  readonly _tag: 'SourceRecord'
  corpusId: string
  namespace: string
  sourceId: string
  contentHash: string
  metadataHash: string
  sourceHash: string
  indexHash: string
  status: SourceStatus
  chunkCount: number
  title?: string
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
  firstSeenAt: number
  lastSeenAt?: number
  indexedAt?: number
  failedAt?: number
  deletedAt?: number
  lastSyncRunId?: string
  lastError?: SourceError
  errors: SourceError[]
  stages?: SourceStageRecord[]
  parser?: SourceStageRecord
  transform?: SourceStageRecord
  sync?: SourceStageRecord
}

export interface SourceHashOptions {
  normalizeContent?: (content: string) => string
  metadata?: 'stable' | 'none' | 'all'
  includeMetadata?: string[]
  excludeMetadata?: string[]
  hashDocument?: (document: CruxDocument, defaults: SourceHashDefaults) => SourceHashInput
}

export interface SourceHashDefaults {
  normalizedContent: string
  stableMetadata: Record<string, unknown>
}

export interface SourceHashInput {
  content: unknown
  metadata?: unknown
}

export interface CorpusConfig {
  id: string
  namespace: string
  data?: DataStore
  store?: CruxStore
  indexer: Indexer
  hash?: SourceHashOptions
  indexVersion?: string
}

export interface CorpusSyncOptions {
  mode?: CorpusSyncMode
  stale?: CorpusStalePolicy
  sourceSet?: CorpusSourceSet
  dryRun?: boolean
  chunking?: ChunkingOptions
  cache?: PipelineCacheMode
  indexVersion?: string
  onProgress?: (event: CorpusProgressEvent) => void
}

export interface SourceListOptions {
  status?: SourceStatus | SourceStatus[]
  includeDeleted?: boolean
  limit?: number
  cursor?: string
}

export interface CorpusSourceResult {
  sourceId: string
  action: 'added' | 'changed' | 'unchanged' | 'skipped' | 'failed' | 'stale' | 'deleted'
  reason?: 'new' | 'contentChanged' | 'metadataChanged' | 'indexChanged' | 'appendOnly' | 'stale' | 'dryRun' | 'error'
  previousHash?: string
  nextHash?: string
  previousIndexHash?: string
  nextIndexHash?: string
  chunkCount?: number
  stages?: SourceStageRecord[]
  error?: SourceError
}

export interface CorpusSyncResult {
  syncId: string
  corpusId: string
  namespace: string
  mode: CorpusSyncMode
  stalePolicy: CorpusStalePolicy
  sourceSet: CorpusSourceSet
  dryRun: boolean
  added: number
  changed: number
  unchanged: number
  stale: number
  skipped: number
  deleted: number
  failed: number
  chunkCount: number
  durationMs: number
  sources: CorpusSourceResult[]
}

export type CorpusProgressEvent = CorpusSourceResult & {
  syncId: string
  corpusId: string
  namespace: string
  dryRun: boolean
}

export interface SourceDeleteResult {
  sourceId: string
  deletedCount: number
}

export interface SourceClearResult {
  deletedCount: number
  sourceCount: number
}

export interface Corpus {
  readonly _tag: 'Corpus'
  readonly id: string
  readonly namespace: string
  sync(
    documents: AsyncIterable<CruxDocument | CruxIngestLoadResultLike> | Array<CruxDocument | CruxIngestLoadResultLike>,
    options?: CorpusSyncOptions,
  ): Promise<CorpusSyncResult>
  getSource(sourceId: string): Promise<SourceRecord | null>
  listSources(options?: SourceListOptions): Promise<SourceRecord[]>
  deleteSource(sourceId: string): Promise<SourceDeleteResult>
  clearSources(): Promise<SourceClearResult>
}

const DEFAULT_MAX_CHARS = 1200
const DEFAULT_OVERLAP_CHARS = 150
const DEFAULT_EXCLUDED_METADATA_KEYS = [
  'mtime',
  'mtimeMs',
  'lastModified',
  'lastFetchedAt',
  'crawledAt',
  'parsedAt',
  'indexedAt',
  'error',
  'errors',
]

export const transform = Object.freeze({
  document(config: {
    name: string
    version: string
    options?: JsonObject
    fingerprint?: unknown
    run(document: CruxDocument, ctx: DocumentTransformContext): Promise<CruxDocument> | CruxDocument
  }): DocumentTransform {
    validateStageIdentity('Document transform', config.name, config.version)
    return Object.freeze({
      _tag: 'DocumentTransform' as const,
      name: config.name,
      version: config.version,
      ...(config.options ? { options: config.options } : {}),
      ...(config.fingerprint !== undefined ? { fingerprint: config.fingerprint } : {}),
      run: config.run,
    })
  },

  chunk(config: {
    name: string
    version: string
    options?: JsonObject
    fingerprint?: unknown
    run(chunks: CruxChunk[], ctx: ChunkTransformContext): Promise<CruxChunk[]> | CruxChunk[]
  }): ChunkTransform {
    validateStageIdentity('Chunk transform', config.name, config.version)
    return Object.freeze({
      _tag: 'ChunkTransform' as const,
      name: config.name,
      version: config.version,
      ...(config.options ? { options: config.options } : {}),
      ...(config.fingerprint !== undefined ? { fingerprint: config.fingerprint } : {}),
      run: config.run,
    })
  },
})

export const chunker = Object.freeze({
  text(options: ChunkingOptions = {}): Chunker {
    return createChunker('text', '1', options, (document, ctx) => chunkDocumentStructured(document, ctx, options))
  },

  structured(options: StructuredChunkerOptions = {}): Chunker {
    return createChunker('structured', '1', options, (document, ctx) => chunkDocumentStructured(document, ctx, options))
  },

  parentChild(options: ParentChildChunkerOptions = {}): Chunker {
    const normalizedOptions = {
      parentMaxChars: options.parentMaxChars ?? 6000,
      childMaxChars: options.childMaxChars ?? 900,
      childOverlapChars: options.childOverlapChars ?? 120,
    }
    return createChunker('parent-child', '1', normalizedOptions, async (document) =>
      chunkDocumentParentChild(document, normalizedOptions),
    )
  },

  semantic(options: SemanticChunkerOptions): Chunker {
    return createChunker(`semantic:${options.strategy}`, '1', sanitizeFingerprint(options), async (document) =>
      chunkDocumentSemantic(document, options),
    )
  },
})

export function indexingPipeline(config: IndexingPipelineConfig = {}): IndexingPipeline {
  const pipelineChunker = config.chunker ?? chunker.structured()
  const documents = Object.freeze([...(config.documents ?? [])])
  const chunks = Object.freeze([...(config.chunks ?? [])])

  return Object.freeze({
    _tag: 'IndexingPipeline' as const,
    documents,
    chunker: pipelineChunker,
    chunks,
    fingerprint(): string {
      return stableHash({
        documents: documents.map(stageFingerprint),
        chunker: {
          name: pipelineChunker.name,
          version: pipelineChunker.version,
          fingerprint: pipelineChunker.fingerprint(),
        },
        chunks: chunks.map(stageFingerprint),
      })
    },
  })
}

export function indexer(config: IndexerConfig): Indexer {
  validateConfig(config)

  const pipeline = config.pipeline ?? indexingPipeline()
  const dataStore = getIndexerDataStore(config)
  const vectorStore = config.vectors ?? config.storage?.vectors
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

    const generationId = createGenerationId()
    const now = Date.now()
    for (let index = 0; index < chunks.length; index++) {
      const chunkItem = chunks[index]
      const parent =
        chunkItem.parent?.parentId !== undefined
          ? {
              ...chunkItem.parent,
              key:
                chunkItem.parent.key ??
                parentKey(config.id, chunkItem.namespace, chunkItem.sourceId, chunkItem.parent.parentId),
            }
          : chunkItem.parent
      const storedValue: JsonObject = {
        _cruxRecordType: 'chunk',
        namespace: chunkItem.namespace,
        sourceId: chunkItem.sourceId,
        chunkId: chunkItem.chunkId,
        generationId,
        active: true,
        ordinal: chunkItem.ordinal,
        content: chunkItem.content,
        metadata: chunkItem.metadata,
        ...(parent ? { parent } : {}),
        ...(chunkItem.provenance ? { provenance: chunkItem.provenance } : {}),
        ...(embeddings.dense ? { embedding: embeddings.dense[index] } : {}),
        ...(embeddings.sparse ? { sparseEmbedding: embeddings.sparse[index] } : {}),
        createdAt: now,
        updatedAt: now,
      }

      const key = chunkKey(config.id, chunkItem.namespace, chunkItem.sourceId, chunkItem.chunkId)
      await dataStore.set(key, storedValue)
      if (vectorStore && (embeddings.dense?.[index] || embeddings.sparse?.[index])) {
        await vectorStore.upsert([
          {
            key,
            ...(embeddings.dense?.[index] ? { dense: embeddings.dense[index] } : {}),
            ...(embeddings.sparse?.[index] ? { sparse: embeddings.sparse[index] } : {}),
            metadata: vectorMetadata(storedValue),
          },
        ])
      }
    }

    for (const parentItem of parents) {
      await dataStore.set(parentKey(config.id, parentItem.namespace, parentItem.sourceId, parentItem.parentId), {
        _cruxRecordType: 'parent',
        namespace: parentItem.namespace,
        sourceId: parentItem.sourceId,
        parentId: parentItem.parentId,
        generationId,
        active: true,
        ordinal: parentItem.ordinal,
        content: parentItem.content,
        metadata: parentItem.metadata,
        ...(parentItem.provenance ? { provenance: parentItem.provenance } : {}),
        createdAt: now,
        updatedAt: now,
      })
    }

    if (options.replaceSources) {
      for (const sourceId of sourceIds) {
        await deactivatePreviousGenerations(sourceId, generationId)
      }
    }

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

  async function deactivatePreviousGenerations(sourceId: string, activeGenerationId: string): Promise<void> {
    const prefix = sourcePrefix(config.id, config.namespace, sourceId)
    const entries = await listAll(dataStore, prefix)
    for (const entry of entries) {
      if (
        entry.value._cruxRecordType &&
        entry.value.generationId !== activeGenerationId &&
        entry.value.active === true
      ) {
        await dataStore.set(entry.key, { ...entry.value, active: false, updatedAt: Date.now() })
      }
    }
  }

  async function deleteSource(sourceId: string): Promise<number> {
    return runIndexOperation({
      indexerId: config.id,
      namespace: config.namespace,
      operation: 'deleteSource',
      sourceCount: 1,
      chunkCount: 0,
      sourceId,
      run: async () => {
        const prefix = sourcePrefix(config.id, config.namespace, sourceId)
        const entries = await listAll(dataStore, prefix)
        for (const entry of entries) {
          await dataStore.delete(entry.key)
          await vectorStore?.delete([entry.key])
        }
        return entries.length
      },
    })
  }

  async function clear(): Promise<number> {
    return runIndexOperation({
      indexerId: config.id,
      namespace: config.namespace,
      operation: 'clear',
      sourceCount: 0,
      chunkCount: 0,
      run: async () => {
        const prefix = namespacePrefix(config.id, config.namespace)
        const entries = await listAll(dataStore, prefix)
        for (const entry of entries) {
          await dataStore.delete(entry.key)
          await vectorStore?.delete([entry.key])
        }
        return entries.length
      },
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

export function corpus(config: CorpusConfig): Corpus {
  validateCorpusConfig(config)
  const dataStore = getCorpusDataStore(config)

  async function sync(
    documentsInput:
      | AsyncIterable<CruxDocument | CruxIngestLoadResultLike>
      | Array<CruxDocument | CruxIngestLoadResultLike>,
    options: CorpusSyncOptions = {},
  ): Promise<CorpusSyncResult> {
    const mode = options.mode ?? 'replaceChanged'
    const stale = options.stale ?? 'keep'
    const sourceSet = options.sourceSet ?? 'partial'
    const dryRun = options.dryRun === true

    if (stale === 'delete' && sourceSet !== 'complete') {
      throw new Error("corpus.sync({ stale: 'delete' }) requires sourceSet: 'complete'.")
    }

    const startedAt = Date.now()
    const syncId = `${startedAt}-corpus-${config.id}`
    const inputs = await collect(documentsInput)
    const span = observe.openSpan({
      name: `${config.id}.sync`,
      family: 'corpus',
      primitive: 'corpus.sync',
      attributes: {
        syncId,
        corpusId: config.id,
        namespace: config.namespace,
        mode,
        stalePolicy: stale,
        sourceSet,
        dryRun,
        sourceCount: inputs.length,
      },
    })
    try {
      return await span.withContext(async () => {
        getRuntime().instrumentationHooks?.onCorpusSyncStart?.({
          syncId,
          corpusId: config.id,
          namespace: config.namespace,
          mode,
          stalePolicy: stale,
          sourceSet,
          dryRun,
          sourceCount: inputs.length,
        })
        const seenSourceIds = new Set<string>()
        const sourceResults: CorpusSourceResult[] = []
        let added = 0
        let changed = 0
        let unchanged = 0
        let staleCount = 0
        let skipped = 0
        let deleted = 0
        let failed = 0
        let chunkCount = 0

        for (const input of inputs) {
          emitIngestLoadObservation(input, { syncId, corpusId: config.id, namespace: config.namespace })
          if (isFailedLoadResult(input)) {
            seenSourceIds.add(input.sourceId)
            failed++
            const sourceError = toSourceError(input.error)
            if (!dryRun && input.sourceId) {
              const existing = await getSource(input.sourceId)
              const now = Date.now()
              await dataStore.set(sourceKey(config.id, config.namespace, input.sourceId), {
                _tag: 'SourceRecord',
                corpusId: config.id,
                namespace: config.namespace,
                sourceId: input.sourceId,
                contentHash: existing?.contentHash ?? '',
                metadataHash: existing?.metadataHash ?? '',
                sourceHash: existing?.sourceHash ?? '',
                indexHash: existing?.indexHash ?? '',
                status: 'failed',
                chunkCount: existing?.chunkCount ?? 0,
                ...(input.metadata
                  ? { metadata: input.metadata }
                  : existing?.metadata
                    ? { metadata: existing.metadata }
                    : {}),
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
                firstSeenAt: existing?.firstSeenAt ?? now,
                lastSeenAt: now,
                failedAt: now,
                lastSyncRunId: syncId,
                lastError: sourceError,
                errors: [...(existing?.errors ?? []), sourceError],
              } satisfies SourceRecord)
            }

            sourceResults.push(
              emitProgress(options, {
                syncId,
                corpusId: config.id,
                namespace: config.namespace,
                dryRun,
                sourceId: input.sourceId || '<unknown>',
                action: 'failed',
                reason: 'error',
                error: sourceError,
                chunkCount: 0,
              }),
            )
            continue
          }

          const document = isSuccessfulLoadResult(input) ? input.document : input
          try {
            validateCorpusDocument(document, config.namespace)
            seenSourceIds.add(document.sourceId)

            const hashes = computeSourceHashes(document, config.hash)
            const indexHash = config.indexer.fingerprint({
              chunking: options.chunking,
              indexVersion: options.indexVersion ?? config.indexVersion,
            })
            const existing = await getSource(document.sourceId)
            const classification = classifySource(existing, hashes, indexHash)

            if (classification.action === 'unchanged') {
              unchanged++
              const result = emitProgress(options, {
                syncId,
                corpusId: config.id,
                namespace: config.namespace,
                dryRun,
                sourceId: document.sourceId,
                action: 'unchanged',
                previousHash: existing?.sourceHash,
                nextHash: hashes.sourceHash,
                previousIndexHash: existing?.indexHash,
                nextIndexHash: indexHash,
              })
              sourceResults.push(result)
              continue
            }

            if (classification.action === 'changed') {
              if (mode === 'appendOnly') {
                changed++
                skipped++
                const result = emitProgress(options, {
                  syncId,
                  corpusId: config.id,
                  namespace: config.namespace,
                  dryRun,
                  sourceId: document.sourceId,
                  action: 'skipped',
                  reason: 'appendOnly',
                  previousHash: existing?.sourceHash,
                  nextHash: hashes.sourceHash,
                  previousIndexHash: existing?.indexHash,
                  nextIndexHash: indexHash,
                })
                sourceResults.push(result)
                continue
              }
            }

            const indexResult = dryRun
              ? await config.indexer.indexDocuments([document], {
                  replaceSources: true,
                  chunking: options.chunking,
                  cache: options.cache,
                  dryRun: true,
                })
              : await config.indexer.indexDocuments([document], {
                  replaceSources: true,
                  chunking: options.chunking,
                  cache: options.cache,
                })
            chunkCount += indexResult.chunkCount

            const action = classification.action === 'changed' ? 'changed' : 'added'
            const reason = classification.action === 'changed' ? classification.reason : 'new'
            if (action === 'changed') {
              changed++
            } else {
              added++
            }
            if (!dryRun) {
              const now = Date.now()
              await dataStore.set(sourceKey(config.id, config.namespace, document.sourceId), {
                _tag: 'SourceRecord',
                corpusId: config.id,
                namespace: config.namespace,
                sourceId: document.sourceId,
                contentHash: hashes.contentHash,
                metadataHash: hashes.metadataHash,
                sourceHash: hashes.sourceHash,
                indexHash,
                status: 'indexed',
                chunkCount: indexResult.chunkCount,
                ...(document.title ? { title: document.title } : {}),
                ...(document.metadata ? { metadata: document.metadata } : {}),
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
                firstSeenAt: existing?.firstSeenAt ?? now,
                lastSeenAt: now,
                indexedAt: now,
                lastSyncRunId: syncId,
                errors: existing?.errors ?? [],
                ...(indexResult.stages ? { stages: indexResult.stages } : {}),
              } satisfies SourceRecord)
            }

            const result = emitProgress(options, {
              syncId,
              corpusId: config.id,
              namespace: config.namespace,
              dryRun,
              sourceId: document.sourceId,
              action,
              reason,
              previousHash: existing?.sourceHash,
              nextHash: hashes.sourceHash,
              previousIndexHash: existing?.indexHash,
              nextIndexHash: indexHash,
              chunkCount: indexResult.chunkCount,
              ...(indexResult.stages ? { stages: indexResult.stages } : {}),
            })
            sourceResults.push(result)
          } catch (error) {
            failed++
            const sourceError = toSourceError(error)
            const sourceId = document.sourceId || '<unknown>'
            if (!dryRun && document.sourceId) {
              const existing = await getSource(document.sourceId)
              const now = Date.now()
              await dataStore.set(sourceKey(config.id, config.namespace, document.sourceId), {
                _tag: 'SourceRecord',
                corpusId: config.id,
                namespace: config.namespace,
                sourceId: document.sourceId,
                contentHash: existing?.contentHash ?? '',
                metadataHash: existing?.metadataHash ?? '',
                sourceHash: existing?.sourceHash ?? '',
                indexHash: existing?.indexHash ?? '',
                status: 'failed',
                chunkCount: existing?.chunkCount ?? 0,
                ...(document.title ? { title: document.title } : existing?.title ? { title: existing.title } : {}),
                ...(document.metadata
                  ? { metadata: document.metadata }
                  : existing?.metadata
                    ? { metadata: existing.metadata }
                    : {}),
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
                firstSeenAt: existing?.firstSeenAt ?? now,
                lastSeenAt: now,
                failedAt: now,
                lastSyncRunId: syncId,
                lastError: sourceError,
                errors: [...(existing?.errors ?? []), sourceError],
              } satisfies SourceRecord)
            }

            const result = emitProgress(options, {
              syncId,
              corpusId: config.id,
              namespace: config.namespace,
              dryRun,
              sourceId,
              action: 'failed',
              reason: 'error',
              error: sourceError,
              chunkCount: 0,
            })
            sourceResults.push(result)
          }
        }

        if (sourceSet === 'complete') {
          const activeSources = await listSources({ includeDeleted: false })
          for (const source of activeSources) {
            if (seenSourceIds.has(source.sourceId)) {
              continue
            }
            const staleResult: CorpusSourceResult = {
              sourceId: source.sourceId,
              action: stale === 'delete' ? 'deleted' : 'stale',
              reason: 'stale',
              previousHash: source.sourceHash,
              previousIndexHash: source.indexHash,
              chunkCount: source.chunkCount,
            }
            staleCount++
            sourceResults.push(
              emitProgress(options, {
                syncId,
                corpusId: config.id,
                namespace: config.namespace,
                dryRun,
                ...staleResult,
              }),
            )

            if (stale === 'delete') {
              deleted++
              if (!dryRun) {
                await deleteSource(source.sourceId)
              }
            }
          }
        }

        const result = {
          syncId,
          corpusId: config.id,
          namespace: config.namespace,
          mode,
          stalePolicy: stale,
          sourceSet,
          dryRun,
          added,
          changed,
          unchanged,
          stale: staleCount,
          skipped,
          deleted,
          failed,
          chunkCount,
          durationMs: Date.now() - startedAt,
          sources: sourceResults,
        }

        getRuntime().instrumentationHooks?.onCorpusSyncEnd?.({
          syncId: result.syncId,
          corpusId: result.corpusId,
          namespace: result.namespace,
          mode: result.mode,
          stalePolicy: result.stalePolicy,
          sourceSet: result.sourceSet,
          dryRun: result.dryRun,
          added: result.added,
          changed: result.changed,
          unchanged: result.unchanged,
          stale: result.stale,
          skipped: result.skipped,
          deleted: result.deleted,
          failed: result.failed,
          chunkCount: result.chunkCount,
          durationMs: result.durationMs,
        })
        emitCorpusSyncArtifact(span.spanId, result)
        span.end({
          added: result.added,
          changed: result.changed,
          unchanged: result.unchanged,
          stale: result.stale,
          skipped: result.skipped,
          deleted: result.deleted,
          failed: result.failed,
          chunkCount: result.chunkCount,
          sourceCount: result.sources.length,
          dryRun: result.dryRun,
        })

        return result
      })
    } catch (error) {
      span.error(error)
      throw error
    }
  }

  async function getSource(sourceId: string): Promise<SourceRecord | null> {
    const value = await dataStore.get(sourceKey(config.id, config.namespace, sourceId))
    return isSourceRecord(value) ? value : null
  }

  async function listSources(options: SourceListOptions = {}): Promise<SourceRecord[]> {
    const entries = await listAll(dataStore, sourcePrefixKey(config.id, config.namespace))
    const statuses = options.status
      ? new Set(Array.isArray(options.status) ? options.status : [options.status])
      : undefined
    let sources = entries
      .map((entry) => entry.value)
      .filter(isSourceRecord)
      .filter((source) => (options.includeDeleted ? true : source.status !== 'deleted'))
      .filter((source) => (statuses ? statuses.has(source.status) : true))

    if (options.limit !== undefined) {
      sources = sources.slice(0, options.limit)
    }
    return sources
  }

  async function deleteSource(sourceId: string): Promise<SourceDeleteResult> {
    const existing = await getSource(sourceId)
    const deletedCount = await config.indexer.deleteSource(sourceId)
    const now = Date.now()
    await dataStore.set(sourceKey(config.id, config.namespace, sourceId), {
      _tag: 'SourceRecord',
      corpusId: config.id,
      namespace: config.namespace,
      sourceId,
      contentHash: existing?.contentHash ?? '',
      metadataHash: existing?.metadataHash ?? '',
      sourceHash: existing?.sourceHash ?? '',
      indexHash: existing?.indexHash ?? '',
      status: 'deleted',
      chunkCount: 0,
      ...(existing?.title ? { title: existing.title } : {}),
      ...(existing?.metadata ? { metadata: existing.metadata } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      firstSeenAt: existing?.firstSeenAt ?? now,
      deletedAt: now,
      errors: existing?.errors ?? [],
    } satisfies SourceRecord)
    return { sourceId, deletedCount }
  }

  async function clearSources(): Promise<SourceClearResult> {
    const sources = await listSources({ includeDeleted: false })
    const deletedCount = await config.indexer.clear()
    for (const source of sources) {
      await deleteSource(source.sourceId)
    }
    return { deletedCount, sourceCount: sources.length }
  }

  return Object.freeze({
    _tag: 'Corpus' as const,
    id: config.id,
    namespace: config.namespace,
    sync,
    getSource,
    listSources,
    deleteSource,
    clearSources,
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

function getCorpusDataStore(config: CorpusConfig): DataStore {
  const data = config.data ?? config.store
  if (!data) throw new Error('corpus() requires data or store.')
  return data
}

function validateStageIdentity(kind: string, name: string, version: string): void {
  if (!name.trim()) {
    throw new Error(`${kind} name must be non-empty.`)
  }
  if (!version.trim()) {
    throw new Error(`${kind} version must be non-empty.`)
  }
}

function createChunker(
  name: string,
  version: string,
  fingerprintInput: unknown,
  chunkDocument: (document: CruxDocument, ctx: ChunkerContext) => Promise<ChunkingResult> | ChunkingResult,
): Chunker {
  return Object.freeze({
    _tag: 'Chunker' as const,
    name,
    version,
    fingerprint: () => stableHash({ name, version, fingerprintInput }),
    chunkDocument,
  })
}

function stageFingerprint(stage: {
  name: string
  version: string
  options?: JsonObject
  fingerprint?: unknown
}): JsonObject {
  return {
    name: stage.name,
    version: stage.version,
    ...(stage.options ? { options: stage.options } : {}),
    ...(stage.fingerprint !== undefined ? { fingerprint: sanitizeFingerprint(stage.fingerprint) } : {}),
  }
}

function sanitizeFingerprint(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  if ('dense' in value || 'segment' in value) {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(record)
        .filter(([key]) => key !== 'dense' && key !== 'segment')
        .map(([key, nested]) => [key, typeof nested === 'function' ? '[function]' : nested]),
    )
  }
  return value
}

function normalizePipelineCache(
  cache: PipelineCacheConfig | undefined,
  indexStore: DataStore,
  indexerId: string,
): { enabled: boolean; store: DataStore; scope: string } {
  if (!cache) {
    return { enabled: false, store: indexStore, scope: indexerId }
  }
  if (cache === true) {
    return { enabled: true, store: indexStore, scope: indexerId }
  }
  return {
    enabled: true,
    store: cache.store ?? indexStore,
    scope: cache.scope ?? indexerId,
  }
}

function resolveCacheMode(cache: { enabled: boolean }, requested?: PipelineCacheMode): PipelineCacheMode | 'disabled' {
  if (!cache.enabled) return 'disabled'
  return requested ?? 'readwrite'
}

async function runCachedStage<T extends JsonObject | CruxDocument | ChunkingResult | CruxChunk[]>(args: {
  cacheConfig: { enabled: boolean; store: DataStore; scope: string }
  cacheMode: PipelineCacheMode | 'disabled'
  namespace: string
  sourceId: string
  sourceHash: string
  previousHash: string
  stageKind: string
  stageName: string
  stageVersion: string
  stageFingerprint: unknown
  summarize?: (value: T) => Partial<Pick<SourceStageRecord, 'chunkCount' | 'parentCount'>>
  onStage?: (record: SourceStageRecord) => void
  run: () => Promise<T> | T
}): Promise<T> {
  const startedAt = Date.now()
  const span = observe.openSpan({
    name: `${args.stageKind}:${args.stageName}`,
    family: 'indexing',
    primitive: 'indexing.pipeline',
    attributes: {
      namespace: args.namespace,
      sourceId: args.sourceId,
      stageKind: args.stageKind,
      stageName: args.stageName,
      stageVersion: args.stageVersion,
      cacheMode: args.cacheMode,
      inputHash: args.previousHash,
    },
  })
  const baseRecord = (value: T, status: SourceStageRecord['status'], cache?: SourceStageRecord['cache']) => ({
    name: args.stageName,
    kind: args.stageKind as SourceStageRecord['kind'],
    version: args.stageVersion,
    status,
    ...(cache ? { cache } : {}),
    hash: stableHash(args.stageFingerprint),
    inputHash: args.previousHash,
    outputHash: stableHash(value),
    durationMs: Date.now() - startedAt,
    ...(args.summarize ? args.summarize(value) : {}),
    updatedAt: Date.now(),
  })

  if (args.cacheMode === 'disabled' || args.cacheMode === 'bypass') {
    try {
      const value = await span.withContext(args.run)
      const record = baseRecord(value, 'success', args.cacheMode === 'bypass' ? 'bypass' : undefined)
      args.onStage?.(record)
      span.withContext(() => emitIndexingStageArtifact(span.spanId, record))
      span.end(stageRecordAttributes(record))
      return value
    } catch (error) {
      span.error(error)
      throw error
    }
  }

  const key = pipelineCacheKey(args)
  if (args.cacheMode === 'readwrite') {
    const cached = await args.cacheConfig.store.get(key)
    if (cached && cached._cruxRecordType === 'pipeline-cache' && 'value' in cached) {
      const value = cached.value as T
      const record = baseRecord(value, 'success', 'hit')
      args.onStage?.(record)
      span.withContext(() => emitIndexingStageArtifact(span.spanId, record))
      span.end(stageRecordAttributes(record))
      return value
    }
  }

  try {
    const value = await span.withContext(args.run)
    await args.cacheConfig.store.set(key, {
      _cruxRecordType: 'pipeline-cache',
      namespace: args.namespace,
      sourceId: args.sourceId,
      stageKind: args.stageKind,
      stageName: args.stageName,
      stageVersion: args.stageVersion,
      inputHash: args.previousHash,
      outputHash: stableHash(value),
      value: value as JsonObject,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const record = baseRecord(value, 'success', args.cacheMode === 'refresh' ? 'refresh' : 'miss')
    args.onStage?.(record)
    span.withContext(() => emitIndexingStageArtifact(span.spanId, record))
    span.end(stageRecordAttributes(record))
    return value
  } catch (error) {
    span.error(error)
    throw error
  }
}

function pipelineCacheKey(args: {
  cacheConfig: { scope: string }
  namespace: string
  sourceId: string
  sourceHash: string
  previousHash: string
  stageKind: string
  stageName: string
  stageVersion: string
  stageFingerprint: unknown
}): string {
  return `indexer:${args.cacheConfig.scope}:namespace:${args.namespace}:pipeline-cache:${stableHash({
    sourceId: args.sourceId,
    sourceHash: args.sourceHash,
    previousHash: args.previousHash,
    stageKind: args.stageKind,
    stageName: args.stageName,
    stageVersion: args.stageVersion,
    stageFingerprint: args.stageFingerprint,
  })}`
}

function validateCorpusConfig(config: CorpusConfig): void {
  if (!config.id.trim()) {
    throw new Error('Corpus id must be non-empty.')
  }
  if (!config.namespace.trim()) {
    throw new Error('Corpus namespace must be non-empty.')
  }
  if (config.indexer.namespace !== config.namespace) {
    throw new Error(
      `Corpus namespace "${config.namespace}" does not match indexer namespace "${config.indexer.namespace}".`,
    )
  }
}

function validateCorpusDocument(document: CruxDocument, namespace: string): void {
  if (document.namespace !== namespace) {
    throw new Error(`Document namespace "${document.namespace}" does not match corpus namespace "${namespace}".`)
  }
  if (!document.sourceId.trim()) {
    throw new Error('Document sourceId must be non-empty.')
  }
}

function isSuccessfulLoadResult(value: unknown): value is Extract<CruxIngestLoadResultLike, { ok: true }> {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === true && 'document' in value)
}

function isFailedLoadResult(value: unknown): value is Extract<CruxIngestLoadResultLike, { ok: false }> {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === false && 'error' in value)
}

function computeSourceHashes(
  document: CruxDocument,
  options?: SourceHashOptions,
): {
  contentHash: string
  metadataHash: string
  sourceHash: string
} {
  const normalizedContent = options?.normalizeContent
    ? options.normalizeContent(document.content)
    : normalizeContentForHash(document.content)
  const stableMetadata = selectMetadataForHash(document.metadata ?? {}, options)
  const input = options?.hashDocument
    ? options.hashDocument(document, { normalizedContent, stableMetadata })
    : { content: normalizedContent, metadata: stableMetadata }
  const contentHash = stableHash(input.content)
  const metadataHash = stableHash(input.metadata ?? {})
  return {
    contentHash,
    metadataHash,
    sourceHash: stableHash({ contentHash, metadataHash }),
  }
}

function normalizeContentForHash(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trimEnd()
}

function selectMetadataForHash(
  metadata: Record<string, unknown>,
  options?: SourceHashOptions,
): Record<string, unknown> {
  if (options?.metadata === 'none') {
    return {}
  }
  if (options?.includeMetadata) {
    const included: Record<string, unknown> = {}
    for (const key of options.includeMetadata) {
      if (key in metadata) {
        included[key] = metadata[key]
      }
    }
    return included
  }
  if (options?.metadata === 'all') {
    return { ...metadata }
  }
  const excluded = new Set([...(options?.excludeMetadata ?? []), ...DEFAULT_EXCLUDED_METADATA_KEYS])
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !excluded.has(key)))
}

function classifySource(
  existing: SourceRecord | null,
  hashes: { contentHash: string; metadataHash: string; sourceHash: string },
  indexHash: string,
):
  | { action: 'added' }
  | { action: 'unchanged' }
  | { action: 'changed'; reason: 'contentChanged' | 'metadataChanged' | 'indexChanged' } {
  if (!existing || existing.status === 'deleted') {
    return { action: 'added' }
  }
  if (existing.contentHash !== hashes.contentHash) {
    return { action: 'changed', reason: 'contentChanged' }
  }
  if (existing.metadataHash !== hashes.metadataHash) {
    return { action: 'changed', reason: 'metadataChanged' }
  }
  if (existing.indexHash !== indexHash) {
    return { action: 'changed', reason: 'indexChanged' }
  }
  return { action: 'unchanged' }
}

function emitProgress(options: CorpusSyncOptions, event: CorpusProgressEvent): CorpusSourceResult {
  getRuntime().instrumentationHooks?.onCorpusSource?.(event)
  options.onProgress?.(event)
  const { syncId: _syncId, corpusId: _corpusId, namespace: _namespace, dryRun: _dryRun, ...result } = event
  return result
}

function emitIngestLoadObservation(
  input: CruxDocument | CruxIngestLoadResultLike,
  args: { syncId: string; corpusId: string; namespace: string },
): void {
  if (!isSuccessfulLoadResult(input) && !isFailedLoadResult(input)) return
  const document = isSuccessfulLoadResult(input) ? input.document : undefined
  const sourceId = document?.sourceId ?? (isFailedLoadResult(input) ? input.sourceId : '<unknown>')
  const span = observe.openSpan({
    name: `${args.corpusId}.ingest:${sourceId}`,
    family: 'ingest',
    primitive: 'ingest.parse',
    attributes: {
      syncId: args.syncId,
      corpusId: args.corpusId,
      namespace: args.namespace,
      sourceId,
      status: input.ok ? 'success' : 'error',
      warningCount: document?.warnings?.length ?? 0,
      partCount: document?.parts?.length ?? 0,
      ...(isFailedLoadResult(input) && input.error.code ? { errorCode: input.error.code } : {}),
      ...(isFailedLoadResult(input) && input.error.parser ? { parser: input.error.parser } : {}),
    },
  })
  try {
    span.withContext(() => {
      observe.event({
        name: input.ok ? 'ingest.parse.success' : 'ingest.parse.error',
        attributes: {
          syncId: args.syncId,
          corpusId: args.corpusId,
          namespace: args.namespace,
          sourceId,
          warningCount: document?.warnings?.length ?? 0,
          partCount: document?.parts?.length ?? 0,
          ...(isFailedLoadResult(input) ? { error: input.error.message } : {}),
        },
      })
    })
    if (isFailedLoadResult(input)) {
      span.error(new Error(input.error.message))
      return
    }
    span.end({ warningCount: document?.warnings?.length ?? 0, partCount: document?.parts?.length ?? 0 })
  } catch (error) {
    span.error(error)
  }
}

function emitIndexingStageArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  record: SourceStageRecord,
): void {
  const artifactId = observe.artifact({
    kind: 'output',
    contentType: 'application/json',
    encoding: 'json',
    preview: record,
    attributes: {
      primitive: 'indexing.pipeline',
      stageKind: record.kind,
      stageName: record.name,
      stageVersion: record.version,
      status: record.status,
      ...(record.cache ? { cache: record.cache } : {}),
      ...(record.chunkCount !== undefined ? { chunkCount: record.chunkCount } : {}),
      ...(record.parentCount !== undefined ? { parentCount: record.parentCount } : {}),
    },
  })
  if (artifactId) {
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: spanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: { stageKind: record.kind, stageName: record.name, status: record.status },
    })
  }
}

function emitIndexingOutputArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  result: {
    indexerId: string
    namespace: string
    operation: string
    sourceCount?: number
    chunkCount?: number
    deletedCount?: number
    dryRun?: boolean
    stages?: SourceStageRecord[]
  },
): void {
  const artifactId = observe.artifact({
    kind: 'output',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      operation: result.operation,
      namespace: result.namespace,
      sourceCount: result.sourceCount ?? 0,
      chunkCount: result.chunkCount ?? 0,
      deletedCount: result.deletedCount ?? 0,
      dryRun: result.dryRun === true,
      stages: result.stages?.slice(0, 20),
    },
    attributes: {
      primitive: 'indexing.pipeline',
      indexerId: result.indexerId,
      namespace: result.namespace,
      operation: result.operation,
      ...(result.sourceCount !== undefined ? { sourceCount: result.sourceCount } : {}),
      ...(result.chunkCount !== undefined ? { chunkCount: result.chunkCount } : {}),
      ...(result.deletedCount !== undefined ? { deletedCount: result.deletedCount } : {}),
      ...(result.dryRun !== undefined ? { dryRun: result.dryRun } : {}),
      stageCount: result.stages?.length ?? 0,
    },
  })
  if (artifactId) {
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: spanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: { operation: result.operation, namespace: result.namespace },
    })
  }
}

function emitCorpusSyncArtifact(spanId: ReturnType<typeof observe.openSpan>['spanId'], result: CorpusSyncResult): void {
  const artifactId = observe.artifact({
    kind: 'output',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      syncId: result.syncId,
      corpusId: result.corpusId,
      namespace: result.namespace,
      mode: result.mode,
      stalePolicy: result.stalePolicy,
      sourceSet: result.sourceSet,
      dryRun: result.dryRun,
      added: result.added,
      changed: result.changed,
      unchanged: result.unchanged,
      stale: result.stale,
      skipped: result.skipped,
      deleted: result.deleted,
      failed: result.failed,
      chunkCount: result.chunkCount,
      sources: result.sources.slice(0, 50),
    },
    attributes: {
      primitive: 'corpus.sync',
      syncId: result.syncId,
      corpusId: result.corpusId,
      namespace: result.namespace,
      sourceCount: result.sources.length,
      chunkCount: result.chunkCount,
      failed: result.failed,
      dryRun: result.dryRun,
    },
  })
  if (artifactId) {
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: spanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: { syncId: result.syncId, corpusId: result.corpusId, namespace: result.namespace },
    })
  }
}

function stageRecordAttributes(record: SourceStageRecord): Record<string, unknown> {
  return {
    stageKind: record.kind,
    stageName: record.name,
    stageVersion: record.version,
    status: record.status,
    durationMs: record.durationMs,
    ...(record.cache ? { cache: record.cache } : {}),
    ...(record.chunkCount !== undefined ? { chunkCount: record.chunkCount } : {}),
    ...(record.parentCount !== undefined ? { parentCount: record.parentCount } : {}),
  }
}

function sourcePrefixKey(corpusId: string, namespace: string): string {
  return `corpus:${corpusId}:namespace:${namespace}:source:`
}

function sourceKey(corpusId: string, namespace: string, sourceId: string): string {
  return `${sourcePrefixKey(corpusId, namespace)}${encodeURIComponent(sourceId)}`
}

function isSourceRecord(value: JsonObject | null): value is SourceRecord {
  return value?._tag === 'SourceRecord'
}

function toSourceError(error: unknown): SourceError {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    }
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const record = error as { message: unknown; stack?: unknown }
    return {
      message: String(record.message),
      ...(typeof record.stack === 'string' ? { stack: record.stack } : {}),
    }
  }
  return { message: String(error) }
}

function validateDocuments(documents: CruxDocument[], namespace: string): void {
  for (const document of documents) {
    if (document.namespace !== namespace) {
      throw new Error(`Document namespace "${document.namespace}" does not match indexer namespace "${namespace}".`)
    }
    if (!document.sourceId.trim()) {
      throw new Error('Document sourceId must be non-empty.')
    }
  }
}

function validateChunks(chunks: CruxChunk[], namespace: string): void {
  for (const chunk of chunks) {
    if (chunk.namespace !== namespace) {
      throw new Error(`Chunk namespace "${chunk.namespace}" does not match indexer namespace "${namespace}".`)
    }
    if (!chunk.sourceId.trim()) {
      throw new Error('Chunk sourceId must be non-empty.')
    }
    if (!chunk.chunkId.trim()) {
      throw new Error('Chunk chunkId must be non-empty.')
    }
  }
}

function normalizeChunk(chunk: CruxChunk, namespace: string): CruxChunk {
  if (chunk.namespace !== namespace) {
    throw new Error(`Chunk namespace "${chunk.namespace}" does not match indexer namespace "${namespace}".`)
  }

  return {
    namespace,
    sourceId: chunk.sourceId,
    chunkId: chunk.chunkId,
    ...(chunk.generationId ? { generationId: chunk.generationId } : {}),
    ...(chunk.active !== undefined ? { active: chunk.active } : {}),
    ordinal: chunk.ordinal,
    content: chunk.content,
    metadata: chunk.metadata ?? {},
    ...(chunk.parent ? { parent: chunk.parent } : {}),
    ...(chunk.provenance ? { provenance: chunk.provenance } : {}),
  }
}

function normalizeParentChunk(parent: CruxParentChunk, namespace: string): CruxParentChunk {
  if (parent.namespace !== namespace) {
    throw new Error(`Parent chunk namespace "${parent.namespace}" does not match indexer namespace "${namespace}".`)
  }
  if (!parent.sourceId.trim()) {
    throw new Error('Parent chunk sourceId must be non-empty.')
  }
  if (!parent.parentId.trim()) {
    throw new Error('Parent chunk parentId must be non-empty.')
  }
  return {
    namespace,
    sourceId: parent.sourceId,
    parentId: parent.parentId,
    ...(parent.generationId ? { generationId: parent.generationId } : {}),
    ...(parent.active !== undefined ? { active: parent.active } : {}),
    ordinal: parent.ordinal,
    content: parent.content,
    metadata: parent.metadata ?? {},
    ...(parent.provenance ? { provenance: parent.provenance } : {}),
  }
}

function normalizeChunkingOptions(options?: ChunkingOptions): Required<ChunkingOptions> {
  return {
    maxChars: options?.maxChars ?? DEFAULT_MAX_CHARS,
    overlapChars: options?.overlapChars ?? DEFAULT_OVERLAP_CHARS,
  }
}

function chunkDocumentStructured(
  document: CruxDocument,
  ctx: ChunkerContext,
  options: StructuredChunkerOptions | ChunkingOptions = {},
): ChunkingResult {
  const normalized = normalizeChunkingOptions({
    maxChars: options.maxChars ?? ctx.chunking.maxChars,
    overlapChars: options.overlapChars ?? ctx.chunking.overlapChars,
  })
  const parts = document.parts?.length
    ? document.parts
    : [{ id: 'text:1', kind: 'text' as const, content: document.content }]
  const chunks: CruxChunk[] = []
  const tableRowsPerChunk = 'tableRowsPerChunk' in options ? (options.tableRowsPerChunk ?? 25) : 25

  for (const part of parts) {
    if (part.kind === 'table') {
      chunks.push(...chunkTablePart(document, part, tableRowsPerChunk))
      continue
    }
    if (part.kind === 'json') {
      chunks.push(createPartChunk(document, part.content, chunks.length, provenanceForPart(document, part)))
      continue
    }
    if (part.kind === 'sheet') {
      chunks.push(createPartChunk(document, part.content, chunks.length, provenanceForPart(document, part)))
      continue
    }

    const rawChunks = splitDocument(part.content, normalized)
    rawChunks.forEach((content) => {
      chunks.push(createPartChunk(document, content, chunks.length, provenanceForPart(document, part, content)))
    })
  }

  return { chunks }
}

function chunkTablePart(
  document: CruxDocument,
  part: Extract<CruxIngestPart, { kind: 'table' }>,
  rowsPerChunk: number,
): CruxChunk[] {
  const rows = part.rows?.length
    ? part.rows
    : part.content.split('\n').map((row) => row.split('|').map((cell) => cell.trim()))
  if (!rows.length) return []
  const header = part.columns ?? rows[0]
  const bodyRows = rows.length > 1 && arraysEqual(rows[0], header) ? rows.slice(1) : rows
  const chunks: CruxChunk[] = []
  for (let index = 0; index < bodyRows.length; index += rowsPerChunk) {
    const windowRows = bodyRows.slice(index, index + rowsPerChunk)
    const renderedRows = [header, ...windowRows].map((row) => row.join(' | ')).join('\n')
    chunks.push(
      createPartChunk(document, renderedRows, chunks.length, {
        ...provenanceForPart(document, part),
        sourceSpans: sourceSpanForContent(document, part.content, part.id),
      }),
    )
  }
  return chunks
}

function createPartChunk(
  document: CruxDocument,
  content: string,
  ordinal: number,
  provenance?: ChunkProvenance,
): CruxChunk {
  return {
    namespace: document.namespace,
    sourceId: document.sourceId,
    chunkId: createStableId('chunk', {
      sourceId: document.sourceId,
      ordinal,
      content,
      provenance,
    }),
    ordinal,
    content,
    metadata: document.metadata ?? {},
    ...(document.title ? { parent: { title: document.title } } : {}),
    ...(provenance ? { provenance } : {}),
  }
}

function chunkDocumentParentChild(
  document: CruxDocument,
  options: Required<ParentChildChunkerOptions>,
): ChunkingResult {
  const structured = chunkDocumentStructured(
    document,
    { chunking: { maxChars: options.parentMaxChars, overlapChars: 0 } },
    { maxChars: options.parentMaxChars, overlapChars: 0 },
  )
  const parents: CruxParentChunk[] = []
  const children: CruxChunk[] = []
  let currentParentContent = ''
  let currentParentChunks: CruxChunk[] = []

  for (const sourceChunk of structured.chunks) {
    const candidate = currentParentContent ? `${currentParentContent}\n\n${sourceChunk.content}` : sourceChunk.content
    if (candidate.length > options.parentMaxChars && currentParentChunks.length > 0) {
      flushParent()
      currentParentContent = sourceChunk.content
      currentParentChunks = [sourceChunk]
      continue
    }
    currentParentContent = candidate
    currentParentChunks.push(sourceChunk)
  }
  flushParent()

  return { chunks: children, parents }

  function flushParent(): void {
    if (!currentParentContent) return
    const parentOrdinal = parents.length
    const parentId = createStableId('parent', {
      sourceId: document.sourceId,
      ordinal: parentOrdinal,
      content: currentParentContent,
    })
    const provenance = mergeProvenance(
      currentParentChunks.map((chunk) => chunk.provenance).filter(Boolean) as ChunkProvenance[],
    )
    parents.push({
      namespace: document.namespace,
      sourceId: document.sourceId,
      parentId,
      ordinal: parentOrdinal,
      content: currentParentContent,
      metadata: document.metadata ?? {},
      ...(provenance ? { provenance } : {}),
    })
    const rawChildren = splitDocument(currentParentContent, {
      maxChars: options.childMaxChars,
      overlapChars: options.childOverlapChars,
    })
    rawChildren.forEach((content) => {
      children.push({
        namespace: document.namespace,
        sourceId: document.sourceId,
        chunkId: createStableId('chunk', {
          sourceId: document.sourceId,
          parentId,
          ordinal: children.length,
          content,
        }),
        ordinal: children.length,
        content,
        metadata: document.metadata ?? {},
        parent: {
          parentId,
          ...(document.title ? { title: document.title } : {}),
        },
        ...(provenance ? { provenance } : {}),
      })
    })
    currentParentContent = ''
    currentParentChunks = []
  }
}

async function chunkDocumentSemantic(document: CruxDocument, options: SemanticChunkerOptions): Promise<ChunkingResult> {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const minChars = 'minChars' in options ? (options.minChars ?? 200) : 200
  const segments = sentenceSegments(document.content)
  let boundaries: SemanticBoundary[] = []

  if (options.strategy === 'model' || options.strategy === 'custom') {
    boundaries = await options.segment({ document, segments }, { maxChars, minChars })
  } else if (options.strategy === 'hybrid') {
    boundaries = await options.segment({ document, segments }, { maxChars, minChars })
    if (!boundaries.length) {
      boundaries = await embeddingBoundaries(document, segments, options.dense, {
        maxChars,
        minChars,
        similarityThreshold: options.similarityThreshold,
      })
    }
  } else if (options.strategy === 'embedding') {
    boundaries = await embeddingBoundaries(document, segments, options.dense, {
      maxChars,
      minChars,
      similarityThreshold: options.similarityThreshold,
    })
  }

  const normalized = normalizeBoundaries(boundaries, document.content.length)
  const chunks = normalized.map((boundary, ordinal) => {
    const content = document.content.slice(boundary.start, boundary.end).trim()
    return {
      namespace: document.namespace,
      sourceId: document.sourceId,
      chunkId: createStableId('chunk', { sourceId: document.sourceId, boundary, content }),
      ordinal,
      content,
      metadata: {
        ...(document.metadata ?? {}),
        semanticReason: boundary.reason ?? options.strategy,
        ...(boundary.confidence !== undefined ? { semanticConfidence: boundary.confidence } : {}),
      },
      ...(document.title ? { parent: { title: document.title } } : {}),
      provenance: {
        sourceSpans: [{ start: boundary.start, end: boundary.end }],
        confidence: 'exact' as const,
      },
    }
  })
  return { chunks }
}

function coarseProvenance(parts: CruxIngestPart[]): ChunkProvenance {
  const partIds = parts.map((part) => part.id).filter(Boolean)
  const pages = uniqueNumbers(
    parts.flatMap((part) => {
      if (part.kind === 'page') return [part.pageNumber]
      if (part.kind === 'table' && part.pageNumber !== undefined) return [part.pageNumber]
      return []
    }),
  )
  const sheets = unique(
    parts.flatMap((part) => {
      if (part.kind === 'sheet') return [part.sheetName]
      if (part.kind === 'table' && part.sheetName) return [part.sheetName]
      return []
    }),
  )
  const tables = parts.filter((part) => part.kind === 'table').map((part) => part.id)

  return {
    ...(partIds.length ? { partIds } : {}),
    ...(pages.length ? { pages } : {}),
    ...(sheets.length ? { sheets } : {}),
    ...(tables.length ? { tables } : {}),
    confidence: 'exact',
  }
}

function provenanceForPart(
  document: CruxDocument,
  part: CruxIngestPart,
  content: string = part.content,
): ChunkProvenance {
  const base = coarseProvenance([part])
  const sourceSpans = sourceSpanForContent(document, content, part.id)
  return {
    ...base,
    ...(part.kind === 'json' ? { jsonPaths: [part.path] } : {}),
    ...(sourceSpans.length ? { sourceSpans } : {}),
    confidence: sourceSpans.length || !document.content ? 'exact' : 'derived',
  }
}

function sourceSpanForContent(
  document: CruxDocument,
  content: string,
  partId?: string,
): Array<{ start: number; end: number; partId?: string }> {
  if (!content) return []
  const start = document.content.indexOf(content)
  if (start < 0) return []
  return [
    {
      start,
      end: start + content.length,
      ...(partId ? { partId } : {}),
    },
  ]
}

function mergeProvenance(items: ChunkProvenance[]): ChunkProvenance | undefined {
  if (!items.length) return undefined
  return {
    partIds: unique(items.flatMap((item) => item.partIds ?? [])),
    pages: uniqueNumbers(items.flatMap((item) => item.pages ?? [])),
    sheets: unique(items.flatMap((item) => item.sheets ?? [])),
    tables: unique(items.flatMap((item) => item.tables ?? [])),
    jsonPaths: unique(items.flatMap((item) => item.jsonPaths ?? [])),
    sourceSpans: items.flatMap((item) => item.sourceSpans ?? []),
    confidence: items.some((item) => item.confidence === 'derived') ? 'derived' : 'exact',
  }
}

function applyProvenanceConfidence(chunk: CruxChunk, confidence: ChunkProvenance['confidence']): CruxChunk {
  if (!chunk.provenance) return chunk
  if (confidence === 'exact') return chunk
  return {
    ...chunk,
    provenance: { ...chunk.provenance, confidence },
  }
}

function applyParentProvenanceConfidence(
  parent: CruxParentChunk,
  confidence: ChunkProvenance['confidence'],
): CruxParentChunk {
  if (!parent.provenance) return parent
  if (confidence === 'exact') return parent
  return {
    ...parent,
    provenance: { ...parent.provenance, confidence },
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function createStableId(prefix: string, input: unknown): string {
  return `${prefix}_${stableHash(input)}`
}

function createGenerationId(): string {
  return `gen_${Date.now().toString(36)}_${++generationCounter}`
}

let generationCounter = 0

function sentenceSegments(content: string): Array<{ text: string; start: number; end: number }> {
  const matches = [...content.matchAll(/[^.!?\n]+[.!?]?\s*/g)]
  if (!matches.length) return [{ text: content, start: 0, end: content.length }]
  return matches
    .map((match) => ({
      text: match[0],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    }))
    .filter((segment) => segment.text.trim())
}

async function embeddingBoundaries(
  document: CruxDocument,
  segments: Array<{ text: string; start: number; end: number }>,
  dense: DenseEmbedding,
  options: { minChars: number; maxChars: number; similarityThreshold?: number },
): Promise<SemanticBoundary[]> {
  if (segments.length <= 1) {
    return [{ start: 0, end: document.content.length, reason: 'single-segment' }]
  }
  const embeddings = await dense.embedMany(segments.map((segment) => segment.text))
  const boundaries: SemanticBoundary[] = []
  let startSegment = 0
  let currentLength = 0
  for (let index = 0; index < segments.length; index++) {
    currentLength += segments[index].text.length
    const nextScore = index < segments.length - 1 ? cosineSimilarity(embeddings[index], embeddings[index + 1]) : 1
    const shouldSplit =
      currentLength >= options.maxChars ||
      (currentLength >= options.minChars && nextScore < (options.similarityThreshold ?? 0.75))
    if (shouldSplit || index === segments.length - 1) {
      boundaries.push({
        start: segments[startSegment].start,
        end: segments[index].end,
        reason: shouldSplit ? 'semantic-boundary' : 'final',
        confidence: shouldSplit ? 1 - nextScore : 1,
      })
      startSegment = index + 1
      currentLength = 0
    }
  }
  return boundaries
}

function normalizeBoundaries(boundaries: SemanticBoundary[], contentLength: number): SemanticBoundary[] {
  if (!boundaries.length) return [{ start: 0, end: contentLength, reason: 'fallback' }]
  return boundaries
    .map((boundary) => ({
      ...boundary,
      start: Math.max(0, Math.min(boundary.start, contentLength)),
      end: Math.max(0, Math.min(boundary.end, contentLength)),
    }))
    .filter((boundary) => boundary.end > boundary.start)
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index]
    normA += a[index] * a[index]
    normB += b[index] * b[index]
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dot / denominator
}

function splitDocument(content: string, options: Required<ChunkingOptions>): string[] {
  if (content.length <= options.maxChars) {
    return [content]
  }

  const paragraphs = content
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  const chunks: string[] = []
  let current = ''

  for (const paragraph of paragraphs.length > 0 ? paragraphs : [content]) {
    if (paragraph.length > options.maxChars) {
      flushCurrent()
      for (const piece of splitLargeParagraph(paragraph, options.maxChars)) {
        pushChunk(piece)
      }
      continue
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (candidate.length <= options.maxChars) {
      current = candidate
      continue
    }

    flushCurrent()
    current = paragraph
  }

  flushCurrent()
  return chunks

  function flushCurrent(): void {
    if (!current) return
    pushChunk(current)
    current = ''
  }

  function pushChunk(chunk: string): void {
    if (chunks.length === 0 || options.overlapChars <= 0) {
      chunks.push(chunk)
      return
    }

    const overlap = chunks[chunks.length - 1].slice(-Math.min(options.overlapChars, chunks[chunks.length - 1].length))
    chunks.push(overlap ? `${overlap}${chunk}` : chunk)
  }
}

function splitLargeParagraph(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph
    .match(/[^.!?]+[.!?]?\s*/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? [paragraph]
  const chunks: string[] = []
  let current = ''

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      for (let index = 0; index < sentence.length; index += maxChars) {
        chunks.push(sentence.slice(index, index + maxChars))
      }
      continue
    }

    const candidate = current ? `${current} ${sentence}` : sentence
    if (candidate.length <= maxChars) {
      current = candidate
      continue
    }

    if (current) {
      chunks.push(current)
    }
    current = sentence
  }

  if (current) {
    chunks.push(current)
  }

  return chunks
}

async function collect<T>(input: AsyncIterable<T> | T[]): Promise<T[]> {
  if (Array.isArray(input)) {
    return input
  }

  const items: T[] = []
  for await (const item of input) {
    items.push(item)
  }
  return items
}

function stableHash(value: unknown): string {
  const input = stableStringify(value)
  let hash = 5381
  for (let index = 0; index < input.length; index++) {
    hash = (hash * 33) ^ input.charCodeAt(index)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

async function listAll(store: DataStore, prefix: string): Promise<StoreEntry[]> {
  const entries: StoreEntry[] = []
  let cursor: string | undefined

  while (true) {
    const page = await store.list(prefix, { cursor, limit: 100 })
    entries.push(...page.entries)
    if (!page.cursor) {
      return entries
    }
    cursor = page.cursor
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values))
}

function namespacePrefix(indexerId: string, namespace: string): string {
  return `indexer:${indexerId}:namespace:${namespace}:`
}

function sourcePrefix(indexerId: string, namespace: string, sourceId: string): string {
  return `${namespacePrefix(indexerId, namespace)}source:${sourceId}:`
}

function chunkKey(indexerId: string, namespace: string, sourceId: string, chunkId: string): string {
  return `${sourcePrefix(indexerId, namespace, sourceId)}chunk:${chunkId}`
}

function parentKey(indexerId: string, namespace: string, sourceId: string, parentId: string): string {
  return `${sourcePrefix(indexerId, namespace, sourceId)}parent:${parentId}`
}

function vectorMetadata(value: JsonObject): Record<string, unknown> {
  return {
    _cruxRecordType: value._cruxRecordType,
    namespace: value.namespace,
    sourceId: value.sourceId,
    chunkId: value.chunkId,
    generationId: value.generationId,
    active: value.active,
    ...(isRecord(value.metadata) ? value.metadata : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export type { SparseVector }

let indexOperationCounter = 0

async function runIndexOperation<T extends IndexResult | IndexDryRunResult | number>(args: {
  indexerId: string
  namespace: string
  operation: 'indexDocuments' | 'indexChunks' | 'deleteSource' | 'clear'
  sourceCount: number
  chunkCount: number
  replaceSources?: boolean
  sourceId?: string
  dryRun?: boolean
  instrument?: boolean
  run: () => Promise<T>
}): Promise<T> {
  const startedAt = Date.now()
  const indexId = `${startedAt}-index-${++indexOperationCounter}`
  const eventBase = {
    indexId,
    indexerId: args.indexerId,
    namespace: args.namespace,
    operation: args.operation,
    sourceCount: args.sourceCount,
    chunkCount: args.chunkCount,
    ...(args.replaceSources !== undefined ? { replaceSources: args.replaceSources } : {}),
    ...(args.sourceId ? { sourceId: args.sourceId } : {}),
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
  }

  getRuntime().instrumentationHooks?.onIndexStart?.(eventBase)
  const span =
    args.instrument === false
      ? undefined
      : observe.openSpan({
          name: `${args.indexerId}.${args.operation}`,
          family: 'indexing',
          primitive: 'indexing.pipeline',
          attributes: eventBase,
        })

  try {
    const result = span ? await span.withContext(args.run) : await args.run()
    if (span) {
      span.withContext(() => {
        emitIndexingOutputArtifact(span.spanId, {
          ...eventBase,
          operation: args.operation,
          deletedCount: typeof result === 'number' ? result : undefined,
          stages: typeof result === 'number' ? undefined : result.stages,
        })
      })
      span.end({
        ...(typeof result === 'number'
          ? { deletedCount: result }
          : { sourceCount: result.sourceCount, chunkCount: result.chunkCount }),
      })
    }
    getRuntime().instrumentationHooks?.onIndexEnd?.({
      ...eventBase,
      durationMs: Date.now() - startedAt,
      ...(typeof result === 'number' ? { deletedCount: result } : {}),
      ...(typeof result === 'number' || !result.stages ? {} : { stages: result.stages }),
    })
    return result
  } catch (error) {
    getRuntime().instrumentationHooks?.onIndexEnd?.({
      ...eventBase,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
    span?.error(error)
    throw error
  }
}
