/**
 * Unified graph reader over structural and persisted knowledge records.
 *
 * The store layers virtual indexed-knowledge structure with the current
 * published connected-knowledge generation and hydrates chunk references back
 * to retriever hits.
 *
 * @module
 */

import type { JsonObject, RecordEntry, RecordStore } from '../storage'
import { indexedChunkKey } from '../indexed-knowledge/keys'
import { indexedChunkToHit } from '../indexed-knowledge/records'
import type { RetrieverHit } from '../retrieval/types'
import { createKnowledgeGenerationStore } from './generation'
import type { KnowledgeGraphReader, KnowledgeNeighbor, KnowledgeNeighborOptions } from './graph-types'
import {
  knowledgeAdjacencyInPrefix,
  knowledgeAdjacencyOutPrefix,
  knowledgeEdgeKey,
} from './keys'
import { asKnowledgeEdgeRecord, type KnowledgeEdgeRecord } from './records'
import { encodeKnowledgeRef, isKnowledgeRef, type KnowledgeRef } from './refs'
import { createStructuralGraphReader } from './structural'

/** Configuration for {@link createKnowledgeGraphStore}. */
export interface KnowledgeGraphStoreConfig {
  /** JSON record store containing indexed and connected knowledge records. */
  readonly records: RecordStore
  /** Stable indexer id used by both record layers. */
  readonly indexerId: string
  /** Namespace whose graph records are visible. */
  readonly namespace: string
}

/** Unified graph reader plus chunk hydration. */
export interface KnowledgeGraphStore extends KnowledgeGraphReader {
  /** Hydrate an active chunk reference into a retriever hit. */
  hydrate(ref: KnowledgeRef): Promise<RetrieverHit | null>
}

/** Create a unified graph reader over virtual structure and persisted edges. */
export function createKnowledgeGraphStore(config: KnowledgeGraphStoreConfig): KnowledgeGraphStore {
  const structural = createStructuralGraphReader(config)
  const generations = createKnowledgeGenerationStore(config)
  let pinnedGeneration: Promise<string | null> | undefined

  async function neighbors(
    ref: KnowledgeRef,
    options: NeighborOptions = {},
  ): Promise<KnowledgeNeighbor[]> {
    const limit = normalizeLimit(options.limit)
    const structuralNeighbors = withOptionalEvidence(await structural.neighbors(ref, options), options)
    if (limit === 0) return []

    const generationId = await pinnedCurrentGeneration()
    const persisted = generationId ? await persistedNeighbors(ref, generationId, options) : []

    return [...structuralNeighbors, ...persisted].slice(0, limit)
  }

  async function hydrate(ref: KnowledgeRef): Promise<RetrieverHit | null> {
    if (ref.kind !== 'chunk') return null
    const value = await config.records.get(indexedChunkKey(config.indexerId, config.namespace, ref.sourceId, ref.chunkId))
    const hit = value ? indexedChunkToHit({ value, score: 0 }) : null
    return hit?.namespace === config.namespace ? hit : null
  }

  function pinnedCurrentGeneration(): Promise<string | null> {
    pinnedGeneration ??= generations.currentGeneration()
    return pinnedGeneration
  }

  return Object.freeze({ neighbors, hydrate })

  async function persistedNeighbors(
    ref: KnowledgeRef,
    generationId: string,
    options: NeighborOptions,
  ): Promise<KnowledgeNeighbor[]> {
    const directions = options.direction ? [options.direction] : ['out', 'in'] as const
    const entries = (
      await Promise.all(directions.map((direction) => listAdjacency(ref, generationId, direction)))
    ).flat()
    const pointers = entries.flatMap((entry) => parseAdjacencyPointer(entry, ref, generationId))
    const edgeValues = await getMany(
      pointers.map((pointer) =>
        knowledgeEdgeKey(config.indexerId, config.namespace, generationId, pointer.edgeId),
      ),
    )

    return pointers
      .flatMap((pointer, index) => {
        const edge = asVisibleEdge(edgeValues[index], generationId)
        if (!edge || !includesType(options.types, edge.type)) return []
        const peer = peerRef(edge, ref, pointer.direction, pointer.peer)
        return peer ? [{ ref: peer, type: edge.type, direction: pointer.direction, edgeId: edge.edgeId, evidence: edge.evidence }] : []
      })
      .sort(comparePersistedNeighbors)
      .map(({ ref, type, direction, evidence }) => ({
        ref,
        type,
        direction,
        ...(options.includeEvidence ? { evidence } : {}),
      }))
  }

  async function listAdjacency(
    ref: KnowledgeRef,
    generationId: string,
    direction: KnowledgeNeighbor['direction'],
  ): Promise<readonly RecordEntry[]> {
    const prefix = direction === 'out'
      ? knowledgeAdjacencyOutPrefix(config.indexerId, config.namespace, generationId, ref)
      : knowledgeAdjacencyInPrefix(config.indexerId, config.namespace, generationId, ref)
    const entries: RecordEntry[] = []
    let cursor: string | undefined

    do {
      const page = await config.records.list(prefix, { cursor, limit: 100 })
      entries.push(...page.entries)
      cursor = page.cursor
    } while (cursor)

    return entries
  }

  async function getMany(keys: readonly string[]): Promise<readonly (JsonObject | null)[]> {
    if (keys.length === 0) return []
    if (config.records.getMany) return config.records.getMany(keys)
    return Promise.all(keys.map((key) => config.records.get(key)))
  }

  function asVisibleEdge(value: JsonObject | null | undefined, generationId: string): KnowledgeEdgeRecord | null {
    const edge = asKnowledgeEdgeRecord(value)
    if (!edge) return null
    if (edge.generationId !== generationId || edge.namespace !== config.namespace) return null
    return edge
  }
}

