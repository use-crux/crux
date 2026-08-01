/**
 * Runtime maintenance for connected knowledge view membership indexes.
 *
 * @module
 */

import { stableHash } from '../../indexing/hash'
import { indexedNamespacePrefix, indexedSourcePrefix, listIndexedEntries } from '../../indexed-knowledge/keys'
import type { JsonObject, RecordStore } from '../../storage'
import { knowledgeViewBackfillKey, knowledgeViewIndexPrefix } from '../keys'
import { applyMembershipForSource, resolveViewMembers } from './membership'
import { resolveViewRevision, type ViewRevision } from './revision'
import type { NormalizedViewWhere } from './where'

/** A registered view whose membership index should follow lifecycle changes. Internal. */
export interface ViewRegistration {
  readonly viewId: string
  readonly where: NormalizedViewWhere
}

/** Runtime registry for view membership and revision reads. Internal. */
export interface KnowledgeViewRegistry {
  register(view: ViewRegistration): void
  afterIndex(sourceIds?: readonly string[]): Promise<void>
  afterRemove(sourceId: string): Promise<void>
  resolveCurrent(view: ViewRegistration): Promise<ViewRevision>
  assertRevisionAvailable(viewId: string, revision: ViewRevision): Promise<void>
}

/** Create a per-runtime registry for live view membership maintenance. Internal. */
export function createKnowledgeViewRegistry(config: {
  readonly records?: RecordStore
  readonly indexerId: string
  readonly namespace: string
}): KnowledgeViewRegistry {
  const views = new Map<string, ViewRegistration>()

  function register(view: ViewRegistration): void {
    const existing = views.get(view.viewId)
    if (existing && whereHash(existing) !== whereHash(view)) {
      throw new Error(`View "${view.viewId}" is already registered with a different where predicate.`)
    }
    views.set(view.viewId, view)
  }

  async function afterIndex(sourceIds?: readonly string[]): Promise<void> {
    if (!config.records || views.size === 0) return
    const snapshots = sourceIds
      ? await activeSourceSnapshotsFor(config.records, config.indexerId, config.namespace, sourceIds)
      : await activeSourceSnapshots(config.records, config.indexerId, config.namespace)
    for (const view of views.values()) {
      for (const source of snapshots) {
        await applyMembershipForSource({
          records: config.records,
          indexerId: config.indexerId,
          namespace: config.namespace,
          viewId: view.viewId,
          where: view.where,
          sourceId: source.sourceId,
          metadata: source.metadata,
        })
      }
      await markBackfilled(config.records, config.indexerId, config.namespace, view)
    }
  }

  async function afterRemove(sourceId: string): Promise<void> {
    if (!config.records || views.size === 0) return
    for (const view of views.values()) {
      await applyMembershipForSource({
        records: config.records,
        indexerId: config.indexerId,
        namespace: config.namespace,
        viewId: view.viewId,
        where: view.where,
        sourceId,
        metadata: null,
      })
    }
  }

  async function resolveCurrent(view: ViewRegistration): Promise<ViewRevision> {
    if (!config.records) {
      throw new Error(`knowledgeBase().view("${view.viewId}") requires record storage to resolve membership.`)
    }
    const marked = await backfillMark(config.records, config.indexerId, config.namespace, view.viewId)
    if (marked && marked.whereHash !== whereHash(view)) {
      throw new Error(`View "${view.viewId}" has persisted membership for a different where predicate.`)
    }
    if (!marked && !(await hasMembershipIndex(config.records, config.indexerId, config.namespace, view.viewId))) {
      await backfillView(config.records, config.indexerId, config.namespace, view)
      await markBackfilled(config.records, config.indexerId, config.namespace, view)
    } else if (!marked) {
      await markBackfilled(config.records, config.indexerId, config.namespace, view)
    }
    const sourceIds = await resolveViewMembers({
      records: config.records,
      indexerId: config.indexerId,
      namespace: config.namespace,
      viewId: view.viewId,
      where: view.where,
    })
    const members = await activeRevisionMembers(config.records, config.indexerId, config.namespace, sourceIds)
    return resolveViewRevision({
      records: config.records,
      indexerId: config.indexerId,
      namespace: config.namespace,
      viewId: view.viewId,
      members,
    })
  }

  async function assertRevisionAvailable(viewId: string, revision: ViewRevision): Promise<void> {
    if (!config.records) throw new Error(`knowledgeBase().view("${viewId}") requires record storage.`)
    for (const member of revision.members) {
      const snapshot = await activeSourceSnapshot(config.records, config.indexerId, config.namespace, member.sourceId)
      if (!snapshot || snapshot.contentHash !== member.contentHash) {
        throw new Error(`View "${viewId}" revision "${revision.revisionHash}" is not exactly replayable; source "${member.sourceId}" is missing or has changed.`)
      }
    }
  }

  return Object.freeze({ register, afterIndex, afterRemove, resolveCurrent, assertRevisionAvailable })
}

async function backfillView(
  records: RecordStore,
  indexerId: string,
  namespace: string,
  view: ViewRegistration,
): Promise<void> {
  for (const source of await activeSourceSnapshots(records, indexerId, namespace)) {
    await applyMembershipForSource({
      records,
      indexerId,
      namespace,
      viewId: view.viewId,
      where: view.where,
      sourceId: source.sourceId,
      metadata: source.metadata,
    })
  }
}

