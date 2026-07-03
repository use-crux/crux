/**
 * Store implementation for the indexed knowledge read model.
 *
 * The boundary owns active-generation semantics, vector metadata projection,
 * hit hydration, and parent lookup while remaining local-substitutable over the
 * core storage ports.
 *
 * @module
 */

import { StorageError } from '../storage'
import type { ExactFilter, JsonObject, VectorSearchQuery } from '../storage'
import type { RetrieverHit } from '../retrieval/types'
import { assertValidHydratedChunks, assertVectorHitsHydrated } from './hydration'
import type { IndexedHydrationMiss } from './hydration'
import {
  activeChunkFilter,
  asIndexedParentRecord,
  createIndexedChunkRecord,
  createIndexedParentRecord,
  indexedChunkToHit,
  indexedVectorMetadata,
} from './records'
import {
  indexedChunkKey,
  indexedNamespacePrefix,
  indexedParentKey,
  indexedSourcePrefix,
  listIndexedEntries,
} from './keys'
import type {
  IndexedChunkSearchQuery,
  IndexedKnowledgeStore,
  IndexedKnowledgeStoreConfig,
  IndexedParentRecord,
  IndexedParentRef,
  ParentExpansionOptions,
  PersistIndexedGenerationInput,
  PersistIndexedGenerationResult,
} from './types'

let generationCounter = 0

interface ScoredEntry {
  readonly key: string
  readonly value: JsonObject
  readonly score: number
}

/** Create an indexed knowledge read-model store from core storage ports. */
export function createIndexedKnowledgeStore(config: IndexedKnowledgeStoreConfig): IndexedKnowledgeStore {
  async function persistGeneration(input: PersistIndexedGenerationInput): Promise<PersistIndexedGenerationResult> {
    const generationId = createGenerationId()
    const now = input.now ?? Date.now()
    const sourceIds = unique([
      ...input.chunks.map((chunk) => chunk.sourceId),
      ...input.parents.map((parent) => parent.sourceId),
    ])

    for (let index = 0; index < input.chunks.length; index++) {
      const chunk = input.chunks[index]
      const record = createIndexedChunkRecord({
        indexerId: config.indexerId,
        generationId,
        chunk,
        dense: input.dense?.[index],
        sparse: input.sparse?.[index],
        now,
      })
      const key = indexedChunkKey(config.indexerId, chunk.namespace, chunk.sourceId, chunk.chunkId)
      await config.records.put(key, record as unknown as JsonObject)
      if (config.vectors && (input.dense?.[index] || input.sparse?.[index])) {
        await config.vectors.upsert([
          {
            key,
            ...(input.dense?.[index] ? { dense: [...input.dense[index]] } : {}),
            ...(input.sparse?.[index] ? { sparse: input.sparse[index] } : {}),
            metadata: indexedVectorMetadata(record),
          },
        ])
      }
    }

    for (const parent of input.parents) {
      await config.records.put(
        indexedParentKey(config.indexerId, parent.namespace, parent.sourceId, parent.parentId),
        createIndexedParentRecord({ generationId, parent, now }) as unknown as JsonObject,
      )
    }

    if (input.replaceSources) {
      await deactivatePreviousGenerations(sourceIds, generationId)
    }

    return { generationId, sourceCount: sourceIds.length, chunkCount: input.chunks.length }
  }

  async function searchChunks(query: IndexedChunkSearchQuery): Promise<readonly RetrieverHit[]> {
    const filter = activeChunkFilter(config.namespace, query.filter)
    const scored = await searchScoredEntries(query, filter)
    const hits = scored.flatMap((entry) => {
      const hit = indexedChunkToHit({ value: entry.value, score: entry.score })
      return hit ? [hit] : []
    })
    assertValidHydratedChunks({ scoredKeys: scored.map((entry) => entry.key), hitCount: hits.length })
    return hits
  }

  async function getParent(ref: IndexedParentRef): Promise<IndexedParentRecord | null> {
    const key = ref.key ?? (ref.parentId ? indexedParentKey(config.indexerId, config.namespace, ref.sourceId, ref.parentId) : undefined)
    if (!key) return null
    const record = asIndexedParentRecord(await config.records.get(key))
    if (!record) return null
    return {
      parentId: record.parentId,
      sourceId: record.sourceId,
      content: record.content,
      metadata: record.metadata,
    }
  }

  async function expandParent(hit: Parameters<IndexedKnowledgeStore['expandParent']>[0], options: ParentExpansionOptions = {}) {
    const key = hit.parent?.key
    const parentId = hit.parent?.parentId
    if (!key && !parentId) return hit

    const parent = await getParent({ sourceId: hit.sourceId, parentId, key })
    if (!parent) {
      const warning = `parentExpand could not find parent record "${key ?? parentId}" for ${hit.sourceId}/${hit.chunkId}.`
      if (options.missing === 'error') throw new Error(warning)
      return hit
    }

    const content =
      options.maxParentChars !== undefined ? parent.content.slice(0, options.maxParentChars) : parent.content
    return {
      ...hit,
      parent: {
        ...(hit.parent ?? {}),
        parentId: parent.parentId,
        ...(key ? { key } : {}),
        content,
        metadata: parent.metadata,
      },
    }
  }

  async function deactivatePreviousGenerations(
    sourceIds: readonly string[],
    activeGenerationId: string,
  ): Promise<void> {
    for (const sourceId of sourceIds) {
      const entries = await listIndexedEntries(config.records, indexedSourcePrefix(config.indexerId, config.namespace, sourceId))
      for (const entry of entries) {
        if (entry.value.generationId !== activeGenerationId && entry.value.active === true) {
          await config.records.put(entry.key, { ...entry.value, active: false, updatedAt: Date.now() })
        }
      }
    }
  }

  async function deleteSource(sourceId: string): Promise<number> {
    return deleteEntries(indexedSourcePrefix(config.indexerId, config.namespace, sourceId))
  }

  async function clearNamespace(): Promise<number> {
    return deleteEntries(indexedNamespacePrefix(config.indexerId, config.namespace))
  }

  async function deleteEntries(prefix: string): Promise<number> {
    const entries = await listIndexedEntries(config.records, prefix)
    for (const entry of entries) {
      await config.records.delete(entry.key)
      await config.vectors?.delete([entry.key])
    }
    return entries.length
  }

  async function searchScoredEntries(
    query: IndexedChunkSearchQuery,
    filter: ExactFilter,
  ): Promise<ScoredEntry[]> {
    if (config.vectors) {
      assertPreFilteredVectors(config.vectors.capabilities().filter)
      const vectorHits = await config.vectors.search(vectorSearchQuery(query, filter))
      const entries: ScoredEntry[] = []
      const hydrationFilter = activeChunkFilter(config.namespace)
      const misses: IndexedHydrationMiss[] = []
      for (const hit of vectorHits) {
        const value = await config.records.get(hit.key)
        if (!value) {
          misses.push({ key: hit.key, reason: 'missing_record' })
          continue
        }
        if (!matchesExactFilter(value, hydrationFilter)) {
          misses.push({ key: hit.key, reason: 'inactive_or_wrong_namespace' })
          continue
        }
        entries.push({ key: hit.key, value, score: hit.score })
      }
      assertVectorHitsHydrated({
        vectorHitCount: vectorHits.length,
        hydratedCount: entries.length,
        misses,
      })
      return entries
    }

    throw new Error('Indexed knowledge search requires vectors.')
  }

  return Object.freeze({
    persistGeneration,
    searchChunks,
    getParent,
    expandParent,
    deactivatePreviousGenerations,
    deleteSource,
    clearNamespace,
  })
}

