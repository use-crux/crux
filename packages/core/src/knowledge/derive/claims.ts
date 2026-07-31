/**
 * Claim records, validation, and cache helpers for derivation.
 *
 * @module
 */

import { z } from 'zod'
import { stableHash } from '../../indexing/hash'
import { computeSourceHashes } from '../../indexing/source-hash'
import type { CruxChunk, CruxDocument } from '../../indexing/types'
import type { JsonObject, RecordStore } from '../../storage'
import { knowledgeClaimsKey } from '../keys'
import { encodeKnowledgeRef, isKnowledgeRef, type KnowledgeRef, type KnowledgeRefKind } from '../refs'
import type { RelationStage, RelationTypeSpec } from '../relate/relate'
import type { DeriveStage } from './stage'

const MANIFEST_HASH = '__manifest'
const MAX_DESCRIPTION_LENGTH = 1000

export interface ClaimRecord extends JsonObject {
  readonly _cruxRecordType: 'knowledge-claim'
  readonly stageId: string
  readonly stageVersion: number
  readonly type: string
  readonly from: string
  readonly to: string
  readonly description?: string
  readonly evidence: readonly string[]
  readonly provenance: 'exact' | 'derived'
  readonly sourceId: string
  readonly claimHash: string
}

export interface ClaimManifestRecord extends JsonObject {
  readonly _cruxRecordType: 'knowledge-claim-manifest'
  readonly sourceHash: string
  readonly stageFingerprint: string
  readonly claimHashes: readonly string[]
}

export type RawRelationClaim = {
  readonly type: unknown
  readonly from: unknown
  readonly to: unknown
  readonly description?: unknown
  readonly evidence?: unknown
  readonly provenance?: unknown
}

export type NormalizedRelationClaim = {
  readonly type: string
  readonly from: KnowledgeRef
  readonly to: KnowledgeRef
  readonly description?: string
  readonly evidence: readonly KnowledgeRef[]
  readonly provenance: 'exact' | 'derived'
}

const refSchema: z.ZodType<KnowledgeRef> = z.union([
  z.object({ kind: z.literal('document'), sourceId: z.string() }).strict(),
  z.object({ kind: z.literal('parent'), sourceId: z.string(), parentId: z.string() }).strict(),
  z.object({ kind: z.literal('chunk'), sourceId: z.string(), chunkId: z.string() }).strict(),
  z.object({ kind: z.literal('entity'), entityId: z.string() }).strict(),
])

export const claimsSchema = z.object({
  claims: z.array(
    z.object({
      type: z.string(),
      from: refSchema,
      to: refSchema,
      description: z.string().optional(),
      evidence: z.array(refSchema).min(1),
      provenance: z.enum(['exact', 'derived']).optional(),
    }).strict(),
  ),
}).strict()

export function deriveClaimsSourceHash(document: CruxDocument, chunks: readonly CruxChunk[]): string {
  return computeSourceHashes({
    ...document,
    content: [document.content ?? '', ...chunks.map((chunk) => chunk.content)].join('\n'),
  }).sourceHash
}

export function claimManifestKey(args: {
  readonly indexerId: string
  readonly namespace: string
  readonly stageId: string
  readonly sourceId: string
}): string {
  return knowledgeClaimsKey(args.indexerId, args.namespace, args.stageId, args.sourceId, MANIFEST_HASH)
}

export function validateRelationClaims(
  stage: RelationStage<Record<string, RelationTypeSpec>>,
  rawClaims: readonly RawRelationClaim[],
): { readonly claims: readonly NormalizedRelationClaim[]; readonly errors: readonly string[] } {
  const claims: NormalizedRelationClaim[] = []
  const errors: string[] = []
  rawClaims.forEach((raw) => {
    const type = typeof raw.type === 'string' ? raw.type : '<missing>'
    const spec = stage.types[type]
    const evidence = normalizeEvidence(raw.evidence)
    const error = validateClaim(stage.id, type, spec, raw, evidence)
    if (error) {
      errors.push(error)
      return
    }
    claims.push({
      type,
      from: raw.from as KnowledgeRef,
      to: raw.to as KnowledgeRef,
      ...(raw.description !== undefined ? { description: raw.description as string } : {}),
      evidence,
      provenance: raw.provenance === 'exact' ? 'exact' : 'derived',
    })
  })
  return { claims, errors }
}

export function toClaimRecords(
  stage: DeriveStage,
  sourceId: string,
  claims: readonly NormalizedRelationClaim[],
): readonly ClaimRecord[] {
  return claims.map((claim) => {
    const normalized = {
      type: claim.type,
      from: encodeKnowledgeRef(claim.from),
      to: encodeKnowledgeRef(claim.to),
      ...(claim.description !== undefined ? { description: claim.description } : {}),
      evidence: claim.evidence.map(encodeKnowledgeRef),
      provenance: claim.provenance,
    }
    const claimHash = stableHash(normalized)
    return {
      _cruxRecordType: 'knowledge-claim',
      stageId: stage.id,
      stageVersion: stage.version,
      ...normalized,
      sourceId,
      claimHash,
    }
  })
}