async function hasMembershipIndex(
  records: RecordStore,
  indexerId: string,
  namespace: string,
  viewId: string,
): Promise<boolean> {
  const page = await records.list(knowledgeViewIndexPrefix(indexerId, namespace, viewId), { limit: 1 })
  return page.entries.length > 0
}

async function activeRevisionMembers(
  records: RecordStore,
  indexerId: string,
  namespace: string,
  sourceIds: readonly string[],
): Promise<Array<{ readonly sourceId: string; readonly contentHash: string }>> {
  const members: Array<{ sourceId: string; contentHash: string }> = []
  for (const sourceId of sourceIds) {
    const snapshot = await activeSourceSnapshot(records, indexerId, namespace, sourceId)
    if (snapshot) members.push({ sourceId, contentHash: snapshot.contentHash })
  }
  return members
}

async function activeSourceSnapshots(
  records: RecordStore,
  indexerId: string,
  namespace: string,
): Promise<ActiveSourceSnapshot[]> {
  const entries = await listIndexedEntries(records, indexedNamespacePrefix(indexerId, namespace))
  return snapshotsFromEntries(entries.map((entry) => entry.value), namespace)
}

async function activeSourceSnapshotsFor(
  records: RecordStore,
  indexerId: string,
  namespace: string,
  sourceIds: readonly string[],
): Promise<ActiveSourceSnapshot[]> {
  const snapshots: ActiveSourceSnapshot[] = []
  for (const sourceId of Array.from(new Set(sourceIds)).sort()) {
    const snapshot = await activeSourceSnapshot(records, indexerId, namespace, sourceId)
    if (snapshot) snapshots.push(snapshot)
  }
  return snapshots
}

async function activeSourceSnapshot(
  records: RecordStore,
  indexerId: string,
  namespace: string,
  sourceId: string,
): Promise<ActiveSourceSnapshot | null> {
  const entries = await listIndexedEntries(records, indexedSourcePrefix(indexerId, namespace, sourceId))
  return snapshotsFromEntries(entries.map((entry) => entry.value), namespace)[0] ?? null
}

interface ActiveSourceSnapshot {
  readonly sourceId: string
  readonly metadata: Record<string, unknown>
  readonly contentHash: string
}

interface ViewBackfillRecord extends JsonObject {
  readonly _cruxRecordType: 'knowledge-view-backfill'
  readonly namespace: string
  readonly viewId: string
  readonly whereHash: string
  readonly completedAt: number
}

async function backfillMark(
  records: RecordStore,
  indexerId: string,
  namespace: string,
  viewId: string,
): Promise<ViewBackfillRecord | null> {
  const value = await records.get(knowledgeViewBackfillKey(indexerId, namespace, viewId))
  if (
    value?._cruxRecordType !== 'knowledge-view-backfill' ||
    value.namespace !== namespace ||
    value.viewId !== viewId ||
    typeof value.whereHash !== 'string'
  ) return null
  return value as unknown as ViewBackfillRecord
}

async function markBackfilled(
  records: RecordStore,
  indexerId: string,
  namespace: string,
  view: ViewRegistration,
): Promise<void> {
  await records.put(knowledgeViewBackfillKey(indexerId, namespace, view.viewId), {
    _cruxRecordType: 'knowledge-view-backfill',
    namespace,
    viewId: view.viewId,
    whereHash: whereHash(view),
    completedAt: Date.now(),
  })
}

function whereHash(view: ViewRegistration): string {
  return stableHash(view.where)
}

function snapshotsFromEntries(entries: readonly JsonObject[], namespace: string): ActiveSourceSnapshot[] {
  const grouped = new Map<string, JsonObject[]>()
  for (const value of entries) {
    if (!isActiveChunk(value, namespace)) continue
    const group = grouped.get(value.sourceId) ?? []
    group.push(value)
    grouped.set(value.sourceId, group)
  }
  return [...grouped.entries()]
    .map(([sourceId, chunks]) => {
      const ordered = chunks.sort((left, right) =>
        Number(left.ordinal) - Number(right.ordinal) || String(left.chunkId).localeCompare(String(right.chunkId)))
      return {
        sourceId,
        metadata: isRecord(ordered[0]?.metadata) ? ordered[0].metadata : {},
        contentHash: stableHash(ordered.map(sourceVersionRecord)),
      }
    })
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
}

function sourceVersionRecord(value: JsonObject): JsonObject {
  return {
    chunkId: value.chunkId,
    generationId: value.generationId,
    content: value.content,
    metadata: isRecord(value.metadata) ? value.metadata : {},
  }
}

function isActiveChunk(value: JsonObject, namespace: string): value is JsonObject & {
  readonly sourceId: string
  readonly chunkId: string
  readonly ordinal: number
} {
  return (
    value._cruxRecordType === 'chunk' &&
    value.active === true &&
    value.namespace === namespace &&
    typeof value.sourceId === 'string' &&
    typeof value.chunkId === 'string' &&
    typeof value.ordinal === 'number'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
