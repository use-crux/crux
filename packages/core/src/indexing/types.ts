/**
 * Type contracts for the indexing domain.
 *
 * Covers ingest documents/parts, chunks and parent chunks, provenance, the
 * chunking + transform pipeline, the {@link Indexer} and its results, and the
 * {@link Corpus} sync model (source records, hashing options, sync results).
 * {@link IndexerConfig} is internal.
 *
 * @module
 */

import type { DenseEmbedding, EmbeddingModality, SparseEmbedding } from '../embedding'
import type { Asset, AssetRef } from '../asset'
import type { OperationResultMeta } from '../observability'
import type { JsonObject, RecordStore, SearchStore, Storage } from '../storage'
import type { DeriveStage } from '../knowledge/derive/stage'
import type { StoredEvidence } from './stored-evidence'

/** A loaded source document, optionally split into typed parts. */
export interface CruxDocument {
  namespace: string
  sourceId: string
  /** Safe facts about the original source; never provider responses or bytes. */
  readonly source?: CruxSourceFacts
  /** Aggregate text content. Media-only documents may omit it. */
  content?: string
  /** Single-media shorthand expanded to a media ingest part before chunking. */
  asset?: Asset
  title?: string
  metadata?: Record<string, unknown>
  parts?: CruxIngestPart[]
  warnings?: CruxIngestWarning[]
}

/** An indexed content chunk. */
export interface CruxChunk {
  namespace: string
  sourceId: string
  /** Safe source projection inherited from the document and its part location. */
  readonly source?: CruxSourceFacts
  chunkId: string
  generationId?: string
  active?: boolean
  ordinal: number
  content: string
  /** Usable media for embedding only. This transient field is never persisted. */
  media?: {
    readonly asset: Asset
    readonly modality: Exclude<EmbeddingModality, 'text'>
    /** SHA-256 when bytes were available during normalization. */
    readonly sha256?: string
  }
  metadata: Record<string, unknown>
  /** Immutable schema-2 evidence for citation-capable retrieval. */
  evidence?: StoredEvidence
  parent?: {
    parentId?: string
    key?: string
    title?: string
    summary?: string
  }
  provenance?: ChunkProvenance
}

/** A parent chunk grouping several child chunks (parent-child chunking). */
export interface CruxParentChunk {
  namespace: string
  sourceId: string
  /** Safe source projection shared by the grouped child content. */
  readonly source?: CruxSourceFacts
  parentId: string
  generationId?: string
  active?: boolean
  ordinal: number
  content: string
  metadata: Record<string, unknown>
  provenance?: ChunkProvenance
}

/** A non-fatal warning emitted while ingesting a document. */
export interface CruxIngestWarning {
  code: string
  message: string
  partId?: string
  metadata?: Record<string, unknown>
}

/** Explicit source coordinates retained through indexing provenance. */
export type CruxSourceLocation =
  | { readonly type: 'page'; readonly pageNumber: number }
  | { readonly type: 'time'; readonly unit: 'seconds'; readonly start: number; readonly end: number }

/** Allowlisted source facts safe to persist with an indexed record. */
export interface CruxSourceFacts {
  readonly url?: string
  readonly path?: string
  readonly assetRef?: AssetRef
  readonly mediaType?: string
  readonly location?: CruxSourceLocation
}

/** An exact half-open range within a page part's content. */
export interface CruxIngestPageBlockSourceRange {
  readonly start: number
  readonly end: number
}

/** Provider-neutral narrative content nested beneath a page part. */
export interface CruxIngestPageTextBlock {
  readonly id: string
  readonly kind: 'text'
  readonly role: 'heading' | 'paragraph' | 'list' | 'code' | 'other'
  readonly content: string
  readonly headingPath?: readonly string[]
  readonly sourceRange?: CruxIngestPageBlockSourceRange
}

/** Provider-neutral tabular content nested beneath a page part. */
export interface CruxIngestPageTableBlock {
  readonly id: string
  readonly kind: 'table'
  readonly content: string
  readonly rows: readonly (readonly string[])[]
  readonly columns?: readonly string[]
  readonly headingPath?: readonly string[]
  readonly sourceRange?: CruxIngestPageBlockSourceRange
}

