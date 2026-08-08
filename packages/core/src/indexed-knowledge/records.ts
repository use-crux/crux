/**
 * Record codecs for the indexed knowledge read model.
 *
 * These functions translate between domain chunks, persisted JSON records, and
 * retrieval hits. Callers outside this module should not spell record type
 * strings or cast raw store values into retrieval objects.
 *
 * @module
 */

import type { CruxChunk, CruxParentChunk } from '../indexing/types'
import { validateStoredEvidence } from '../indexing/stored-evidence'
import type { ExactFilter, JsonObject, SearchLegMatch, SparseVector } from '../storage'
import type { RetrieverHit } from '../retrieval/types'
import { indexedParentKey } from './keys'
import { projectSourceFacts } from '../indexing/source-facts'

const indexedRecordTypes = {
  chunk: 'chunk',
  parent: 'parent',
} as const

type IndexedRecordType = (typeof indexedRecordTypes)[keyof typeof indexedRecordTypes]

type IndexedBaseRecord<TType extends IndexedRecordType> = {
  readonly _cruxRecordType: TType
  readonly namespace: string
  readonly sourceId: string
  readonly generationId: string
  readonly active: boolean
  readonly ordinal: number
  readonly content: string
  readonly metadata: Record<string, unknown>
  readonly source?: CruxChunk['source']
  readonly provenance?: CruxChunk['provenance']
  readonly evidence?: CruxChunk['evidence']
  readonly createdAt: number
  readonly updatedAt: number
}

/** Persisted child chunk record. */
export type IndexedChunkRecord = IndexedBaseRecord<'chunk'> & {
  readonly chunkId: string
  readonly parent?: NonNullable<CruxChunk['parent']>
  readonly embedding?: readonly number[]
  readonly sparseEmbedding?: SparseVector
}

/** Persisted parent chunk record. */
export type IndexedParentStoredRecord = IndexedBaseRecord<'parent'> & {
  readonly parentId: string
}

/** Filter that selects only active chunk records in the configured namespace. */
export function activeChunkFilter(namespace: string, filter?: ExactFilter): ExactFilter {
  return {
    ...(filter ?? {}),
    namespace,
    _cruxRecordType: indexedRecordTypes.chunk,
    active: true,
  }
}

/** Create the persisted JSON value for a child chunk. */
export function createIndexedChunkRecord(input: {
  readonly indexerId: string
  readonly generationId: string
  readonly chunk: CruxChunk
  readonly dense?: readonly number[]
  readonly sparse?: SparseVector
  readonly now: number
}): IndexedChunkRecord {
  const evidence = input.chunk.evidence ? validateStoredEvidence(input.chunk.evidence) : undefined
  if (evidence && (evidence.chunkId !== input.chunk.chunkId || evidence.normalizedContent !== input.chunk.content)) {
    throw new Error('Stored evidence must retain the indexed chunk ID and content exactly.')
  }
  const source = projectSourceFacts(input.chunk.source)
  const parent =
    input.chunk.parent?.parentId !== undefined
      ? {
          ...input.chunk.parent,
          key:
            input.chunk.parent.key ??
            indexedParentKey(input.indexerId, input.chunk.namespace, input.chunk.sourceId, input.chunk.parent.parentId),
        }
      : input.chunk.parent

  return {
    _cruxRecordType: indexedRecordTypes.chunk,
    namespace: input.chunk.namespace,
    sourceId: input.chunk.sourceId,
    chunkId: input.chunk.chunkId,
    generationId: input.generationId,
    active: true,
    ordinal: input.chunk.ordinal,
    content: input.chunk.content,
    metadata: input.chunk.metadata,
    ...(source ? { source } : {}),
    ...(parent ? { parent } : {}),
    ...(input.chunk.provenance ? { provenance: input.chunk.provenance } : {}),
    ...(evidence ? { evidence } : {}),
    ...(input.dense ? { embedding: input.dense } : {}),
    ...(input.sparse ? { sparseEmbedding: input.sparse } : {}),
    createdAt: input.now,
    updatedAt: input.now,
  }
}

