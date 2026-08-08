/**
 * Indexing domain: turn documents into stored, embedded, retrievable chunks.
 *
 * Public entry point for the indexing pipeline. Compose document/chunk
 * {@link transform}s and a {@link chunker} into an {@link indexingPipeline}, build
 * an {@link indexer} to chunk + embed + persist documents, and wrap it in a
 * {@link corpus} for source tracking and incremental {@link Corpus.sync}.
 *
 * The implementation is split into focused modules (chunkers, pipeline, cache,
 * source hashing, observability, …); this barrel re-exports the supported API.
 *
 * @module
 */

export type { SparseVector } from '../storage'

export { transform, chunker, indexingPipeline } from './pipeline'
export { indexer } from './define-indexer'
export { corpus } from './define-corpus'
export { IngestedDocumentContractError, validateIngestedDocument } from './ingested-document'
export {
  StoredEvidenceContractError,
  createStoredEvidence,
  deserializeStoredEvidence,
  serializeStoredEvidence,
  validateStoredEvidence,
} from './stored-evidence'
export { normalizeXlsxDocument } from './normalize-ingested-document'
export type {
  ApplicationOperationProducer,
  DocumentAsset,
  DocumentBlock,
  DocumentProducer,
  DocumentSource,
  IngestDiagnostic,
  IngestedDocument,
  IngestFormat,
  Inline,
  ListBlock,
  ListItem,
  PageBlock,
  ParserIdentity,
  Scalar,
  SheetBlock,
  SlideBlock,
  SourceCoordinate,
  TableBlock,
  TableCell,
  TextBlock,
} from './ingested-document'
export type { StoredEvidence, StoredEvidenceDocument, StoredEvidenceOrigin } from './stored-evidence'

export type {
  // Documents, chunks, and provenance
  CruxDocument,
  CruxChunk,
  CruxParentChunk,
  CruxIngestWarning,
  CruxIngestPart,
  CruxIngestPageBlock,
  CruxIngestPageTextBlock,
  CruxIngestPageTableBlock,
  CruxIngestPageBlockSourceRange,
  CruxSourceLocation,
  CruxSourceFacts,
  ChunkProvenance,
  SpreadsheetCellProvenance,
  SpreadsheetProvenance,
  CruxIngestLoadResultLike,
  // Chunking + pipeline
  ChunkingOptions,
  ChunkingResult,
  ChunkerContext,
  Chunker,
  DocumentTransformContext,
  DocumentTransform,
  ChunkTransformContext,
  ChunkTransform,
  IndexingPipeline,
  IndexingPipelineConfig,
  StructuredChunkerOptions,
  ParentChildChunkerOptions,
  SemanticChunkerOptions,
  SemanticBoundary,
  SemanticSegmentFn,
  // Caching
  PipelineCacheMode,
  PipelineCacheConfig,
  // Indexer
  ConnectedKnowledgeStageSummary,
  ConnectedKnowledgeSummary,
  IndexResult,
  IndexDryRunResult,
  IndexFingerprintOptions,
  Indexer,
  // Corpus
  SourceStatus,
  CorpusSyncMode,
  CorpusStalePolicy,
  CorpusSourceSet,
  SourceError,
  SourceStageRecord,
  SourceRecord,
  SourceHashOptions,
  SourceHashDefaults,
  SourceHashInput,
  CorpusConfig,
  CorpusSyncOptions,
  SourceListOptions,
  CorpusSourceResult,
  CorpusSyncResult,
  CorpusProgressEvent,
  SourceDeleteResult,
  SourceClearResult,
  Corpus,
} from './types'