type NeighborOptions = KnowledgeNeighborOptions

type PersistedNeighbor = KnowledgeNeighbor & {
  readonly edgeId: string
  readonly evidence: KnowledgeEdgeRecord['evidence']
}

type AdjacencyPointer = {
  readonly edgeId: string
  readonly direction: KnowledgeNeighbor['direction']
  readonly peer?: KnowledgeRef
}

function parseAdjacencyPointer(
  entry: RecordEntry,
  ref: KnowledgeRef,
  generationId: string,
): AdjacencyPointer[] {
  const value = entry.value
  const edgeId = typeof value.edgeId === 'string' ? value.edgeId : edgeIdFromKey(entry.key)
  if (!edgeId) return []

  return [{
    edgeId,
    direction: adjacencyDirection(entry.key, ref, generationId),
    ...(isKnowledgeRef(value.peerRef) ? { peer: value.peerRef } : {}),
    ...(isKnowledgeRef(value.ref) ? { peer: value.ref } : {}),
  }]
}

function edgeIdFromKey(key: string): string | null {
  const lastColon = key.lastIndexOf(':')
  return lastColon >= 0 && lastColon < key.length - 1 ? key.slice(lastColon + 1) : null
}

function adjacencyDirection(
  key: string,
  ref: KnowledgeRef,
  generationId: string,
): KnowledgeNeighbor['direction'] {
  const encoded = encodeKnowledgeRef(ref)
  return key.includes(`gen:${generationId}:adj:in:${encoded}:`) ? 'in' : 'out'
}

function peerRef(
  edge: KnowledgeEdgeRecord,
  ref: KnowledgeRef,
  direction: KnowledgeNeighbor['direction'],
  peer: KnowledgeRef | undefined,
): KnowledgeRef | null {
  if (peer && connects(edge, ref, peer, direction)) return peer
  if (direction === 'out') {
    if (sameRef(edge.from, ref)) return edge.to
    if (edge.direction === 'symmetric' && sameRef(edge.to, ref)) return edge.from
    return null
  }
  if (sameRef(edge.to, ref)) return edge.from
  if (edge.direction === 'symmetric' && sameRef(edge.from, ref)) return edge.to
  return null
}

function connects(
  edge: KnowledgeEdgeRecord,
  ref: KnowledgeRef,
  peer: KnowledgeRef,
  direction: KnowledgeNeighbor['direction'],
): boolean {
  if (direction === 'out') {
    return (
      sameRef(edge.from, ref) && sameRef(edge.to, peer) ||
      edge.direction === 'symmetric' && sameRef(edge.to, ref) && sameRef(edge.from, peer)
    )
  }
  return (
    sameRef(edge.to, ref) && sameRef(edge.from, peer) ||
    edge.direction === 'symmetric' && sameRef(edge.from, ref) && sameRef(edge.to, peer)
  )
}

function comparePersistedNeighbors(left: PersistedNeighbor, right: PersistedNeighbor): number {
  return (
    encodeKnowledgeRef(left.ref).localeCompare(encodeKnowledgeRef(right.ref)) ||
    left.type.localeCompare(right.type) ||
    left.edgeId.localeCompare(right.edgeId)
  )
}

function includesType(types: readonly string[] | undefined, type: string): boolean {
  return types === undefined || types.includes(type)
}

function normalizeLimit(limit: number | undefined): number {
  return limit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(limit))
}

function withOptionalEvidence(
  neighbors: readonly KnowledgeNeighbor[],
  options: NeighborOptions,
): readonly KnowledgeNeighbor[] {
  return options.includeEvidence
    ? neighbors.map((neighbor) => ({ ...neighbor, evidence: [] }))
    : neighbors
}

function sameRef(left: KnowledgeRef, right: KnowledgeRef): boolean {
  return encodeKnowledgeRef(left) === encodeKnowledgeRef(right)
}