/** Exact spreadsheet cell facts owned by a structured table chunk. */
export interface SpreadsheetCellProvenance {
  /** Stable schema-2 TableCell ID. */
  readonly id: string
  readonly address: string
  readonly row: number
  readonly column: number
  readonly displayedValue: string
  readonly formula?: string
  readonly mergeMaster?: string
  readonly mergeRange?: string
}

/** Exact worksheet ownership retained through chunking and retrieval. */
export interface SpreadsheetProvenance {
  /** Stable schema-2 SheetBlock ID. */
  readonly sheetBlockId: string
  /** Stable schema-2 TableBlock ID. */
  readonly tableBlockId: string
  readonly sheet: string
  readonly index: number
  readonly range: string
  readonly cells: readonly SpreadsheetCellProvenance[]
}

/** Typed content block nested beneath a page part. */
export type CruxIngestPageBlock = CruxIngestPageTextBlock | CruxIngestPageTableBlock

/** A typed segment of an ingested document. */
export type CruxIngestPart = (
  {
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
      blocks?: readonly CruxIngestPageBlock[]
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
      /** Schema-2 worksheet coordinate ownership for this logical table. */
      spreadsheet?: SpreadsheetProvenance
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
  | {
      id: string
      kind: 'media'
      /** Usable media for embedding. Transient and never persisted. */
      asset: Asset
      /** Media modality, inferred from `asset.mediaType` when omitted. */
      modality?: Exclude<EmbeddingModality, 'text'>
      /** Optional text representation used by text renderers and retrieval tools. */
      caption?: string
      metadata?: Record<string, unknown>
    }
) & { readonly sourceLocation?: CruxSourceLocation }

/** Where a chunk's content came from in its source document. */
export interface ChunkProvenance {
  partIds?: string[]
  blockIds?: string[]
  pages?: number[]
  sheets?: string[]
  tables?: string[]
  jsonPaths?: string[]
  sourceLocations?: CruxSourceLocation[]
  /** Exact worksheet/range/cell ownership, never inferred from rendered text. */
  spreadsheets?: readonly SpreadsheetProvenance[]
  sourceSpans?: Array<{
    start: number
    end: number
    partId?: string
  }>
  confidence?: 'exact' | 'derived'
}

/** A load result that may have succeeded (document) or failed (error). */
export type CruxIngestLoadResultLike =
  | { ok: true; document: CruxDocument }
  | {
      ok: false
      namespace: string
      sourceId: string
      error: { message: string; stack?: string; code?: string; parser?: string }
      metadata?: Record<string, unknown>
    }

/** Character-based chunking sizes. */
export interface ChunkingOptions {
  maxChars?: number
  overlapChars?: number
}

/** Pipeline stage cache behavior. */
export type PipelineCacheMode = 'readwrite' | 'refresh' | 'bypass'

/** Pipeline cache configuration: off, on, or a store/scope override. */
export type PipelineCacheConfig =
  | false
  | true
  | {
      records?: RecordStore
      scope?: string
    }

/** The output of running a chunker over a document. */
export interface ChunkingResult {
  chunks: CruxChunk[]
  parents?: CruxParentChunk[]
  stages?: SourceStageRecord[]
}

/** Runtime context passed to a chunker. */
export interface ChunkerContext {
  chunking: Required<ChunkingOptions>
}

/** A chunker: splits a document into chunks. */
export interface Chunker {
  readonly _tag: 'Chunker'
  readonly name: string
  readonly version: string
  fingerprint(): string
  chunkDocument(document: CruxDocument, ctx: ChunkerContext): Promise<ChunkingResult> | ChunkingResult
}

/** Context passed to a document transform. */
export interface DocumentTransformContext {
  sourceHash: string
  markDerived(): void
}

/** A document-phase pipeline transform. */
export interface DocumentTransform {
  readonly _tag: 'DocumentTransform'
  readonly name: string
  readonly version: string
  readonly options?: JsonObject
  readonly fingerprint?: unknown
  run(document: CruxDocument, ctx: DocumentTransformContext): Promise<CruxDocument> | CruxDocument
}

/** Context passed to a chunk transform. */
export interface ChunkTransformContext {
  sourceHash: string
}

/** A chunk-phase pipeline transform. */
export interface ChunkTransform {
  readonly _tag: 'ChunkTransform'
  readonly name: string
  readonly version: string
  readonly options?: JsonObject
  readonly fingerprint?: unknown
  run(chunks: CruxChunk[], ctx: ChunkTransformContext): Promise<CruxChunk[]> | CruxChunk[]
}

/** A composed indexing pipeline: document transforms, a chunker, chunk transforms, and derive-stage config. */
export interface IndexingPipeline {
  readonly _tag: 'IndexingPipeline'
  readonly documents: readonly DocumentTransform[]
  readonly chunker: Chunker
  readonly chunks: readonly ChunkTransform[]
  readonly derive: readonly DeriveStage[]
  fingerprint(): string
}

/** Configuration for {@link indexingPipeline}. */
export interface IndexingPipelineConfig {
  documents?: DocumentTransform[]
  chunker?: Chunker
  chunks?: ChunkTransform[]
  /** Post-chunk derivation stages: relations and assertions. */
  derive?: readonly DeriveStage[]
}

/** Options for the structured chunker. */
export interface StructuredChunkerOptions extends ChunkingOptions {
  tableRowsPerChunk?: number
}

/** Options for the parent-child chunker. */
export interface ParentChildChunkerOptions {
  parentMaxChars?: number
  childMaxChars?: number
  childOverlapChars?: number
}

/** Options for the semantic chunker, per strategy. */
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

/** A semantic chunk boundary. */
export interface SemanticBoundary {
  start: number
  end: number
  reason?: string
  confidence?: number
}

/** A custom semantic segmentation function. */
export type SemanticSegmentFn = (
  input: { document: CruxDocument; segments: Array<{ text: string; start: number; end: number }> },
  ctx: { maxChars: number; minChars: number },
) => Promise<SemanticBoundary[]> | SemanticBoundary[]

/** The result of indexing documents/chunks. */
export interface IndexResult {
  namespace: string
  sourceCount: number
  chunkCount: number
  stages?: SourceStageRecord[]
  /** Connected-knowledge derivation summary, present only when configured. */
  readonly knowledge?: ConnectedKnowledgeSummary
  dryRun?: false
  /** Exact `indexing.pipeline` operation that produced this summary. */
  readonly _meta: OperationResultMeta
}

/** Connected-knowledge derivation diagnostics returned by indexing mutations. */
export interface ConnectedKnowledgeSummary {
  /** Per-derive-stage aggregate over indexed active sources. */
  readonly stages: readonly ConnectedKnowledgeStageSummary[]
}

/** Aggregate result for one connected-knowledge derive stage. */
export interface ConnectedKnowledgeStageSummary {
  /** Authored derive stage id. */
  readonly stageId: string
  /** Number of sources that ran or reused cached claims for this stage. */
  readonly status: {
    readonly ran: number
    readonly cached: number
  }
  /** Total validated claims available for this stage. */
  readonly claims: number
  /** Deterministic bounded diagnostics emitted while deriving this stage. */
  readonly warnings: readonly string[]
}

/** The result of a dry-run index: chunks/parents without persistence. */
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
  /** Exact `indexing.pipeline` operation that produced this dry-run summary. */
  readonly _meta: OperationResultMeta
}

