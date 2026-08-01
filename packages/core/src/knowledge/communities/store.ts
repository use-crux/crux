/**
 * Storage lifecycle for connected knowledge community reports.
 *
 * @module
 */

import type { JsonObject, RecordEntry, RecordStore } from '../../storage'
import * as keys from './keys'
import {
  asCommunityDirtyLedgerRecord,
  asCommunityGenerationPointerRecord,
  asCommunityLeaseRecord,
  asCommunityLevelIndexRecord,
  asCommunityReportRecord,
  createCommunityDirtyLedgerRecord,
  createCommunityGenerationPointerRecord,
  createCommunityLeaseRecord,
  createCommunityLevelIndexRecord,
  type CommunityDirtyLedgerRecord,
  type CommunityGenerationPointerRecord,
  type CommunityLevelIndexRecord,
  type CommunityReport,
  type CommunityReportLineage,
} from './records'

export type CommunityGenerationRetention = 'cleanup' | 'retain-inactive'

export interface CommunityStoreConfig {
  readonly records: RecordStore, readonly indexerId: string, readonly namespace: string
  readonly scopeKey: string, readonly retention?: CommunityGenerationRetention
}

export interface CommunityPublishOptions extends CommunityReportLineage { readonly retention?: CommunityGenerationRetention }

type GenerationState = 'building' | 'finished' | 'published' | 'abandoned'

