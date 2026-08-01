/**
 * Content-addressed revisions for connected knowledge views.
 *
 * @module
 */

import { stableHash, stableStringify } from '../../indexing/hash'
import type { JsonObject, RecordStore } from '../../storage'
import { knowledgeViewRevisionKey } from '../keys'

export interface ViewRevisionMember extends JsonObject {
  readonly sourceId: string
  readonly contentHash: string
}

export interface KnowledgeViewRevisionRecord extends JsonObject {
  readonly _cruxRecordType: 'knowledge-view-revision'
  readonly namespace: string
  readonly viewId: string
  readonly revisionHash: string
  readonly members: readonly ViewRevisionMember[]
  readonly createdAt: number
}

export interface ResolveViewRevisionInput {
  readonly records: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly viewId: string
  readonly members: readonly ViewRevisionMember[]
}

export interface LoadViewRevisionInput {
  readonly records: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly viewId: string
  readonly revisionHash: string
}

export interface ViewRevision {
  readonly revisionHash: string
  readonly members: readonly ViewRevisionMember[]
}

/** Resolve and persist the content-addressed revision for a member set. */
export async function resolveViewRevision(input: ResolveViewRevisionInput): Promise<ViewRevision> {
  const members = normalizeMembers(input.members)
  const revisionHash = stableHash(members)
  const record: KnowledgeViewRevisionRecord = {
    _cruxRecordType: 'knowledge-view-revision',
    namespace: input.namespace,
    viewId: input.viewId,
    revisionHash,
    members,
    createdAt: Date.now(),
  }
  const key = knowledgeViewRevisionKey(input.indexerId, input.namespace, input.viewId, revisionHash)

  if (input.records.create) {
    const created = await input.records.create(key, record as unknown as JsonObject)
    if (!created) await assertExistingRevision(input.records, key, record)
  } else {
    const existing = await input.records.get(key)
    if (existing) {
      assertRevisionMatches(existing, record)
    } else {
      await input.records.put(key, record as unknown as JsonObject)
    }
  }

  return { revisionHash, members }
}

/** Load a persisted view revision by hash. */
export async function loadViewRevision(input: LoadViewRevisionInput): Promise<ViewRevision | null> {
  const record = asKnowledgeViewRevisionRecord(
    await input.records.get(knowledgeViewRevisionKey(input.indexerId, input.namespace, input.viewId, input.revisionHash)),
  )
  if (!record || record.namespace !== input.namespace || record.viewId !== input.viewId) return null
  return {
    revisionHash: record.revisionHash,
    members: record.members,
  }
}

function normalizeMembers(members: readonly ViewRevisionMember[]): readonly ViewRevisionMember[] {
  const bySource = new Map<string, string>()
  for (const member of members) {
    const existing = bySource.get(member.sourceId)
    if (existing && existing !== member.contentHash) {
      throw new Error(`View revision member "${member.sourceId}" has conflicting content hashes.`)
    }
    bySource.set(member.sourceId, member.contentHash)
  }
  return Array.from(bySource.entries())
    .map(([sourceId, contentHash]) => ({ sourceId, contentHash }))
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId) || left.contentHash.localeCompare(right.contentHash))
}

async function assertExistingRevision(
  records: RecordStore,
  key: string,
  expected: KnowledgeViewRevisionRecord,
): Promise<void> {
  const existing = await records.get(key)
  assertRevisionMatches(existing, expected)
}

function assertRevisionMatches(existing: JsonObject | null, expected: KnowledgeViewRevisionRecord): void {
  const record = asKnowledgeViewRevisionRecord(existing)
  if (!record || stableStringify(record.members) !== stableStringify(expected.members)) {
    throw new Error(`View revision "${expected.revisionHash}" already exists with different members.`)
  }
}

function asKnowledgeViewRevisionRecord(value: JsonObject | null): KnowledgeViewRevisionRecord | null {
  if (
    !value ||
    value._cruxRecordType !== 'knowledge-view-revision' ||
    typeof value.namespace !== 'string' ||
    typeof value.viewId !== 'string' ||
    typeof value.revisionHash !== 'string' ||
    typeof value.createdAt !== 'number' ||
    !Array.isArray(value.members)
  ) {
    return null
  }

  const members = value.members.map(asViewRevisionMember)
  if (members.some((member) => member === null)) return null
  return {
    _cruxRecordType: 'knowledge-view-revision',
    namespace: value.namespace,
    viewId: value.viewId,
    revisionHash: value.revisionHash,
    members: members as readonly ViewRevisionMember[],
    createdAt: value.createdAt,
  }
}

function asViewRevisionMember(value: unknown): ViewRevisionMember | null {
  if (!isRecord(value) || typeof value.sourceId !== 'string' || typeof value.contentHash !== 'string') return null
  return {
    sourceId: value.sourceId,
    contentHash: value.contentHash,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