export async function readCachedClaimCount(args: {
  readonly records: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly stage: DeriveStage
  readonly sourceId: string
  readonly sourceHash: string
  readonly stageFingerprint: string
}): Promise<number | undefined> {
  const manifest = await readClaimManifest(args.records, claimManifestKey({
    indexerId: args.indexerId,
    namespace: args.namespace,
    stageId: args.stage.id,
    sourceId: args.sourceId,
  }))
  if (!manifest || manifest.sourceHash !== args.sourceHash || manifest.stageFingerprint !== args.stageFingerprint) {
    return undefined
  }
  const keys = manifest.claimHashes.map((claimHash) => knowledgeClaimsKey(
    args.indexerId,
    args.namespace,
    args.stage.id,
    args.sourceId,
    claimHash,
  ))
  const values = args.records.getMany
    ? await args.records.getMany(keys)
    : await Promise.all(keys.map((key) => args.records.get(key)))
  return values.every((value, index) => isClaimRecord(
    value,
    args.stage,
    args.sourceId,
    manifest.claimHashes[index] ?? '',
  ))
    ? manifest.claimHashes.length
    : undefined
}

export async function replaceClaimRecords(args: {
  readonly records: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly stage: DeriveStage
  readonly sourceId: string
  readonly sourceHash: string
  readonly stageFingerprint: string
  readonly previous: ClaimManifestRecord | undefined
  readonly claims: readonly ClaimRecord[]
}): Promise<void> {
  await deletePreviousClaims(args)
  await Promise.all(args.claims.map((claim) => args.records.put(knowledgeClaimsKey(
    args.indexerId,
    args.namespace,
    args.stage.id,
    args.sourceId,
    claim.claimHash,
  ), claim)))
  await args.records.put(claimManifestKey({
    indexerId: args.indexerId,
    namespace: args.namespace,
    stageId: args.stage.id,
    sourceId: args.sourceId,
  }), {
    _cruxRecordType: 'knowledge-claim-manifest',
    sourceHash: args.sourceHash,
    stageFingerprint: args.stageFingerprint,
    claimHashes: args.claims.map((claim) => claim.claimHash).sort(),
  })
}

export function readClaimManifest(records: RecordStore, key: string): Promise<ClaimManifestRecord | undefined> {
  return records.get(key).then((value) => isManifestRecord(value) ? value : undefined)
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
  const keys = args.previous.claimHashes.map((claimHash) => knowledgeClaimsKey(
    args.indexerId,
    args.namespace,
    args.stage.id,
    args.sourceId,
    claimHash,
  ))
  return args.records.deleteMany
    ? args.records.deleteMany(keys)
    : Promise.all(keys.map((key) => args.records.delete(key))).then(() => undefined)
}

function validateClaim(
  stageId: string,
  type: string,
  spec: RelationTypeSpec | undefined,
  raw: RawRelationClaim,
  evidence: readonly KnowledgeRef[],
): string | undefined {
  if (!spec) return `Derive ${stageId} type ${type}: unknown type`
  if (!isKnowledgeRef(raw.from) || !spec.from.includes(raw.from.kind as KnowledgeRefKind)) {
    return `Derive ${stageId} type ${type}: invalid from endpoint`
  }
  if (!isKnowledgeRef(raw.to) || !spec.to.includes(raw.to.kind as KnowledgeRefKind)) {
    return `Derive ${stageId} type ${type}: invalid to endpoint`
  }
  if (evidence.length === 0) return `Derive ${stageId} type ${type}: missing evidence`
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string') return `Derive ${stageId} type ${type}: invalid description`
    if (raw.description.length > MAX_DESCRIPTION_LENGTH) return `Derive ${stageId} type ${type}: description too long`
  }
  if (raw.provenance !== undefined && raw.provenance !== 'exact' && raw.provenance !== 'derived') {
    return `Derive ${stageId} type ${type}: invalid provenance`
  }
  return undefined
}

function normalizeEvidence(value: unknown): readonly KnowledgeRef[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value]
  return values.filter(isKnowledgeRef)
}

function isManifestRecord(value: unknown): value is ClaimManifestRecord {
  return isRecord(value) &&
    value._cruxRecordType === 'knowledge-claim-manifest' &&
    typeof value.sourceHash === 'string' &&
    typeof value.stageFingerprint === 'string' &&
    Array.isArray(value.claimHashes) &&
    value.claimHashes.every((hash) => typeof hash === 'string')
}

function isClaimRecord(value: unknown, stage: DeriveStage, sourceId: string, claimHash: string): value is ClaimRecord {
  return isRecord(value) &&
    value._cruxRecordType === 'knowledge-claim' &&
    value.stageId === stage.id &&
    value.stageVersion === stage.version &&
    value.sourceId === sourceId &&
    value.claimHash === claimHash
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
