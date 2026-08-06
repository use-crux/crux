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
import { EmbeddingSpaceMismatchError } from '../embedding'
import type { ExactFilter, JsonObject, SearchLegMatch, SearchQuery } from '../storage'
import type { RetrieverHit } from '../retrieval/types'
import { assertSearchHitsHydrated, assertValidHydratedChunks } from './hydration'
import type { IndexedHydrationMiss } from './hydration'
import {
  activeChunkFilter,
  asIndexedParentRecord,
  createIndexedChunkRecord,
  createIndexedParentRecord,
  indexedChunkToHit,
  indexedSearchMetadata,
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
  readonly matches?: readonly SearchLegMatch[]
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
      if (config.search) {
        await config.search.upsert([
          {
            key,
            content: chunk.content,
            ...(input.dense?.[index] ? { dense: [...input.dense[index]] } : {}),
            ...(input.sparse?.[index] ? { sparse: input.sparse[index] } : {}),
            metadata: indexedSearchMetadata(record, input.dense?.[index] ? input.embeddingSpace : undefined),
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
      const hit = indexedChunkToHit({ value: entry.value, score: entry.score, matches: entry.matches })
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
      ...(record.source ? { source: record.source } : {}),
      content: record.content,
      metadata: record.metadata,
    }
  }

  async function expandParent(hit: Parameters<IndexedKnowledgeStore['expandParent']>[0], options: ParentExpansionOptions = {}) {
    if (hit.kind === 'finding') return hit
    const key = hit.parent?.key
    const parentId = hit.parent?.parentId
    if (!key && !parentId) return hit

    const parent = await getParent({ sourceId: hit.source.id, parentId, key })
    if (!parent) {
      const warning = `parentExpand could not find parent record "${key ?? parentId}" for ${hit.source.id}/${hit.chunkId}.`
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
          const updated = { ...entry.value, active: false, updatedAt: Date.now() }
          await config.records.put(entry.key, updated)
          await upsertSearchRecord(entry.key, updated)
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
      await config.search?.delete([entry.key])
    }
    return entries.length
  }

  async function searchScoredEntries(
    query: IndexedChunkSearchQuery,
    filter: ExactFilter,
  ): Promise<ScoredEntry[]> {
    if (config.search) {
      assertPreFilteredSearch(config.search.capabilities().filter)
      const searchHits = await config.search.search(searchQuery(query, filter))
      assertMatchingVectorSpaces(searchHits, query.embeddingSpace, config.namespace)
      const entries: ScoredEntry[] = []
      const hydrationFilter = activeChunkFilter(config.namespace)
      const misses: IndexedHydrationMiss[] = []
      for (const hit of searchHits) {
        const value = await config.records.get(hit.key)
        if (!value) {
          misses.push({ key: hit.key, reason: 'missing_record' })
          continue
        }
        if (!matchesExactFilter(value, hydrationFilter)) {
          misses.push({ key: hit.key, reason: 'inactive_or_wrong_namespace' })
          continue
        }
        entries.push({ key: hit.key, value, score: hit.score, matches: hit.matches })
      }
      assertSearchHitsHydrated({
        searchHitCount: searchHits.length,
        hydratedCount: entries.length,
        misses,
      })
      return entries
    }

    throw new Error('Indexed knowledge search requires search.')
  }

  async function upsertSearchRecord(key: string, value: JsonObject): Promise<void> {
    if (!config.search) return
    if (value._cruxRecordType !== 'chunk') return
    const content = typeof value.content === 'string' ? value.content : undefined
    const dense = Array.isArray(value.embedding) ? value.embedding.filter((item): item is number => typeof item === 'number') : undefined
    const sparse = isSparseVector(value.sparseEmbedding) ? value.sparseEmbedding : undefined
    if (content === undefined && dense === undefined && sparse === undefined) return
    await config.search.upsert([
      {
        key,
        ...(content !== undefined ? { content } : {}),
        ...(dense !== undefined ? { dense } : {}),
        ...(sparse !== undefined ? { sparse } : {}),
        metadata: exactMetadataFromJson(value),
      },
    ])
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

function assertMatchingVectorSpaces(
  hits: readonly { readonly metadata?: ExactFilter }[],
  actual: IndexedChunkSearchQuery['embeddingSpace'],
  namespace: string,
): void {
  if (!actual) return
  for (const hit of hits) {
    const expected = hit.metadata?.embeddingSpace
    if (typeof expected !== 'string' || expected === actual.digest) continue
    throw new EmbeddingSpaceMismatchError({
      namespace,
      expected,
      actual: actual.digest,
      actualSpace: { name: actual.name, dimensions: actual.dimensions },
    })
  }
}

function searchQuery(query: IndexedChunkSearchQuery, filter: ExactFilter): SearchQuery {
  const legs: SearchQuery['legs'][number][] = []
  if (query.legs.dense) {
    legs.push({
      kind: 'dense',
      vector: [...query.legs.dense.vector],
      ...(query.legs.dense.candidates !== undefined ? { candidates: query.legs.dense.candidates } : {}),
    })
  }
  if (query.legs.sparse) {
    legs.push({
      kind: 'sparse',
      vector: query.legs.sparse.vector,
      ...(query.legs.sparse.candidates !== undefined ? { candidates: query.legs.sparse.candidates } : {}),
    })
  }
  if (query.legs.lexical) {
    legs.push({
      kind: 'lexical',
      query: query.legs.lexical.query,
      ...(query.legs.lexical.candidates !== undefined ? { candidates: query.legs.lexical.candidates } : {}),
    })
  }
  if (legs.length === 0) throw new Error('Indexed knowledge search requires at least one search leg.')
  return {
    legs: legs as unknown as SearchQuery['legs'],
    limit: query.limit,
    threshold: query.threshold,
    filter,
    ...(query.fusion ? { fusion: query.fusion } : {}),
  }
}

function assertPreFilteredSearch(filterCapability: 'pre' | 'post' | false): void {
  if (filterCapability !== 'pre') {
    throw new StorageError(
      'unsupported_capability',
      'Indexed knowledge search requires a search store with pre-filter support.',
    )
  }
}

function exactMetadataFromJson(value: JsonObject): ExactFilter {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => (
      item === null ||
      typeof item === 'string' ||
      typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item))
    )),
  ) as ExactFilter
}

function isSparseVector(value: unknown): value is { readonly indices: readonly number[]; readonly values: readonly number[] } {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { readonly indices?: unknown; readonly values?: unknown }
  return Array.isArray(candidate.indices) && Array.isArray(candidate.values)
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
