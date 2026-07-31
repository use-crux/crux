/**
 * Reader-side input assembly for deterministic knowledge communities.
 *
 * @module
 */

import { indexedChunkToHit } from '../../indexed-knowledge/records'
import { indexedNamespacePrefix, indexedSourcePrefix } from '../../indexed-knowledge/keys'
import { stableHash } from '../../indexing/hash'
import type { JsonObject, RecordEntry, RecordStore } from '../../storage'
import { knowledgeCurrentKey, knowledgeGenerationPrefix } from '../keys'
import { asKnowledgeEdgeRecord, asKnowledgeEntityRecord } from '../records'
import { encodeKnowledgeRef, type KnowledgeRef } from '../refs'
import type { ViewRevisionMember } from '../view/revision'
import type {
  CommunityChunkInput,
  CommunityEntityEdgeInput,
  CommunityEntityInput,
  CommunityGraphInput,
  CommunityMentionWeightInput,
} from './cluster'

/** Configuration for {@link buildCommunityGraphInput}. */
export interface BuildCommunityGraphInputConfig {
  /** Store containing indexed chunks and the published connected graph. */
  readonly records: RecordStore
  /** Stable indexer id used by indexed and connected knowledge keys. */
  readonly indexerId: string
  /** Namespace to materialize. */
  readonly namespace: string
  /** Optional pinned source set from a view revision. */
  readonly viewMembers?: readonly ViewRevisionMember[]
}

type ChunkRef = Extract<KnowledgeRef, { readonly kind: 'chunk' }>

/** Read the visible published graph into pure clustering input. */
export async function buildCommunityGraphInput(
  config: BuildCommunityGraphInputConfig,
): Promise<CommunityGraphInput> {
  const generationId = await currentGeneration(config.records, config.indexerId, config.namespace)
  const chunks = await readVisibleChunks(config)
  const chunkByKey = new Map(chunks.map((chunk) => [encodeKnowledgeRef(chunk.ref), chunk]))
  if (!generationId) {
    return emptyGraph(config.namespace, chunks, [])
  }

  const entries = await listAll(config.records, knowledgeGenerationPrefix(config.indexerId, config.namespace, generationId))
  const entityRecords = new Map(entries.flatMap((entry) => {
    const record = asKnowledgeEntityRecord(entry.value)
    return record && record.namespace === config.namespace && record.generationId === generationId
      ? [[record.entityId, record]]
      : []
  }))
  const edges = entries.flatMap((entry) => {
    const record = asKnowledgeEdgeRecord(entry.value)
    return record && record.namespace === config.namespace && record.generationId === generationId ? [record] : []
  })

  const mentionCounts = new Map<string, number>()
  const mentionsByChunk = new Map<string, Set<string>>()
  const semanticSupports = new Map<string, Set<string>>()

  for (const edge of edges) {
    const mention = mentionEndpoint(edge.from, edge.to)
    if (edge.type === 'mentions' && mention) {
      const supportKeys = visibleMentionSupportKeys(mention.chunk, edge.evidence.map((support) => support.chunkRef), chunkByKey)
      for (const supportKey of supportKeys) {
        addMention(mentionCounts, mentionsByChunk, supportKey, mention.entity.entityId)
      }
      continue
    }

    if (edge.from.kind !== 'entity' || edge.to.kind !== 'entity') continue
    const pair = entityPairKey(edge.from.entityId, edge.to.entityId)
    const supportSet = semanticSupports.get(pair) ?? new Set<string>()
    for (const support of edge.evidence) {
      const key = encodeKnowledgeRef(support.chunkRef)
      if (chunkByKey.has(key)) supportSet.add(key)
    }
    if (supportSet.size > 0) semanticSupports.set(pair, supportSet)
  }

  const visibleEntityIds = new Set<string>()
  for (const key of mentionCounts.keys()) visibleEntityIds.add(key.slice(key.indexOf('\0') + 1))

  const entities = [...visibleEntityIds].sort().map((entityId): CommunityEntityInput => {
    const record = entityRecords.get(entityId)
    return {
      entityId,
      canonicalName: record?.canonicalName ?? entityId,
      aliases: record?.aliases ?? [],
      ...(record?.description !== undefined ? { description: record.description } : {}),
    }
  })
  const weightedEdges = combineEdges(semanticSupports, mentionsByChunk, visibleEntityIds)
  const mentionWeights = [...mentionCounts.entries()].map(([key, weight]): CommunityMentionWeightInput => {
    const [chunkKey, entityId] = key.split('\0')
    const chunk = chunkKey ? chunkByKey.get(chunkKey) : undefined
    if (!chunk || !entityId) throw new Error('Invalid community mention input key.')
    return { chunkRef: chunk.ref, entityId, weight }
  }).sort(compareMentionWeights)

  return emptyGraph(config.namespace, chunks, mentionWeights, entities, weightedEdges)
}