/** Options affecting the indexer fingerprint. */
export interface IndexFingerprintOptions {
  chunking?: ChunkingOptions
  indexVersion?: string
}

/** An indexer: turns documents/chunks into stored, optionally embedded records. */
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
    options: { dryRun: true; replaceSources?: boolean; cache?: PipelineCacheMode },
  ): Promise<IndexDryRunResult>
  indexChunks(
    chunks: AsyncIterable<CruxChunk> | CruxChunk[],
    options?: { dryRun?: false; replaceSources?: boolean; cache?: PipelineCacheMode },
  ): Promise<IndexResult>
  fingerprint(options?: IndexFingerprintOptions): string
  deleteSource(sourceId: string): Promise<number>
  clear(): Promise<number>
}

/** Configuration for {@link indexer}. Internal. */
export interface IndexerConfig<
  TModality extends EmbeddingModality = 'text',
> {
  id: string
  namespace: string
  records?: RecordStore
  search?: SearchStore
  storage?: Storage
  dense?: DenseEmbedding<TModality>
  sparse?: SparseEmbedding
  pipeline?: IndexingPipeline
  cache?: PipelineCacheConfig
}

/** The lifecycle status of a corpus source. */
export type SourceStatus = 'indexed' | 'failed' | 'deleted'
/** How a corpus sync handles changed sources. */
export type CorpusSyncMode = 'replaceChanged' | 'appendOnly'
/** How a corpus sync handles stale (unseen) sources. */
export type CorpusStalePolicy = 'keep' | 'delete'
/** Whether a sync's input is the partial or complete source set. */
export type CorpusSourceSet = 'partial' | 'complete'

