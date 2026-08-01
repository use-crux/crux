/**
 * Virtual structural graph projection over indexed knowledge records.
 *
 * Hierarchy and chunk sequence relations are projected on read from active
 * indexed chunk and parent records. Source and asset provenance remains a
 * record fact surfaced by hydration, not an edge, because {@link KnowledgeRef}
 * has no asset reference kind.
 *
 * @module
 */

import type { JsonObject, RecordStore } from '../storage'
import { indexedSourcePrefix, listIndexedEntries } from '../indexed-knowledge/keys'
import type {
  KnowledgeGraphReader,
  KnowledgeNeighbor,
  StructuralRelationType,
} from './graph-types'
import { encodeKnowledgeRef, type KnowledgeRef } from './refs'

/** Configuration for {@link createStructuralGraphReader}. */
export interface StructuralGraphReaderConfig {
  /** Indexed knowledge record store to read from. */
  readonly records: RecordStore
  /** Indexer id used by persisted indexed knowledge keys. */
  readonly indexerId: string
  /** Namespace whose active indexed records are visible to the reader. */
  readonly namespace: string
}

/** Create a read-only graph reader for virtual structural relations.
 *
 * @example
 * ```ts
 * const graph = createStructuralGraphReader({ records, indexerId: 'docs', namespace: 'kb' })
 * const neighbors = await graph.neighbors({ kind: 'document', sourceId: 'guide' })
 * ```
 */
export function createStructuralGraphReader(config: StructuralGraphReaderConfig): KnowledgeGraphReader {
  async function neighbors(ref: KnowledgeRef, options: StructuralNeighborOptions = {}): Promise<KnowledgeNeighbor[]> {
    const sourceId = sourceIdOf(ref)
    if (!sourceId) return []

    const state = await loadSourceState(config, sourceId)
    const candidates = [
      ...hierarchyNeighbors(ref, state),
      ...sequenceNeighbors(ref, state),
    ]

    return candidates
      .filter((neighbor) => includesType(options.types, neighbor.type))
      .filter((neighbor) => options.direction === undefined || neighbor.direction === options.direction)
      .sort(compareOrderedNeighbors)
      .slice(0, normalizeLimit(options.limit))
      .map(({ ref, type, direction }) => ({ ref, type, direction }))
  }

  return Object.freeze({ neighbors })
}

type StructuralNeighborOptions = {
  readonly types?: readonly string[]
  readonly direction?: KnowledgeNeighbor['direction']
  readonly limit?: number
}

type OrderedNeighbor = KnowledgeNeighbor & {
  readonly ordinal: number
}

type ActiveChunk = {
  readonly sourceId: string
  readonly chunkId: string
  readonly ordinal: number
  readonly parentId?: string
}

type ActiveParent = {
  readonly sourceId: string
  readonly parentId: string
  readonly ordinal: number
}

type SourceState = {
  readonly parents: readonly ActiveParent[]
  readonly chunks: readonly ActiveChunk[]
  readonly parentsById: ReadonlyMap<string, ActiveParent>
}

async function loadSourceState(config: StructuralGraphReaderConfig, sourceId: string): Promise<SourceState> {
  const entries = await listIndexedEntries(config.records, indexedSourcePrefix(config.indexerId, config.namespace, sourceId))
  const parents = entries.flatMap((entry) => {
    const parent = asActiveParent(entry.value, config.namespace, sourceId)
    return parent ? [parent] : []
  })
  const chunks = entries.flatMap((entry) => {
    const chunk = asActiveChunk(entry.value, config.namespace, sourceId)
    return chunk ? [chunk] : []
  })
  const byRecordOrder = (left: ActiveParent | ActiveChunk, right: ActiveParent | ActiveChunk): number =>
    left.ordinal - right.ordinal || stableRecordId(left).localeCompare(stableRecordId(right))

  const sortedParents = [...parents].sort(byRecordOrder)
  const sortedChunks = [...chunks].sort(byRecordOrder)

  return {
    parents: sortedParents,
    chunks: sortedChunks,
    parentsById: new Map(sortedParents.map((parent) => [parent.parentId, parent])),
  }
}

