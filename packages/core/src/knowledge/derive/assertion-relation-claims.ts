/**
 * Assertion relation claim records and validation.
 *
 * @module
 */

import { z } from 'zod'
import { stableHash } from '../../indexing/hash'
import type { CruxChunk } from '../../indexing/types'
import type { JsonObject } from '../../storage'
import type { AssertionStage } from '../assertions/assertions'
import { createAssertionIdentity, toAssertionJsonData } from '../assertions/identity'
import type { AssertionRef, AssertionRelationType } from '../assertions/relations'
import { encodeKnowledgeRef, isKnowledgeRef, type KnowledgeRef } from '../refs'

/** Cached assertion relation claim emitted from one source. */
export interface AssertionRelationClaimRecord extends JsonObject {
  readonly _cruxRecordType: 'knowledge-assertion-relation-claim'
  readonly stageId: string
  readonly stageVersion: number
  readonly stageFingerprint: string
  readonly type: AssertionRelationType
  readonly from: AssertionRef
  readonly to: AssertionRef
  readonly evidence: readonly string[]
  readonly provenance: 'exact' | 'derived'
  readonly sourceId: string
  readonly claimHash: string
}

/** Raw assertion relation accepted from deterministic runs. */
export interface RawAssertionRelationClaim {
  readonly type: unknown
  readonly from: unknown
  readonly to: unknown
  readonly evidence?: unknown
  readonly provenance?: unknown
}

export interface AssertionRelationRunContext {
  readonly emitted: readonly AssertionRef[]
}

/** Validate raw assertion relation claims. */
export function validateAssertionRelationClaims(
  stage: AssertionStage<Record<string, z.ZodType<unknown>>>,
  rawClaims: readonly RawAssertionRelationClaim[],
  chunks: readonly CruxChunk[],
  context: AssertionRelationRunContext,
  targetKeys?: ReadonlySet<string>,
): { readonly claims: readonly NormalizedAssertionRelationClaim[]; readonly errors: readonly string[] } {
  const claims: NormalizedAssertionRelationClaim[] = []
  const errors: string[] = []
  rawClaims.forEach((raw) => {
    const type = normalizeType(raw.type)
    const evidence = normalizeEvidence(raw.evidence)
    const from = resolveEndpoint(stage, raw.from, context)
    const to = resolveEndpoint(stage, raw.to, context)
    const error = validateClaim(stage.id, type, from, to, evidence, raw.provenance, chunks, targetKeys)
    if (error) {
      errors.push(error)
      return
    }
    if (type === '<missing>' || 'error' in from || 'error' in to) return
    claims.push({
      type,
      from: from.ref,
      to: to.ref,
      evidence,
      provenance: raw.provenance === 'exact' ? 'exact' : 'derived',
    })
  })
  return { claims, errors }
}

/** Convert normalized assertion relation claims into cached records. */
export function toAssertionRelationClaimRecords(
  stage: AssertionStage<Record<string, z.ZodType<unknown>>>,
  sourceId: string,
  claims: readonly NormalizedAssertionRelationClaim[],
): readonly AssertionRelationClaimRecord[] {
  const stageFingerprint = stage.fingerprint()
  return claims.map((claim) => {
    const normalized = {
      type: claim.type,
      from: claim.from,
      to: claim.to,
      evidence: claim.evidence.map(encodeKnowledgeRef),
      provenance: claim.provenance,
    }
    const claimHash = stableHash(normalized)
    return {
      _cruxRecordType: 'knowledge-assertion-relation-claim',
      stageId: stage.id,
      stageVersion: stage.version,
      stageFingerprint,
      ...normalized,
      sourceId,
      claimHash,
    }
  })
}

/** Narrow arbitrary stored JSON to an assertion relation claim. */
export function isAssertionRelationClaimRecord(value: unknown): value is AssertionRelationClaimRecord {
  return isRecord(value) &&
    value._cruxRecordType === 'knowledge-assertion-relation-claim' &&
    typeof value.stageId === 'string' &&
    typeof value.stageVersion === 'number' &&
    typeof value.stageFingerprint === 'string' &&
    isRelationType(value.type) &&
    isAssertionRef(value.from) &&
    isAssertionRef(value.to) &&
    Array.isArray(value.evidence) &&
    value.evidence.every((ref) => typeof ref === 'string') &&
    (value.provenance === 'exact' || value.provenance === 'derived') &&
    typeof value.sourceId === 'string' &&
    typeof value.claimHash === 'string'
}