/** A captured error for a source. */
export interface SourceError {
  message: string
  stack?: string
}

/** A trace record for one pipeline stage applied to a source. */
export interface SourceStageRecord {
  name: string
  kind?: 'parser' | 'document-transform' | 'chunker' | 'chunk-transform' | 'embedding' | 'promotion' | 'sync'
  /** Distinguishes dense from sparse records when `kind` is `embedding`. */
  embeddingKind?: 'dense' | 'sparse'
  /** Role passed to the embedding provider for embedding stages. */
  role?: 'query' | 'document'
  /** Privacy-safe counts of inputs by modality. */
  modalityCounts?: Partial<Record<EmbeddingModality, number>>
  /** Dense namespace-space digest, never the full fingerprint. */
  embeddingSpace?: string
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

/** The persisted state of a corpus source. */
export interface SourceRecord {
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

/** Options controlling how a source's content/metadata hashes are computed. */
export interface SourceHashOptions {
  normalizeContent?: (content: string) => string
  metadata?: 'stable' | 'none' | 'all'
  includeMetadata?: string[]
  excludeMetadata?: string[]
  hashDocument?: (document: CruxDocument, defaults: SourceHashDefaults) => SourceHashInput
}

/** Default inputs available to a custom {@link SourceHashOptions.hashDocument}. */
export interface SourceHashDefaults {
  normalizedContent: string
  stableMetadata: Record<string, unknown>
}

/** The content/metadata used to compute a source hash. */
export interface SourceHashInput {
  content: unknown
  metadata?: unknown
}

/** Configuration for {@link corpus}. */
export interface CorpusConfig {
  id: string
  namespace: string
  records?: RecordStore
  indexer: Indexer
  hash?: SourceHashOptions
  indexVersion?: string
}

/** Options for {@link Corpus.sync}. */
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

/** Options for {@link Corpus.listSources}. */
export interface SourceListOptions {
  status?: SourceStatus | SourceStatus[]
  includeDeleted?: boolean
  limit?: number
  cursor?: string
}

/** The per-source outcome of a sync. */
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

/** The aggregate result of a {@link Corpus.sync}. */
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
  /** Connected-knowledge derivation summary, present only when configured. */
  readonly knowledge?: ConnectedKnowledgeSummary
  /** Exact `corpus.sync` operation that produced this aggregate summary. */
  readonly _meta: OperationResultMeta
}

/** A per-source progress event emitted during a sync. */
export type CorpusProgressEvent = CorpusSourceResult & {
  syncId: string
  corpusId: string
  namespace: string
  dryRun: boolean
}

/** The result of deleting a single source. */
export interface SourceDeleteResult {
  sourceId: string
  deletedCount: number
}

/** The result of clearing all sources. */
export interface SourceClearResult {
  deletedCount: number
  sourceCount: number
}

/** A corpus: tracks sources and syncs them through an {@link Indexer}. */
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