function emptyGraph(
  namespace: string,
  chunks: readonly CommunityChunkInput[],
  mentionWeights: readonly CommunityMentionWeightInput[],
  entities: readonly CommunityEntityInput[] = [],
  edges: readonly CommunityEntityEdgeInput[] = [],
): CommunityGraphInput {
  const mentioned = new Set(mentionWeights.map((mention) => encodeKnowledgeRef(mention.chunkRef)))
  return {
    namespace,
    entities,
    edges,
    chunks,
    mentionWeights,
    residualChunks: chunks.filter((chunk) => !mentioned.has(encodeKnowledgeRef(chunk.ref))),
  }
}

async function currentGeneration(records: RecordStore, indexerId: string, namespace: string): Promise<string | null> {
  const value = await records.get(knowledgeCurrentKey(indexerId, namespace))
  return value?._cruxRecordType === 'knowledge-current' &&
    value.namespace === namespace &&
    typeof value.generationId === 'string'
    ? value.generationId
    : null
}

async function readVisibleChunks(config: BuildCommunityGraphInputConfig): Promise<readonly CommunityChunkInput[]> {
  if (config.viewMembers) {
    const members = [...new Map(config.viewMembers.map((member) => [member.sourceId, member])).values()]
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
    const chunks = await Promise.all(members.map(async (member) => {
      const entries = await listAll(config.records, indexedSourcePrefix(config.indexerId, config.namespace, member.sourceId))
      return sourceContentHash(entries, config.namespace) === member.contentHash
        ? entries.flatMap((entry) => asVisibleChunk(entry.value, config.namespace))
        : []
    }))
    return chunks.flat().sort(compareChunks)
  }

  const prefixes = [indexedNamespacePrefix(config.indexerId, config.namespace)]
  const entries = (await Promise.all(prefixes.map((prefix) => listAll(config.records, prefix)))).flat()
  return entries.flatMap((entry) => asVisibleChunk(entry.value, config.namespace)).sort(compareChunks)
}

function asVisibleChunk(value: JsonObject, namespace: string): readonly CommunityChunkInput[] {
  const hit = indexedChunkToHit({ value, score: 0 })
  if (!hit || hit.namespace !== namespace || typeof value.ordinal !== 'number') return []
  const ref = { kind: 'chunk' as const, sourceId: hit.source.id, chunkId: hit.chunkId }
  return [{
    ref,
    sourceId: hit.source.id,
    chunkId: hit.chunkId,
    ordinal: value.ordinal,
    content: hit.content,
  }]
}

function sourceContentHash(entries: readonly RecordEntry[], namespace: string): string | null {
  const chunks = entries.map((entry) => entry.value).filter((value) => isActiveChunk(value, namespace)).sort((left, right) =>
    left.ordinal - right.ordinal || left.chunkId.localeCompare(right.chunkId))
  return chunks.length > 0 ? stableHash(chunks.map(sourceVersionRecord)) : null
}

function sourceVersionRecord(value: ActiveChunkRecord): JsonObject {
  return {
    chunkId: value.chunkId,
    generationId: value.generationId,
    content: value.content,
    metadata: isRecord(value.metadata) ? value.metadata : {},
  }
}

type ActiveChunkRecord = JsonObject & {
  readonly sourceId: string
  readonly chunkId: string
  readonly ordinal: number
  readonly generationId?: string
  readonly content?: string
  readonly metadata?: JsonObject
}

