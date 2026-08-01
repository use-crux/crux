/**
 * Internal fixtures for connected knowledge conformance cases.
 *
 * @module
 */

import type { CruxChunk } from '../indexing'
import type { JsonObject, RecordPage, RecordStore } from '../storage'
import { createCommunityReportRecord, type CommunityReport, type CommunityReportLineage } from './communities/records'
import { createCommunityStore } from './communities/store'
import type { ConnectedKnowledgeConformanceExpect } from './conformance'
import { createKnowledgeGenerationStore, type KnowledgeGenerationWriter } from './generation'
import {
  knowledgeAdjacencyInKey,
  knowledgeAdjacencyOutKey,
  knowledgeEntityKey,
} from './keys'
import { createKnowledgeEdgeRecord, createKnowledgeEntityRecord, type KnowledgeEdgeRecord } from './records'
import type { KnowledgeRef } from './refs'
import type { NormalizedViewWhere } from './view/where'

export const indexerId = 'docs'
export const namespace = 'kb'
export const viewId = 'active'
export const communityScopeKey = 'scope'
export const where: NormalizedViewWhere = {
  any: [
    [{ field: 'status', values: ['open'] }],
    [{ field: 'team', values: ['docs'] }],
  ],
}
export const lineage: CommunityReportLineage = {
  viewRevision: 'view-rev',
  graphGeneration: 'graph-gen',
  strategyFingerprint: 'strategy',
  memberHash: 'members',
}

export const entity = Object.freeze({
  key: (generationId: string, entityId: string, ns = namespace) =>
    knowledgeEntityKey(indexerId, ns, generationId, entityId),
  record: (generationId: string, entityId: string, ns = namespace) =>
    createKnowledgeEntityRecord({ entityId, canonicalName: entityId, aliases: [], generationId, namespace: ns }),
})

export function entityJson(generationId: string, entityId: string, ns = namespace): JsonObject {
  return entity.record(generationId, entityId, ns) as unknown as JsonObject
}

export async function publishEntity(
  generations: ReturnType<typeof createKnowledgeGenerationStore>,
  generationId: string,
  entityId: string,
): Promise<void> {
  const writer = generations.beginGeneration(generationId)
  await writer.putEntity(entity.record(generationId, entityId))
  await writer.finish()
  await generations.publish(generationId)
}

export async function publishEdges(
  records: RecordStore,
  generationId: string,
  edges: readonly KnowledgeEdgeRecord[],
): Promise<void> {
  const generations = createKnowledgeGenerationStore({ records, indexerId, namespace, retention: 'retain-inactive' })
  const writer = generations.beginGeneration(generationId)
  for (const record of edges) await writeEdge(writer, record)
  await writer.finish()
  await generations.publish(generationId)
}

export function edge(generationId: string, type: string, from: KnowledgeRef, to: KnowledgeRef): KnowledgeEdgeRecord {
  return createKnowledgeEdgeRecord({
    type,
    from,
    to,
    direction: 'directed',
    evidence: [],
    stageId: 'manual',
    stageVersion: 1,
    generationId,
    namespace,
    now: 1,
  })
}

export async function publishReport(
  store: ReturnType<typeof createCommunityStore>,
  generationId: string,
  communityId: string,
): Promise<void> {
  const writer = store.beginGeneration(generationId)
  await writer.putReport(report(generationId, communityId))
  await writer.putLevelIndex({ generationId, communityId, level: 0 })
  await writer.finish()
  await store.publish(generationId, lineage)
}

export function report(generationId: string, communityId: string): CommunityReport {
  return createCommunityReportRecord({
    communityId,
    generationId,
    level: 0,
    title: `Title ${communityId}`,
    summary: `Summary ${communityId}`,
    findings: [{
      id: 'finding',
      statement: 'Finding statement',
      evidence: [chunkRef('source', 'chunk')],
    }],
    lineage,
    counts: { entities: 1, chunks: 1, assertions: 0 },
  })
}

export function chunk(
  sourceId: string,
  chunkId: string,
  content: string,
  metadata: Record<string, unknown> = {},
): CruxChunk {
  return {
    namespace,
    sourceId,
    chunkId,
    ordinal: 0,
    content,
    metadata,
  }
}

export function countRecordAccess(records: RecordStore): {
  readonly store: RecordStore
  readonly getKeys: string[]
  readonly listPrefixes: string[]
} {
  const getKeys: string[] = []
  const listPrefixes: string[] = []
  const store: RecordStore = {
    ...records,
    get: async (key) => {
      getKeys.push(key)
      return records.get(key)
    },
    list: async (prefix, options): Promise<RecordPage<JsonObject>> => {
      listPrefixes.push(prefix)
      return records.list(prefix, options)
    },
  }
  return { store, getKeys, listPrefixes }
}

export async function expectRejects(
  fn: () => Promise<unknown>,
  message: RegExp,
  expect: ConnectedKnowledgeConformanceExpect,
): Promise<void> {
  let thrown: unknown
  try {
    await fn()
  } catch (error) {
    thrown = error
  }
  expect(thrown instanceof Error ? message.test(thrown.message) : false).toBe(true)
}

export function documentRef(sourceId: string): KnowledgeRef {
  return { kind: 'document', sourceId }
}

export function parentRef(sourceId: string, parentId: string): KnowledgeRef {
  return { kind: 'parent', sourceId, parentId }
}

export function chunkRef(sourceId: string, chunkId: string): KnowledgeRef {
  return { kind: 'chunk', sourceId, chunkId }
}

export function entityRef(entityId: string): KnowledgeRef {
  return { kind: 'entity', entityId }
}

async function writeEdge(writer: KnowledgeGenerationWriter, record: KnowledgeEdgeRecord): Promise<void> {
  await writer.putEdge(record)
  await writer.putRecord(
    knowledgeAdjacencyOutKey(indexerId, namespace, record.generationId, record.from, record.type, record.edgeId),
    { edgeId: record.edgeId, type: record.type, peerRef: record.to } as unknown as JsonObject,
  )
  await writer.putRecord(
    knowledgeAdjacencyInKey(indexerId, namespace, record.generationId, record.to, record.type, record.edgeId),
    { edgeId: record.edgeId, type: record.type, peerRef: record.from } as unknown as JsonObject,
  )
}
