/**
 * Assertion claim records, validation, and cache helpers.
 *
 * @module
 */

import { z } from 'zod'
import { stableHash } from '../../indexing/hash'
import type { CruxChunk } from '../../indexing/types'
import type { JsonObject, JsonValue, RecordStore } from '../../storage'
import type { AssertionStage } from '../assertions/assertions'
import { toAssertionJsonData } from '../assertions/identity'
import { knowledgeClaimsKey } from '../keys'
import { encodeKnowledgeRef, isKnowledgeRef, type KnowledgeRef } from '../refs'
import { claimManifestKey, createClaimManifest, isCurrentManifest, readClaimManifest, type ClaimManifestRecord } from './manifest'
import { isAssertionRelationClaimRecord, type AssertionRelationClaimRecord } from './assertion-relation-claims'
import type { DeriveStage } from './stage'

/** Cached assertion claim emitted from one source. */
export interface AssertionClaimRecord extends JsonObject {
  readonly _cruxRecordType: 'knowledge-assertion-claim'
  readonly stageId: string
  readonly stageVersion: number
  readonly stageFingerprint: string
  readonly type: string
  readonly data: JsonValue
  readonly evidence: readonly string[]
  readonly provenance: 'exact' | 'derived'
  readonly sourceId: string
  readonly claimHash: string
  readonly status?: 'ready' | 'pending'
}

/** Raw assertion claim accepted from deterministic or generated runs. */
export type RawAssertionClaim = {
  readonly type: unknown
  readonly data: unknown
  readonly evidence?: unknown
  readonly provenance?: unknown
}

/** Normalized assertion claim ready for cache persistence. */
export interface NormalizedAssertionClaim {
  readonly type: string
  readonly data: JsonValue
  readonly evidence: readonly KnowledgeRef[]
  readonly provenance: 'exact' | 'derived'
}

/** Validate raw assertion claims against the authored schema map. */
export function validateAssertionClaims(
  stage: AssertionStage<Record<string, z.ZodType<unknown>>>,
  rawClaims: readonly RawAssertionClaim[],
  chunks: readonly CruxChunk[],
  targetKeys?: ReadonlySet<string>,
): {
  readonly claims: readonly NormalizedAssertionClaim[]
  readonly errors: readonly string[]
  readonly issues: readonly z.core.$ZodIssue[]
} {
  const claims: NormalizedAssertionClaim[] = []
  const errors: string[] = []
  const issues: z.core.$ZodIssue[] = []
  rawClaims.forEach((raw, index) => {
    const type = typeof raw.type === 'string' ? raw.type : '<missing>'
    const schema = stage.types[type]
    const evidence = normalizeEvidence(raw.evidence)
    const validated = validateClaim(stage.id, type, schema, raw, evidence, chunks, targetKeys)
    if (validated.error !== undefined) {
      errors.push(validated.error)
      issues.push(...validated.issues.map((issue) => ({ ...issue, path: [index, ...issue.path] })))
      return
    }
    claims.push({
      type,
      data: validated.data,
      evidence,
      provenance: raw.provenance === 'exact' ? 'exact' : 'derived',
    })
  })
  return { claims, errors, issues }
}

/** Convert normalized assertion claims into cached claim records. */
export function toAssertionClaimRecords(
  stage: AssertionStage<Record<string, z.ZodType<unknown>>>,
  sourceId: string,
  claims: readonly NormalizedAssertionClaim[],
): readonly AssertionClaimRecord[] {
  const stageFingerprint = stage.fingerprint()
  return claims.map((claim) => {
    const normalized = {
      type: claim.type,
      data: claim.data,
      evidence: claim.evidence.map(encodeKnowledgeRef),
      provenance: claim.provenance,
    }
    const claimHash = stableHash(normalized)
    return {
      _cruxRecordType: 'knowledge-assertion-claim',
      stageId: stage.id,
      stageVersion: stage.version,
      stageFingerprint,
      ...normalized,
      sourceId,
      claimHash,
    }
  })
}