function isActiveChunk(value: JsonObject, namespace: string): value is ActiveChunkRecord {
  return value._cruxRecordType === 'chunk' &&
    value.active === true &&
    value.namespace === namespace &&
    typeof value.sourceId === 'string' &&
    typeof value.chunkId === 'string' &&
    typeof value.ordinal === 'number'
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function mentionEndpoint(from: KnowledgeRef, to: KnowledgeRef): {
  readonly chunk: ChunkRef
  readonly entity: Extract<KnowledgeRef, { readonly kind: 'entity' }>
} | null {
  if (from.kind === 'chunk' && to.kind === 'entity') return { chunk: from, entity: to }
  if (from.kind === 'entity' && to.kind === 'chunk') return { chunk: to, entity: from }
  return null
}

function visibleMentionSupportKeys(
  chunk: ChunkRef,
  supports: readonly ChunkRef[],
  chunks: ReadonlyMap<string, CommunityChunkInput>,
): readonly string[] {
  const keys = new Set(supports.map(encodeKnowledgeRef).filter((key) => chunks.has(key)))
  const endpoint = encodeKnowledgeRef(chunk)
  if (chunks.has(endpoint)) keys.add(endpoint)
  return [...keys].sort()
}

function addMention(
  counts: Map<string, number>,
  byChunk: Map<string, Set<string>>,
  chunkKey: string,
  entityId: string,
): void {
  const key = `${chunkKey}\0${entityId}`
  counts.set(key, (counts.get(key) ?? 0) + 1)
  const entities = byChunk.get(chunkKey) ?? new Set<string>()
  entities.add(entityId)
  byChunk.set(chunkKey, entities)
}

function combineEdges(
  semanticSupports: ReadonlyMap<string, ReadonlySet<string>>,
  mentionsByChunk: ReadonlyMap<string, ReadonlySet<string>>,
  visibleEntityIds: ReadonlySet<string>,
): readonly CommunityEntityEdgeInput[] {
  const weights = new Map<string, number>()
  for (const [pair, supports] of semanticSupports) weights.set(pair, (weights.get(pair) ?? 0) + supports.size)
  for (const entities of mentionsByChunk.values()) {
    const ids = [...entities].filter((id) => visibleEntityIds.has(id)).sort()
    for (let left = 0; left < ids.length; left += 1) {
      for (let right = left + 1; right < ids.length; right += 1) {
        const key = entityPairKey(ids[left] ?? '', ids[right] ?? '')
        weights.set(key, (weights.get(key) ?? 0) + 1)
      }
    }
  }
  return [...weights.entries()].flatMap(([key, weight]) => {
    const [leftEntityId, rightEntityId] = key.split('\0')
    return leftEntityId && rightEntityId && visibleEntityIds.has(leftEntityId) && visibleEntityIds.has(rightEntityId)
      ? [{ leftEntityId, rightEntityId, weight }]
      : []
  }).sort(compareEntityEdges)
}

async function listAll(records: RecordStore, prefix: string): Promise<readonly RecordEntry[]> {
  const entries: RecordEntry[] = []
  let cursor: string | undefined
  do {
    const page = await records.list(prefix, { cursor, limit: 100 })
    entries.push(...page.entries)
    cursor = page.cursor
  } while (cursor)
  return entries
}

function entityPairKey(left: string, right: string): string {
  return left <= right ? `${left}\0${right}` : `${right}\0${left}`
}

function compareChunks(left: CommunityChunkInput, right: CommunityChunkInput): number {
  return left.sourceId.localeCompare(right.sourceId) || left.ordinal - right.ordinal || left.chunkId.localeCompare(right.chunkId)
}

function compareEntityEdges(left: CommunityEntityEdgeInput, right: CommunityEntityEdgeInput): number {
  return left.leftEntityId.localeCompare(right.leftEntityId) || left.rightEntityId.localeCompare(right.rightEntityId)
}

function compareMentionWeights(left: CommunityMentionWeightInput, right: CommunityMentionWeightInput): number {
  return encodeKnowledgeRef(left.chunkRef).localeCompare(encodeKnowledgeRef(right.chunkRef)) ||
    left.entityId.localeCompare(right.entityId)
}