function vectorSearchQuery(query: IndexedChunkSearchQuery, filter: ExactFilter): VectorSearchQuery {
  if (query.mode === 'dense') {
    if (!query.dense) throw new Error('Dense indexed knowledge search requires a dense query vector.')
    return {
      mode: 'dense',
      dense: [...query.dense],
      limit: query.limit,
      threshold: query.threshold,
      filter,
    }
  }
  if (query.mode === 'sparse') {
    if (!query.sparse) throw new Error('Sparse indexed knowledge search requires a sparse query vector.')
    return {
      mode: 'sparse',
      sparse: query.sparse,
      limit: query.limit,
      threshold: query.threshold,
      filter,
    }
  }
  if (!query.dense || !query.sparse) throw new Error('Hybrid indexed knowledge search requires dense and sparse vectors.')
  return {
    mode: 'hybrid',
    dense: [...query.dense],
    sparse: query.sparse,
    limit: query.limit,
    threshold: query.threshold,
    filter,
    fusion: query.fusion,
  }
}

function assertPreFilteredVectors(filterCapability: 'pre' | 'post' | false): void {
  if (filterCapability !== 'pre') {
    throw new StorageError(
      'unsupported_capability',
      'Indexed knowledge search requires a vector store with pre-filter support.',
    )
  }
}

function matchesExactFilter(value: JsonObject, filter: ExactFilter): boolean {
  return Object.entries(filter).every(([key, expected]) => value[key] === expected)
}

function createGenerationId(): string {
  return `gen_${Date.now().toString(36)}_${++generationCounter}`
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}