/** Read the assertion claim manifest and include a count when its cache is valid. */
export async function readCachedAssertionClaimCount(args: {
  readonly records: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly stage: DeriveStage
  readonly sourceId: string
  readonly sourceHash: string
  readonly stageFingerprint: string
  readonly roleDigest?: string
}): Promise<{
  readonly manifest: ClaimManifestRecord | undefined
  readonly count?: number
}> {
  const manifest = await readClaimManifest(args.records, claimManifestKey({
    indexerId: args.indexerId,
    namespace: args.namespace,
    stageId: args.stage.id,
    sourceId: args.sourceId,
  }))
  if (!isCurrentManifest(manifest, args.sourceHash, args.stageFingerprint, args.roleDigest)) {
    return { manifest }
  }
  const keys = manifest.claimHashes.map((hash) => claimKey(args, hash))
  const values = args.records.getMany
    ? await args.records.getMany(keys)
    : await Promise.all(keys.map((key) => args.records.get(key)))
  return values.every((value, index) => isCachedAssertionClaimRecord(
    value,
    args.stage,
    args.sourceId,
    manifest.claimHashes[index] ?? '',
  ))
    ? { manifest, count: manifest.claimHashes.length }
    : { manifest }
}

/** Replace cached assertion claims and their source manifest. */
export async function replaceAssertionClaimRecords(args: {
  readonly records: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly stage: DeriveStage
  readonly sourceId: string
  readonly sourceHash: string
  readonly stageFingerprint: string
  readonly roleDigest?: string
  readonly previous: ClaimManifestRecord | undefined
  readonly claims: readonly (AssertionClaimRecord | AssertionRelationClaimRecord)[]
  readonly warnings: readonly string[]
}): Promise<void> {
  await deletePreviousClaims(args)
  await Promise.all(args.claims.map((claim) => args.records.put(claimKey(args, claim.claimHash), claim)))
  await args.records.put(claimManifestKey({
    indexerId: args.indexerId,
    namespace: args.namespace,
    stageId: args.stage.id,
    sourceId: args.sourceId,
  }), createClaimManifest({
    sourceHash: args.sourceHash,
    stageFingerprint: args.stageFingerprint,
    claimHashes: args.claims.map((claim) => claim.claimHash),
    warnings: args.warnings,
    ...(args.roleDigest !== undefined ? { roleDigest: args.roleDigest } : {}),
  }))
}

/** Narrow an arbitrary stored value to an assertion claim record. */
export function isAssertionClaimRecord(value: unknown): value is AssertionClaimRecord {
  return isStoredAssertionClaimRecord(value)
}

function validateClaim(
  stageId: string,
  type: string,
  schema: z.ZodType<unknown> | undefined,
  raw: RawAssertionClaim,
  evidence: readonly KnowledgeRef[],
  chunks: readonly CruxChunk[],
  targetKeys?: ReadonlySet<string>,
):
  | { readonly data: JsonValue; readonly error?: never; readonly issues?: never }
  | { readonly data?: never; readonly error: string; readonly issues: readonly z.core.$ZodIssue[] } {
  if (!schema) {
    return { error: `Derive ${stageId} type ${type}: unknown type`, issues: [validationIssue(['type'])] }
  }
  const parsed = schema.safeParse(raw.data)
  if (!parsed.success) {
    return {
      error: `Derive ${stageId} type ${type}: invalid data`,
      issues: parsed.error.issues.map((issue) => ({ ...issue, path: ['data', ...issue.path] })),
    }
  }
  const data = toAssertionJsonData(parsed.data)
  if (data === undefined) {
    return { error: `Derive ${stageId} type ${type}: data must be JSON`, issues: [validationIssue(['data'])] }
  }
  if (evidence.length === 0) {
    return { error: `Derive ${stageId} type ${type}: missing evidence`, issues: [validationIssue(['evidence'])] }
  }
  const evidenceError = invalidEvidenceMessage(stageId, type, evidence, chunks, targetKeys)
  if (evidenceError !== undefined) {
    return { error: evidenceError, issues: [validationIssue(['evidence'])] }
  }
  if (raw.provenance !== undefined && raw.provenance !== 'exact' && raw.provenance !== 'derived') {
    return { error: `Derive ${stageId} type ${type}: invalid provenance`, issues: [validationIssue(['provenance'])] }
  }
  return { data }
}