/** Create a community report store from core storage ports. */
export function createCommunityStore(config: CommunityStoreConfig) {
  const states = new Map<string, GenerationState>()
  const pointerKey = keys.communityCurrentKey(config.indexerId, config.namespace, config.scopeKey)
  const dirtyPrefix = keys.communityDirtyPrefix(config.indexerId, config.namespace, config.scopeKey)
  const leaseKey = keys.communityLeaseKey(config.indexerId, config.namespace, config.scopeKey)
  const generationPrefix = (generationId: string) =>
    keys.communityGenerationPrefix(config.indexerId, config.namespace, config.scopeKey, generationId)
  const reportKey = (generationId: string, communityId: string) =>
    keys.communityReportKey(config.indexerId, config.namespace, config.scopeKey, generationId, communityId)
  const reportPrefix = (generationId: string) =>
    keys.communityReportPrefix(config.indexerId, config.namespace, config.scopeKey, generationId)
  const levelIndexKey = (generationId: string, level: number, communityId: string) =>
    keys.communityLevelIndexKey(config.indexerId, config.namespace, config.scopeKey, generationId, level, communityId)
  const levelIndexPrefix = (generationId: string, level: number) =>
    keys.communityLevelIndexPrefix(config.indexerId, config.namespace, config.scopeKey, generationId, level)
  const dirtyKey = (sourceId: string) => keys.communityDirtyKey(config.indexerId, config.namespace, config.scopeKey, sourceId)

  async function currentGeneration(): Promise<CommunityGenerationPointerRecord | null> {
    const pointer = asCommunityGenerationPointerRecord(await config.records.get(pointerKey))
    return pointer?.namespace === config.namespace && pointer.scopeKey === config.scopeKey ? pointer : null
  }

  function beginGeneration(generationId: string) {
    assertValidGenerationId(generationId)
    const state = states.get(generationId)
    if (state === 'abandoned') throw new Error(`Community generation "${generationId}" was abandoned.`)
    if (state === 'published') throw new Error(`Community generation "${generationId}" was already published.`)
    if (state === 'finished') throw new Error(`Community generation "${generationId}" was already finished.`)
    if (state === 'building') throw new Error(`Community generation "${generationId}" was already begun.`)
    states.set(generationId, 'building')

    const prefix = generationPrefix(generationId)
    const putRecord = async (key: string, value: JsonObject): Promise<void> => {
      assertBuilding(states.get(generationId), generationId)
      if (!key.startsWith(prefix)) {
        throw new Error(`Community generation "${generationId}" cannot write outside its generation prefix.`)
      }
      const existing = await config.records.get(key)
      if (existing) {
        if (stableJson(existing) !== stableJson(value)) {
          throw new Error(`Community generation "${generationId}" cannot rewrite "${key}" with a different value.`)
        }
        return
      }
      await config.records.put(key, value)
    }

    return Object.freeze({
      generationId,
      putReport: (record: CommunityReport) => {
        assertGenerationRecord(record, generationId)
        return putRecord(reportKey(generationId, record.communityId), record as unknown as JsonObject)
      },
      putLevelIndex: (record: CommunityLevelIndexRecord) => {
        assertGenerationRecord(record, generationId)
        const value = createCommunityLevelIndexRecord(record)
        return putRecord(levelIndexKey(generationId, value.level, value.communityId), value as unknown as JsonObject)
      },
      finish: async () => {
        assertBuilding(states.get(generationId), generationId)
        states.set(generationId, 'finished')
      },
    })
  }

  async function publish(generationId: string, options: CommunityPublishOptions): Promise<void> {
    assertPublishable(states.get(generationId), generationId)
    const previousGenerationId = (await currentGeneration())?.generationId ?? null
    await config.records.put(pointerKey, createCommunityGenerationPointerRecord({
      generationId,
      scopeKey: config.scopeKey,
      namespace: config.namespace,
      viewRevision: options.viewRevision,
      graphGeneration: options.graphGeneration,
      strategyFingerprint: options.strategyFingerprint,
      updatedAt: Date.now(),
    }) as unknown as JsonObject)
    states.set(generationId, 'published')

    const retention = options.retention ?? config.retention ?? 'cleanup'
    if (retention === 'cleanup' && previousGenerationId && previousGenerationId !== generationId) {
      await deleteGeneration(previousGenerationId)
    }
  }

  async function abandon(generationId: string): Promise<void> {
    const current = await currentGeneration()
    if (current?.generationId === generationId || states.get(generationId) === 'published') {
      throw new Error(`Community generation "${generationId}" is already published and cannot be abandoned.`)
    }
    states.set(generationId, 'abandoned')
    await deleteGeneration(generationId)
  }

  async function byId(communityId: string): Promise<CommunityReport | null> {
    const generationId = (await currentGeneration())?.generationId
    return generationId ? visibleReport(await config.records.get(reportKey(generationId, communityId)), generationId) : null
  }

  async function byLevel(level: number, options: { readonly limit?: number; readonly cursor?: string } = {}) {
    const generationId = (await currentGeneration())?.generationId
    if (!generationId) return { reports: [] }
    const page = await config.records.list(levelIndexPrefix(generationId, level), options)
    const indexes = page.entries.flatMap((entry) => {
      const record = asCommunityLevelIndexRecord(entry.value)
      return record?.generationId === generationId && record.level === level ? [record] : []
    })
    const values = await getMany(indexes.map((index) => reportKey(generationId, index.communityId)))
    return {
      reports: values.flatMap((value) => {
        const report = visibleReport(value, generationId)
        return report ? [report] : []
      }),
      ...(page.cursor ? { cursor: page.cursor } : {}),
    }
  }

  async function childrenOf(parentCommunityId: string): Promise<readonly CommunityReport[]> {
    const generationId = (await currentGeneration())?.generationId
    if (!generationId) return []
    const entries = await listAll(reportPrefix(generationId))
    return entries
      .flatMap((entry) => {
        const report = visibleReport(entry.value, generationId)
        return report?.parentCommunityId === parentCommunityId ? [report] : []
      })
      .sort(compareReports)
  }

  async function markDirty(
    sourceId: string,
    reason: CommunityDirtyLedgerRecord['reason'],
    touchedAt = Date.now(),
  ): Promise<void> {
    await config.records.put(dirtyKey(sourceId), createCommunityDirtyLedgerRecord({
      sourceId,
      reason,
      touchedAt,
    }) as unknown as JsonObject)
  }

  async function readDirty(): Promise<readonly CommunityDirtyLedgerRecord[]> {
    const entries = await listAll(dirtyPrefix)
    return entries.flatMap((entry) => {
      const record = asCommunityDirtyLedgerRecord(entry.value)
      return record ? [record] : []
    }).sort((left, right) => left.sourceId.localeCompare(right.sourceId))
  }

  async function clearDirty(touchedAt: number): Promise<void> {
    for (const record of await readDirty()) {
      if (record.touchedAt <= touchedAt) await config.records.delete(dirtyKey(record.sourceId))
    }
  }

  async function claimLease(
    owner: string,
    options: { readonly ttlMs?: number; readonly now?: number } = {},
  ): Promise<boolean> {
    const now = options.now ?? Date.now()
    if (await config.records.create(leaseKey, createCommunityLeaseRecord({ owner, heartbeatAt: now }) as unknown as JsonObject)) {
      return true
    }
    const existing = asCommunityLeaseRecord(await config.records.get(leaseKey))
    if (!existing || options.ttlMs !== undefined && now - existing.heartbeatAt >= options.ttlMs) {
      await config.records.delete(leaseKey)
      return config.records.create(leaseKey, createCommunityLeaseRecord({ owner, heartbeatAt: now }) as unknown as JsonObject)
    }
    return false
  }

  async function heartbeatLease(owner: string, heartbeatAt = Date.now()): Promise<boolean> {
    const existing = asCommunityLeaseRecord(await config.records.get(leaseKey))
    if (!existing || existing.owner !== owner) return false
    await config.records.put(leaseKey, createCommunityLeaseRecord({ owner, heartbeatAt }) as unknown as JsonObject)
    return true
  }

  async function releaseLease(owner?: string): Promise<boolean> {
    const existing = asCommunityLeaseRecord(await config.records.get(leaseKey))
    if (!existing || owner !== undefined && existing.owner !== owner) return false
    await config.records.delete(leaseKey)
    return true
  }

  async function isLeaseStale(ttlMs: number, now = Date.now()): Promise<boolean> {
    const value = await config.records.get(leaseKey)
    const lease = asCommunityLeaseRecord(value)
    return value !== null && (!lease || now - lease.heartbeatAt >= ttlMs)
  }

  return Object.freeze({
    currentGeneration,
    beginGeneration,
    begin: beginGeneration,
    publish,
    abandon,
    byId,
    byLevel,
    childrenOf,
    markDirty,
    readDirty,
    clearDirty,
    claimLease,
    heartbeatLease,
    releaseLease,
    isLeaseStale,
  })

  async function deleteGeneration(generationId: string): Promise<void> {
    for (const key of (await listAll(generationPrefix(generationId))).map((entry) => entry.key)) {
      await config.records.delete(key)
    }
  }

  function visibleReport(value: JsonObject | null | undefined, generationId: string): CommunityReport | null {
    const report = asCommunityReportRecord(value)
    return report?.generationId === generationId ? report : null
  }

  function getMany(keys: readonly string[]): Promise<readonly (JsonObject | null)[]> {
    if (keys.length === 0) return Promise.resolve([])
    return config.records.getMany ? config.records.getMany(keys) : Promise.all(keys.map((key) => config.records.get(key)))
  }

  async function listAll(prefix: string): Promise<readonly RecordEntry[]> {
    const entries: RecordEntry[] = []
    let cursor: string | undefined
    do {
      const page = await config.records.list(prefix, { cursor, limit: 100 })
      entries.push(...page.entries)
      cursor = page.cursor
    } while (cursor)
    return entries
  }
}
export type CommunityStore = ReturnType<typeof createCommunityStore>

function assertValidGenerationId(generationId: string): void { if (generationId.length === 0) throw new Error('Community generation id must not be empty.') }

function assertGenerationRecord(record: { readonly generationId: string }, generationId: string): void {
  if (record.generationId !== generationId) throw new Error(`Community generation writer expected generation "${generationId}".`)
}

function assertBuilding(state: GenerationState | undefined, generationId: string): void { if (state !== 'building') throw new Error(`Community generation "${generationId}" is not open for writes.`) }

function assertPublishable(state: GenerationState | undefined, generationId: string): void {
  if (!state) throw new Error(`Unknown community generation "${generationId}".`)
  if (state === 'abandoned') throw new Error(`Community generation "${generationId}" was abandoned.`)
  if (state !== 'finished') throw new Error(`Community generation "${generationId}" must be finished before publish.`)
}

function compareReports(left: CommunityReport, right: CommunityReport): number { return left.level - right.level || left.communityId.localeCompare(right.communityId) }

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(',')}}`
}