/** Create the persisted JSON value for a parent chunk. */
export function createIndexedParentRecord(input: {
  readonly generationId: string
  readonly parent: CruxParentChunk
  readonly now: number
}): IndexedParentStoredRecord {
  const source = projectSourceFacts(input.parent.source)
  return {
    _cruxRecordType: indexedRecordTypes.parent,
    namespace: input.parent.namespace,
    sourceId: input.parent.sourceId,
    parentId: input.parent.parentId,
    generationId: input.generationId,
    active: true,
    ordinal: input.parent.ordinal,
    content: input.parent.content,
    metadata: input.parent.metadata,
    ...(source ? { source } : {}),
    ...(input.parent.provenance ? { provenance: input.parent.provenance } : {}),
    createdAt: input.now,
    updatedAt: input.now,
  }
}

/** Project the persisted fields copied into search metadata. */
export function indexedSearchMetadata(value: IndexedChunkRecord, embeddingSpace?: string): ExactFilter {
  return {
    _cruxRecordType: value._cruxRecordType,
    namespace: value.namespace,
    sourceId: value.sourceId,
    chunkId: value.chunkId,
    generationId: value.generationId,
    active: value.active,
    ...(embeddingSpace ? { embeddingSpace } : {}),
    ...scalarMetadata(value.metadata),
  }
}

/** Narrow an arbitrary JSON value to an active indexed parent record. */
export function asIndexedParentRecord(value: unknown): IndexedParentStoredRecord | null {
  if (
    !isRecord(value) ||
    value._cruxRecordType !== indexedRecordTypes.parent ||
    value.active !== true ||
    typeof value.sourceId !== 'string' ||
    typeof value.parentId !== 'string' ||
    typeof value.content !== 'string'
  ) {
    return null
  }

  return {
    ...value,
    sourceId: value.sourceId,
    parentId: value.parentId,
    content: value.content,
    metadata: isRecord(value.metadata) ? value.metadata : {},
    ...(isRecord(value.source) ? { source: projectSourceFacts(value.source) } : {}),
  } as IndexedParentStoredRecord
}

/** Map a persisted chunk record into a retriever hit. */
export function indexedChunkToHit(input: {
  readonly value: JsonObject
  readonly score: number
  readonly matches?: readonly SearchLegMatch[]
}): RetrieverHit | null {
  const value = input.value
  if (
    value._cruxRecordType === indexedRecordTypes.parent ||
    value.active === false ||
    typeof value.namespace !== 'string' ||
    typeof value.sourceId !== 'string' ||
    typeof value.chunkId !== 'string' ||
    typeof value.content !== 'string'
  ) {
    return null
  }

  const parent = isRecord(value.parent)
    ? {
        ...(typeof value.parent.parentId === 'string' ? { parentId: value.parent.parentId } : {}),
        ...(typeof value.parent.key === 'string' ? { key: value.parent.key } : {}),
        ...(typeof value.parent.title === 'string' ? { title: value.parent.title } : {}),
        ...(typeof value.parent.summary === 'string' ? { summary: value.parent.summary } : {}),
      }
    : undefined

  const source = projectSourceFacts(isRecord(value.source) ? value.source : undefined)
  let evidence: CruxChunk['evidence'] | undefined
  if (value.evidence !== undefined) {
    try {
      evidence = validateStoredEvidence(value.evidence)
    } catch {
      return null
    }
    if (evidence.chunkId !== value.chunkId || evidence.normalizedContent !== value.content) {
      return null
    }
  }
  const matches = input.matches?.map((match) => ({ ...match }))
  const provenance = {
    ...(isRecord(value.provenance) ? value.provenance : {}),
    ...(matches ? { matches } : {}),
  }

  return {
    namespace: value.namespace,
    source: { id: value.sourceId, ...(source ?? {}) },
    chunkId: value.chunkId,
    content: value.content,
    metadata: isRecord(value.metadata) ? value.metadata : {},
    score: input.score,
    ...(evidence ? { evidence } : {}),
    ...(parent && Object.keys(parent).length > 0 ? { parent } : {}),
    ...(Object.keys(provenance).length > 0 ? { provenance } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function scalarMetadata(metadata: Record<string, unknown>): ExactFilter {
  return Object.fromEntries(
    Object.entries(metadata).filter(([key, value]) => !SOURCE_METADATA_KEYS.has(key) && isExactFilterValue(value)),
  ) as ExactFilter
}

const SOURCE_METADATA_KEYS = new Set(['source', 'sourceId', 'sourceUrl', 'sourcePath', 'assetRef', 'location', 'mediaType'])

function isExactFilterValue(value: unknown): value is ExactFilter[string] {
  return (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean'
  )
}
