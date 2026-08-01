/**
 * Exact-value membership indexes for connected knowledge views.
 *
 * @module
 */

import type { JsonObject, RecordEntry, RecordStore } from '../../storage'
import { knowledgeViewIndexKey } from '../keys'
import type { NormalizedViewWhere } from './where'

type Scalar = string | number | boolean

export interface ViewMembershipIndexRecord extends JsonObject {
  readonly _cruxRecordType: 'knowledge-view-index'
  readonly namespace: string
  readonly viewId: string
  readonly field: string
  readonly value: Scalar
  readonly sourceId: string
}

export interface ApplyMembershipForSourceInput {
  readonly records: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly viewId: string
  readonly where: NormalizedViewWhere
  readonly sourceId: string
  readonly metadata?: Record<string, unknown> | null
}

export interface ResolveViewMembersInput {
  readonly records: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly viewId: string
  readonly where: NormalizedViewWhere
}

/** Update one source's exact-value entries for every field referenced by a view. */
export async function applyMembershipForSource(input: ApplyMembershipForSourceInput): Promise<void> {
  const referenced = referencedValues(input.where)
  for (const [field, values] of referenced) {
    for (const value of values.values()) {
      await input.records.delete(indexKey(input, field, value, input.sourceId))
    }

    const metadataValue = input.metadata?.[field]
    if (!isScalar(metadataValue)) continue
    const metadataKey = scalarIndexValue(metadataValue)
    if (!values.has(metadataKey)) continue

    const record: ViewMembershipIndexRecord = {
      _cruxRecordType: 'knowledge-view-index',
      namespace: input.namespace,
      viewId: input.viewId,
      field,
      value: metadataValue,
      sourceId: input.sourceId,
    }
    await input.records.put(indexKey(input, field, metadataValue, input.sourceId), record)
  }
}

/** Resolve current view members from exact-value index entries only. */
export async function resolveViewMembers(input: ResolveViewMembersInput): Promise<readonly string[]> {
  const clauseMembers = await Promise.all(input.where.any.map((clause) => resolveClause(input, clause)))
  const union = new Set<string>()
  for (const members of clauseMembers) {
    for (const sourceId of members) {
      union.add(sourceId)
    }
  }
  return Array.from(union).sort()
}

async function resolveClause(
  input: ResolveViewMembersInput,
  clause: NormalizedViewWhere['any'][number],
): Promise<Set<string>> {
  let result: Set<string> | null = null
  for (const term of clause) {
    const termMembers = new Set<string>()
    for (const value of term.values) {
      for (const sourceId of await listSourceIds(input, term.field, value)) {
        termMembers.add(sourceId)
      }
    }
    result = result ? intersect(result, termMembers) : termMembers
    if (result.size === 0) break
  }
  return result ?? new Set()
}

async function listSourceIds(input: ResolveViewMembersInput, field: string, value: Scalar): Promise<readonly string[]> {
  const prefix = indexKey(input, field, value, '')
  const sourceIds = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await input.records.list(prefix, { cursor, limit: 100 })
    for (const entry of page.entries) {
      const sourceId = sourceIdFromEntry(entry, prefix)
      if (sourceId) sourceIds.add(sourceId)
    }
    cursor = page.cursor
  } while (cursor)
  return Array.from(sourceIds).sort()
}

function sourceIdFromEntry(entry: RecordEntry, prefix: string): string | null {
  const record = entry.value
  if (
    record._cruxRecordType === 'knowledge-view-index' &&
    typeof record.sourceId === 'string' &&
    record.sourceId.length > 0
  ) {
    return record.sourceId
  }
  const suffix = entry.key.slice(prefix.length)
  return suffix.length > 0 ? suffix : null
}

function referencedValues(where: NormalizedViewWhere): Map<string, Map<string, Scalar>> {
  const result = new Map<string, Map<string, Scalar>>()
  for (const clause of where.any) {
    for (const term of clause) {
      const values = result.get(term.field) ?? new Map<string, Scalar>()
      for (const value of term.values) {
        values.set(scalarIndexValue(value), value)
      }
      result.set(term.field, values)
    }
  }
  return result
}

function intersect(left: Set<string>, right: Set<string>): Set<string> {
  const result = new Set<string>()
  for (const value of left) {
    if (right.has(value)) result.add(value)
  }
  return result
}

function indexKey(
  input: { readonly indexerId: string, readonly namespace: string, readonly viewId: string },
  field: string,
  value: Scalar,
  sourceId: string,
): string {
  return knowledgeViewIndexKey(input.indexerId, input.namespace, input.viewId, field, scalarIndexValue(value), sourceId)
}

function scalarIndexValue(value: Scalar): string {
  if (typeof value === 'string') return `string:${encodeSegment(value)}`
  if (typeof value === 'number') return `number:${String(value)}`
  return `boolean:${String(value)}`
}

function encodeSegment(value: string): string {
  return value.replace(/%/g, '%25').replace(/:/g, '%3A')
}

function isScalar(value: unknown): value is Scalar {
  return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
}