function invalidEvidenceMessage(
  stageId: string,
  type: string,
  evidence: readonly KnowledgeRef[],
  chunks: readonly CruxChunk[],
  targetKeys: ReadonlySet<string> | undefined,
): string | undefined {
  for (const ref of evidence) {
    if (ref.kind !== 'chunk') return `Derive ${stageId} type ${type}: invalid evidence`
    const key = encodeKnowledgeRef(ref)
    if (targetKeys === undefined) {
      if (!chunks.some((chunk) => chunk.sourceId === ref.sourceId && chunk.chunkId === ref.chunkId)) {
        return `Derive ${stageId} type ${type}: invalid evidence`
      }
      continue
    }
    if (targetKeys.has(key)) continue
    return chunks.some((chunk) => chunk.sourceId === ref.sourceId && chunk.chunkId === ref.chunkId)
      ? `Derive ${stageId} type ${type}: invalid evidence — context-only chunk`
      : `Derive ${stageId} type ${type}: invalid evidence`
  }
  return undefined
}

function validationIssue(path: readonly PropertyKey[]): z.core.$ZodIssue {
  return { code: 'custom', path: [...path], message: 'invalid value' }
}

function normalizeEvidence(value: unknown): readonly KnowledgeRef[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value]
  return values.filter(isKnowledgeRef)
}

function deletePreviousClaims(args: {
  readonly records: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly stage: DeriveStage
  readonly sourceId: string
  readonly previous: ClaimManifestRecord | undefined
}): Promise<void> {
  if (!args.previous) return Promise.resolve()
  const prefix = knowledgeClaimsKey(args.indexerId, args.namespace, args.stage.id, args.sourceId, '')
  const keys = args.previous.claimHashes.map((claimHash) => `${prefix}${claimHash}`)
  return args.records.deleteMany
    ? args.records.deleteMany(keys)
    : Promise.all(keys.map((key) => args.records.delete(key))).then(() => undefined)
}

function isCachedAssertionClaimRecord(
  value: unknown,
  stage: DeriveStage,
  sourceId: string,
  claimHash: string,
): value is AssertionClaimRecord | AssertionRelationClaimRecord {
  return (isStoredAssertionClaimRecord(value) || isAssertionRelationClaimRecord(value)) &&
    value.stageId === stage.id &&
    value.stageVersion === stage.version &&
    value.sourceId === sourceId &&
    value.claimHash === claimHash
}

function isStoredAssertionClaimRecord(value: unknown): value is AssertionClaimRecord {
  return isRecord(value) &&
    value._cruxRecordType === 'knowledge-assertion-claim' &&
    typeof value.stageId === 'string' &&
    typeof value.stageVersion === 'number' &&
    typeof value.stageFingerprint === 'string' &&
    typeof value.type === 'string' &&
    value.data !== undefined &&
    Array.isArray(value.evidence) &&
    value.evidence.every((ref) => typeof ref === 'string') &&
    (value.provenance === 'exact' || value.provenance === 'derived') &&
    typeof value.sourceId === 'string' &&
    typeof value.claimHash === 'string' &&
    (value.status === undefined || value.status === 'ready' || value.status === 'pending')
}

function claimKey(args: {
  readonly indexerId: string
  readonly namespace: string
  readonly stage: DeriveStage
  readonly sourceId: string
}, claimHash: string): string {
  return knowledgeClaimsKey(args.indexerId, args.namespace, args.stage.id, args.sourceId, claimHash)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