interface NormalizedAssertionRelationClaim {
  readonly type: AssertionRelationType
  readonly from: AssertionRef
  readonly to: AssertionRef
  readonly evidence: readonly KnowledgeRef[]
  readonly provenance: 'exact' | 'derived'
}

function resolveEndpoint(
  stage: AssertionStage<Record<string, z.ZodType<unknown>>>,
  endpoint: unknown,
  context: AssertionRelationRunContext,
): { readonly ref: AssertionRef } | { readonly error: string } {
  if (typeof endpoint === 'number') return context.emitted[endpoint] ? { ref: context.emitted[endpoint] } : { error: 'unknown emitted assertion index' }
  if (isAssertionRef(endpoint)) return { ref: endpoint }
  if (!isRecord(endpoint) || typeof endpoint.type !== 'string') return { error: 'invalid assertion reference' }
  const schema = stage.types[endpoint.type]
  if (!schema) return { error: 'unknown assertion reference type' }
  const parsed = schema.safeParse(endpoint.data)
  if (!parsed.success) return { error: 'invalid assertion reference data' }
  const data = toAssertionJsonData(parsed.data)
  if (data === undefined) return { error: 'assertion reference data must be JSON' }
  return { ref: { assertionId: createAssertionIdentity({
    stageId: stage.id,
    stageVersion: stage.version,
    stageFingerprint: stage.fingerprint(),
    type: endpoint.type,
    data,
  }) } }
}

function validateClaim(
  stageId: string,
  type: AssertionRelationType | '<missing>',
  from: { readonly ref: AssertionRef } | { readonly error: string },
  to: { readonly ref: AssertionRef } | { readonly error: string },
  evidence: readonly KnowledgeRef[],
  provenance: unknown,
  chunks: readonly CruxChunk[],
  targetKeys?: ReadonlySet<string>,
): string | undefined {
  if (type === '<missing>') return `Derive ${stageId}: invalid assertion relation type`
  if ('error' in from) return `Derive ${stageId} relation ${type}: ${from.error}`
  if ('error' in to) return `Derive ${stageId} relation ${type}: ${to.error}`
  if (evidence.length === 0) return `Derive ${stageId} relation ${type}: missing evidence`
  const evidenceError = invalidEvidenceMessage(stageId, type, evidence, chunks, targetKeys)
  if (evidenceError !== undefined) return evidenceError
  if (provenance !== undefined && provenance !== 'exact' && provenance !== 'derived') {
    return `Derive ${stageId} relation ${type}: invalid provenance`
  }
  return undefined
}

function invalidEvidenceMessage(
  stageId: string,
  type: AssertionRelationType | '<missing>',
  evidence: readonly KnowledgeRef[],
  chunks: readonly CruxChunk[],
  targetKeys: ReadonlySet<string> | undefined,
): string | undefined {
  for (const ref of evidence) {
    if (ref.kind !== 'chunk') return `Derive ${stageId} relation ${type}: invalid evidence`
    const key = encodeKnowledgeRef(ref)
    if (targetKeys === undefined) {
      if (!chunks.some((chunk) => chunk.sourceId === ref.sourceId && chunk.chunkId === ref.chunkId)) {
        return `Derive ${stageId} relation ${type}: invalid evidence`
      }
      continue
    }
    if (targetKeys.has(key)) continue
    return chunks.some((chunk) => chunk.sourceId === ref.sourceId && chunk.chunkId === ref.chunkId)
      ? `Derive ${stageId} relation ${type}: invalid evidence — context-only chunk`
      : `Derive ${stageId} relation ${type}: invalid evidence`
  }
  return undefined
}

function normalizeType(value: unknown): AssertionRelationType | '<missing>' {
  return isRelationType(value) ? value : '<missing>'
}

function normalizeEvidence(value: unknown): readonly KnowledgeRef[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value]
  return values.filter(isKnowledgeRef)
}

function isRelationType(value: unknown): value is AssertionRelationType {
  return value === 'supports' || value === 'amends' || value === 'supersedes' || value === 'narrows' || value === 'conflictsWith'
}

function isAssertionRef(value: unknown): value is AssertionRef {
  return isRecord(value) && typeof value.assertionId === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