function hierarchyNeighbors(ref: KnowledgeRef, state: SourceState): OrderedNeighbor[] {
  if (ref.kind === 'document') {
    return [
      ...state.parents.map((parent) =>
        neighbor(parentRef(parent), 'hierarchy', 'out', parent.ordinal),
      ),
      ...state.chunks
        .filter((chunk) => chunk.parentId === undefined)
        .map((chunk) => neighbor(chunkRef(chunk), 'hierarchy', 'out', chunk.ordinal)),
    ]
  }

  if (ref.kind === 'parent') {
    const parent = state.parentsById.get(ref.parentId)
    if (!parent) return []
    return [
      neighbor({ kind: 'document', sourceId: ref.sourceId }, 'hierarchy', 'in', parent.ordinal),
      ...state.chunks
        .filter((chunk) => chunk.parentId === ref.parentId)
        .map((chunk) => neighbor(chunkRef(chunk), 'hierarchy', 'out', chunk.ordinal)),
    ]
  }

  if (ref.kind === 'chunk') {
    const chunk = state.chunks.find((candidate) => candidate.chunkId === ref.chunkId)
    if (!chunk) return []
    const parent = chunk.parentId ? state.parentsById.get(chunk.parentId) : undefined
    return [
      parent
        ? neighbor(parentRef(parent), 'hierarchy', 'in', parent.ordinal)
        : neighbor({ kind: 'document', sourceId: ref.sourceId }, 'hierarchy', 'in', chunk.ordinal),
    ]
  }

  return []
}

function sequenceNeighbors(ref: KnowledgeRef, state: SourceState): OrderedNeighbor[] {
  if (ref.kind !== 'chunk') return []

  const index = state.chunks.findIndex((chunk) => chunk.chunkId === ref.chunkId)
  if (index < 0) return []

  return [
    ...(state.chunks[index + 1] ? [neighbor(chunkRef(state.chunks[index + 1]), 'sequence', 'out', state.chunks[index + 1].ordinal)] : []),
    ...(state.chunks[index - 1] ? [neighbor(chunkRef(state.chunks[index - 1]), 'sequence', 'in', state.chunks[index - 1].ordinal)] : []),
  ]
}

function neighbor(
  ref: KnowledgeRef,
  type: StructuralRelationType,
  direction: KnowledgeNeighbor['direction'],
  ordinal: number,
): OrderedNeighbor {
  return { ref, type, direction, ordinal }
}

function includesType(types: readonly string[] | undefined, type: string): boolean {
  return types === undefined || types.includes(type)
}

function compareOrderedNeighbors(left: OrderedNeighbor, right: OrderedNeighbor): number {
  return (
    left.ordinal - right.ordinal ||
    encodeKnowledgeRef(left.ref).localeCompare(encodeKnowledgeRef(right.ref)) ||
    left.type.localeCompare(right.type) ||
    left.direction.localeCompare(right.direction)
  )
}

function normalizeLimit(limit: number | undefined): number {
  return limit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(limit))
}

function sourceIdOf(ref: KnowledgeRef): string | null {
  switch (ref.kind) {
    case 'document':
    case 'parent':
    case 'chunk':
      return ref.sourceId
    case 'entity':
      return null
  }
}

function parentRef(parent: ActiveParent): KnowledgeRef {
  return { kind: 'parent', sourceId: parent.sourceId, parentId: parent.parentId }
}

function chunkRef(chunk: ActiveChunk): KnowledgeRef {
  return { kind: 'chunk', sourceId: chunk.sourceId, chunkId: chunk.chunkId }
}

function stableRecordId(record: ActiveParent | ActiveChunk): string {
  return 'chunkId' in record ? record.chunkId : record.parentId
}

function asActiveChunk(value: JsonObject, namespace: string, sourceId: string): ActiveChunk | null {
  if (
    value._cruxRecordType !== 'chunk' ||
    value.active !== true ||
    value.namespace !== namespace ||
    value.sourceId !== sourceId ||
    typeof value.chunkId !== 'string' ||
    typeof value.ordinal !== 'number' ||
    !Number.isFinite(value.ordinal)
  ) {
    return null
  }

  const parentId = isRecord(value.parent) && typeof value.parent.parentId === 'string' ? value.parent.parentId : undefined
  return {
    sourceId,
    chunkId: value.chunkId,
    ordinal: value.ordinal,
    ...(parentId ? { parentId } : {}),
  }
}

function asActiveParent(value: JsonObject, namespace: string, sourceId: string): ActiveParent | null {
  if (
    value._cruxRecordType !== 'parent' ||
    value.active !== true ||
    value.namespace !== namespace ||
    value.sourceId !== sourceId ||
    typeof value.parentId !== 'string' ||
    typeof value.ordinal !== 'number' ||
    !Number.isFinite(value.ordinal)
  ) {
    return null
  }

  return { sourceId, parentId: value.parentId, ordinal: value.ordinal }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
