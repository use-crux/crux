/**
 * Canonical assertion identity and persisted assertion records.
 *
 * Assertion identity is based on the authored stage contract, literal
 * assertion type, and schema-valid JSON data.
 *
 * @module
 */

import { z } from 'zod'
import { createStableId, stableHash } from '../../indexing/hash'
import type { JsonValue } from '../../storage'
import type { KnowledgeEvidenceProvenance } from '../records'
import type { KnowledgeRef } from '../refs'

/** A chunk-level support for a persisted assertion. */
export interface AssertionSupport {
  readonly sourceId: string
  readonly chunkRef: Extract<KnowledgeRef, { readonly kind: 'chunk' }>
  readonly provenance: KnowledgeEvidenceProvenance
}

/** Persisted connected knowledge assertion record. */
export interface KnowledgeAssertionRecord {
  readonly _cruxRecordType: 'knowledge-assertion'
  readonly assertionId: string
  readonly type: string
  readonly data: JsonValue
  readonly evidence: readonly AssertionSupport[]
  readonly provenance: KnowledgeEvidenceProvenance
  readonly stageId: string
  readonly stageVersion: number
  readonly stageFingerprint: string
  readonly generationId: string
  readonly namespace: string
  readonly createdAt: number
  readonly updatedAt: number
}

/** Inputs that define one canonical assertion proposition. */
export interface AssertionIdentityInput {
  readonly stageId: string
  readonly stageVersion: number
  readonly stageFingerprint: string
  readonly type: string
  readonly data: JsonValue
}

/** Create a stable assertion id for merging supports across sources. */
export function createAssertionIdentity(input: AssertionIdentityInput): string {
  return createStableId('assertion', {
    stageId: input.stageId,
    stageVersion: input.stageVersion,
    stageFingerprint: input.stageFingerprint,
    type: input.type,
    data: normalizeAssertionData(input.data),
  })
}

/** Normalize schema-valid assertion data for identity and persistence. */
export function normalizeAssertionData(data: JsonValue): JsonValue {
  if (data === null || typeof data !== 'object') return data
  if (Array.isArray(data)) return data.map(normalizeAssertionData)
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, normalizeAssertionData(value as JsonValue)]),
  )
}

/** Convert a parsed Zod output to storage-safe JSON data. */
export function toAssertionJsonData(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (Array.isArray(value)) {
    const items = value.map(toAssertionJsonData)
    return items.every((item) => item !== undefined) ? (items as readonly JsonValue[]) : undefined
  }
  if (!isRecord(value)) return undefined

  const entries: Array<readonly [string, JsonValue]> = []
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue
    const normalized = toAssertionJsonData(item)
    if (normalized === undefined) return undefined
    entries.push([key, normalized])
  }
  return normalizeAssertionData(Object.fromEntries(entries))
}

/** Serialize a Zod schema into stable fingerprint input. */
export function zodSchemaFingerprintValue(schema: z.ZodType<unknown>): unknown {
  return z.toJSONSchema(schema)
}

/** Hash schema-valid data with key-sorted object fields. */
export function hashAssertionData(data: JsonValue): string {
  return stableHash(normalizeAssertionData(data))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
