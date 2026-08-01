/**
 * Build orchestration for connected knowledge communities.
 *
 * @module
 */

import { createGenerationId } from '../../indexing/hash'
import type { AssetStore, JsonObject, RecordStore } from '../../storage'
import { knowledgeCurrentKey } from '../keys'
import { clusterKnowledgeCommunities } from './cluster'
import { buildCommunityGraphInput } from './graph-input'
import { createCommunityReportRecord } from './records'
import { generateCommunityReports } from './reports'
import { createCommunityStore, type CommunityGenerationRetention } from './store'
import type { CommunitiesConfig } from './communities'
import type { ViewRevision } from '../view/revision'

const leaseTtlMs = 30_000
const inFlight = new Map<string, Promise<void>>()

export interface BuildCommunitiesInput {
  readonly records: RecordStore
  readonly assets?: AssetStore
  readonly indexerId: string
  readonly namespace: string
  readonly config: CommunitiesConfig
  readonly scopeKey: string
  readonly view?: ViewRevision
  readonly retention?: CommunityGenerationRetention
  readonly force?: boolean
}

/** Ensure one community materialization is current for a scope. */
export async function buildCommunities(input: BuildCommunitiesInput): Promise<void> {
  const key = `${input.indexerId}\0${input.namespace}\0${input.scopeKey}`
  const existing = inFlight.get(key)
  if (existing) return existing
  const promise = buildUntilFresh(input).finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

/** Return whether this process is already building the scope. */
export function isCommunityBuildInProcess(indexerId: string, namespace: string, scopeKey: string): boolean {
  return inFlight.has(`${indexerId}\0${namespace}\0${scopeKey}`)
}

async function buildUntilFresh(input: BuildCommunitiesInput): Promise<void> {
  await buildOnce(input)
  const dirty = await createCommunityStore(input).readDirty()
  const graphGeneration = await currentGraphGeneration(input.records, input.indexerId, input.namespace)
  const pointer = await createCommunityStore(input).currentGeneration()
  if (
    dirty.length > 0 ||
    pointer?.graphGeneration !== graphGeneration ||
    pointer.viewRevision !== (input.view?.revisionHash ?? null)
  ) {
    await buildOnce(input)
  }
}

async function buildOnce(input: BuildCommunitiesInput): Promise<void> {
  const owner = `${input.indexerId}:${input.namespace}:${input.scopeKey}:${createGenerationId()}`
  const store = createCommunityStore(input)
  while (!(await store.claimLease(owner, { ttlMs: leaseTtlMs }))) {
    await delay(25)
  }

  const heartbeat = setInterval(() => {
    void store.heartbeatLease(owner)
  }, Math.max(1_000, Math.floor(leaseTtlMs / 3)))
  const generationId = createGenerationId()
  try {
    const startedAt = Date.now()
    const graphGeneration = await currentGraphGeneration(input.records, input.indexerId, input.namespace)
    const graph = await buildCommunityGraphInput({
      records: input.records,
      indexerId: input.indexerId,
      namespace: input.namespace,
      ...(input.view ? { viewMembers: input.view.members } : {}),
    })
    const writer = store.beginGeneration(generationId)
    const lineage = {
      viewRevision: input.view?.revisionHash ?? null,
      graphGeneration,
      strategyFingerprint: input.config.strategyFingerprint,
    }
    const reports = graph.chunks.length === 0 && graph.entities.length === 0
      ? []
      : await generateCommunityReports({
          model: input.config.model,
          generationId,
          graph,
          clustering: clusterKnowledgeCommunities(graph),
          lineage,
          ...(input.assets ? { assets: input.assets } : {}),
          findReusable: async (communityId, memberHash, strategyFingerprint) => {
            const prior = await store.byId(communityId)
            return prior?.lineage.memberHash === memberHash &&
              prior.lineage.strategyFingerprint === strategyFingerprint
              ? prior
              : null
          },
        })

    for (const report of reports) {
      await writer.putReport(createCommunityReportRecord(report))
      await writer.putLevelIndex({
        generationId,
        communityId: report.communityId,
        level: report.level,
        ...(report.parentCommunityId ? { parentCommunityId: report.parentCommunityId } : {}),
      })
    }
    await writer.finish()
    await store.clearDirty(startedAt)
    await store.publish(generationId, { ...lineage, memberHash: '', retention: input.retention })
  } catch (error) {
    await store.abandon(generationId).catch(() => {})
    throw error
  } finally {
    clearInterval(heartbeat)
    await store.releaseLease(owner)
  }
}

async function currentGraphGeneration(
  records: RecordStore,
  indexerId: string,
  namespace: string,
): Promise<string> {
  const value = await records.get(knowledgeCurrentKey(indexerId, namespace))
  return isRecord(value) && value.namespace === namespace && typeof value.generationId === 'string'
    ? value.generationId
    : 'missing'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
