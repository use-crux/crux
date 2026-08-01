/**
 * Helper routines for the knowledge base runtime.
 *
 * @module
 */

import { indexedNamespacePrefix, listIndexedEntries } from '../indexed-knowledge/keys'
import { indexer } from '../indexing'
import type { CorpusSyncResult, CruxChunk, CruxDocument, CruxIngestLoadResultLike, IndexResult } from '../indexing'
import type { EmbeddingModality } from '../embedding'
import type { JsonObject, RecordStore } from '../storage'
import type { KnowledgeBaseMetadataFailure } from './knowledge-base-metadata'
import type {
  KnowledgeBaseIndexInput,
  KnowledgeBaseIndexItem,
  KnowledgeBaseLifecycleState,
  KnowledgeBaseRuntimeConfig,
  KnowledgeBaseSource,
} from './knowledge-base-runtime'

/** Result of a knowledge-base indexing attempt after metadata partitioning. */
export interface KnowledgeBaseIndexRun {
  readonly result?: IndexResult | CorpusSyncResult
  readonly failures: readonly KnowledgeBaseMetadataFailure[]
  readonly indexed: boolean
  readonly sourceIds?: readonly string[]
}

/** Resolve direct or configured index input into an array. Internal. */
export async function resolveKnowledgeBaseInput(
  source: KnowledgeBaseSource | undefined,
  input: KnowledgeBaseIndexInput | undefined,
): Promise<readonly KnowledgeBaseIndexItem[]> {
  const resolved = input ?? (typeof source === 'function' ? await source() : source)
  if (!resolved) {
    throw new Error('knowledgeBase().index() requires input documents/chunks or a configured source.')
  }
  if (isAsyncIterable(resolved)) {
    const items: KnowledgeBaseIndexItem[] = []
    for await (const item of resolved) items.push(item)
    return items
  }
  return [...resolved]
}

/** Refresh lifecycle counters from active indexed records. Internal. */
export async function refreshKnowledgeBaseLifecycleState(
  state: KnowledgeBaseLifecycleState,
  indexerId: string,
  namespace: string,
  records: RecordStore | undefined,
): Promise<void> {
  if (!records) return
  const entries = await listIndexedEntries(records, indexedNamespacePrefix(indexerId, namespace))
  const chunks = entries
    .map((entry) => entry.value)
    .filter((value): value is JsonObject => value._cruxRecordType === 'chunk')
  const activeChunks = chunks.filter((value) => value.active === true)
  state.indexedSources = uniqueStrings(activeChunks.flatMap((value) => (typeof value.sourceId === 'string' ? [value.sourceId] : []))).length
  state.indexedChunks = activeChunks.length
  state.retainedInactiveChunks = chunks.length - activeChunks.length
  state.lastIndexedAt = Date.now()
}

/** Convert one accepted item to a document for direct document indexing. Internal. */
export function toKnowledgeBaseDocument(item: KnowledgeBaseIndexItem): CruxDocument {
  if (isKnowledgeBaseChunk(item)) {
    throw new Error('knowledgeBase().index() input cannot mix chunks with documents.')
  }
  if (isLoadResult(item)) {
    if (item.ok) return item.document
    throw new Error(`knowledgeBase().index() cannot index failed load result "${item.sourceId}".`)
  }
  return item
}

/** Convert one accepted item to corpus sync input. Internal. */
export function toKnowledgeBaseCorpusInput(item: KnowledgeBaseIndexItem): CruxDocument | CruxIngestLoadResultLike {
  if (isKnowledgeBaseChunk(item)) {
    throw new Error('knowledgeBase({ corpus }).index() accepts documents or loader results, not chunks.')
  }
  return item
}

/** Return source ids represented by one corpus sync input. Internal. */
export function knowledgeBaseSourceIds(item: CruxDocument | CruxIngestLoadResultLike): readonly string[] {
  if ('ok' in item) return item.ok ? [item.document.sourceId] : [item.sourceId]
  return [item.sourceId]
}

/** Return whether a knowledge-base index item is already chunked. Internal. */
export function isKnowledgeBaseChunk(item: KnowledgeBaseIndexItem): item is CruxChunk {
  return 'chunkId' in item && typeof item.chunkId === 'string' && 'ordinal' in item
}

/** Dedupe strings while preserving first occurrence order. Internal. */
export function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

/** Return an indexing result for a batch whose metadata all failed. Internal. */
export function emptyMetadataFailureRun(failures: readonly KnowledgeBaseMetadataFailure[]): KnowledgeBaseIndexRun {
  return { failures, indexed: false }
}

/** Create the indexer backing direct knowledge-base source mutations. Internal. */
export function createKnowledgeBaseIndexer<TModality extends EmbeddingModality>(
  config: KnowledgeBaseRuntimeConfig<TModality>,
  records: RecordStore | undefined,
  vectors: Parameters<typeof indexer>[0]['vectors'] | undefined,
) {
  return indexer({
    id: config.id,
    namespace: config.namespace,
    records,
    vectors,
    storage: config.storage,
    dense: config.embeddings,
    sparse: config.sparseEmbeddings,
    pipeline: config.pipeline,
    cache: config.cache,
  })
}

/** Physically delete replaced sources when lifecycle retention requests cleanup. Internal. */
export async function cleanupKnowledgeBaseSources(
  index: ReturnType<typeof indexer>,
  sourceIds: readonly string[],
): Promise<void> {
  await Promise.all(sourceIds.map((sourceId) => index.deleteSource(sourceId)))
}

function isLoadResult(item: KnowledgeBaseIndexItem): item is CruxIngestLoadResultLike {
  return 'ok' in item && typeof item.ok === 'boolean'
}

function isAsyncIterable(value: unknown): value is AsyncIterable<KnowledgeBaseIndexItem> {
  return value !== null && typeof value === 'object' && Symbol.asyncIterator in value
}
