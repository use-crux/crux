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
  readonly stageId: string, readonly stageVersion: number, readonly type: string
  readonly direction?: 'directed' | 'symmetric'
  readonly from: string | KnowledgeLocator, readonly to: string | KnowledgeLocator
  readonly description?: string
  readonly evidence: readonly string[], readonly provenance: 'exact' | 'derived'
  readonly sourceId: string, readonly claimHash: string
  readonly status?: 'ready' | 'pending'
}
export interface ClaimManifestRecord extends JsonObject {
  readonly _cruxRecordType: 'knowledge-claim-manifest'
  readonly sourceHash: string, readonly stageFingerprint: string
  readonly claimHashes: readonly string[]
  readonly warnings?: readonly string[]
}
export type RawRelationClaim = {
  readonly type: unknown, readonly from: unknown, readonly to: unknown
  readonly description?: unknown, readonly evidence?: unknown, readonly provenance?: unknown
}
export type KnowledgeLocator = { readonly url: string } | { readonly title: string } | { readonly anchor: string }
export type RelationClaimEndpoint = KnowledgeRef | KnowledgeLocator
export type NormalizedRelationClaim = {
  readonly type: string, readonly from: RelationClaimEndpoint, readonly to: RelationClaimEndpoint, readonly description?: string
  readonly evidence: readonly KnowledgeRef[], readonly provenance: 'exact' | 'derived'
}
const refSchema: z.ZodType<KnowledgeRef> = z.union([
  z.object({ kind: z.literal('document'), sourceId: z.string() }).strict(),
  z.object({ kind: z.literal('parent'), sourceId: z.string(), parentId: z.string() }).strict(),
  z.object({ kind: z.literal('chunk'), sourceId: z.string(), chunkId: z.string() }).strict(),
  z.object({ kind: z.literal('entity'), entityId: z.string() }).strict(),
])
const locatorSchema: z.ZodType<KnowledgeLocator> = z.union([
  z.object({ url: z.string().min(1) }).strict(),
  z.object({ title: z.string().min(1) }).strict(),
  z.object({ anchor: z.string().min(1) }).strict(),
])
const endpointSchema = z.union([refSchema, locatorSchema])
export const claimsSchema = z.object({
  claims: z.array(z.object({
    type: z.string(),
    from: endpointSchema,
    to: endpointSchema,
    description: z.string().optional(),
    evidence: z.array(refSchema).min(1),
    provenance: z.enum(['exact', 'derived']).optional(),
  }).strict()),
}).strict()
export function deriveClaimsSourceHash(document: CruxDocument, chunks: readonly CruxChunk[]): string {
  return computeSourceHashes({
    ...document,
    content: [document.content ?? '', ...chunks.map((chunk) => chunk.content)].join('\n'),
  }).sourceHash
}
type ClaimKeyArgs = {
  readonly indexerId: string, readonly namespace: string, readonly stageId: string, readonly sourceId: string
}
type ClaimCacheArgs = {
  readonly records: RecordStore, readonly indexerId: string, readonly namespace: string
  readonly stage: DeriveStage, readonly sourceId: string
}
export function claimManifestKey(args: ClaimKeyArgs): string {
  return knowledgeClaimsKey(args.indexerId, args.namespace, args.stageId, args.sourceId, MANIFEST_HASH)
}

export function validateRelationClaims(
  stage: RelationStage<Record<string, RelationTypeSpec>>,
  rawClaims: readonly RawRelationClaim[],
): { readonly claims: readonly NormalizedRelationClaim[], readonly errors: readonly string[] } {
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
      from: raw.from as RelationClaimEndpoint,
      to: raw.to as RelationClaimEndpoint,
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
    const relationStage = stage as DeriveStage & { readonly types?: Record<string, RelationTypeSpec> }
    const spec = relationStage.types?.[claim.type]
    const normalized = {
      type: claim.type,
      from: encodeClaimEndpoint(claim.from),
      to: encodeClaimEndpoint(claim.to),
      ...(claim.description !== undefined ? { description: claim.description } : {}),
      evidence: claim.evidence.map(encodeKnowledgeRef),
      provenance: claim.provenance,
    }
    const claimHash = stableHash(normalized)
    return {
      _cruxRecordType: 'knowledge-claim',
      stageId: stage.id,
      stageVersion: stage.version,
      ...(spec ? { direction: spec.direction } : {}),
      ...normalized,
      sourceId,
      claimHash,
    }
  })
}

export async function readCachedClaimCount(args: ClaimCacheArgs & {
  readonly sourceHash: string, readonly stageFingerprint: string
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
  return values.every((value, index) => isCachedClaimRecord(
    value,
    args.stage,
    args.sourceId,
    manifest.claimHashes[index] ?? '',
  ))
    ? manifest.claimHashes.length
    : undefined
}

export async function replaceClaimRecords(args: ClaimCacheArgs & {
  readonly sourceHash: string, readonly stageFingerprint: string
  readonly previous: ClaimManifestRecord | undefined
  readonly claims: readonly ClaimRecord[]
  readonly warnings: readonly string[]
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
    ...(args.warnings.length > 0 ? { warnings: [...args.warnings] } : {}),
  })
}

export function readClaimManifest(records: RecordStore, key: string): Promise<ClaimManifestRecord | undefined> {
  return records.get(key).then((value) => isManifestRecord(value) ? value : undefined)
}

export function isClaimRecord(value: unknown): value is ClaimRecord {
  return isStoredClaimRecord(value)
}

export function encodeClaimEndpoint(endpoint: RelationClaimEndpoint): string | KnowledgeLocator {
  return isKnowledgeRef(endpoint) ? encodeKnowledgeRef(endpoint) : endpoint
}

export function isKnowledgeLocator(value: unknown): value is KnowledgeLocator {
  return isRecord(value) && ['url', 'title', 'anchor'].some((key) =>
    onlyStringField(value, key as 'url' | 'title' | 'anchor'))
}

function deletePreviousClaims(args: ClaimCacheArgs & { readonly previous: ClaimManifestRecord | undefined }): Promise<void> {
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
  if (!isValidEndpoint(raw.from, spec.from)) {
    return `Derive ${stageId} type ${type}: invalid from endpoint`
  }
  if (!isValidEndpoint(raw.to, spec.to)) {
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

function isValidEndpoint(value: unknown, kinds: readonly KnowledgeRefKind[]): boolean {
  return isKnowledgeLocator(value) || (isKnowledgeRef(value) && kinds.includes(value.kind as KnowledgeRefKind))
}

function isManifestRecord(value: unknown): value is ClaimManifestRecord {
  return isRecord(value) &&
    value._cruxRecordType === 'knowledge-claim-manifest' &&
    typeof value.sourceHash === 'string' &&
    typeof value.stageFingerprint === 'string' &&
    Array.isArray(value.claimHashes) &&
    value.claimHashes.every((hash) => typeof hash === 'string') &&
    (
      value.warnings === undefined ||
      (Array.isArray(value.warnings) && value.warnings.every((warning) => typeof warning === 'string'))
    )
}

function isCachedClaimRecord(value: unknown, stage: DeriveStage, sourceId: string, claimHash: string): value is ClaimRecord {
  return isStoredClaimRecord(value) &&
    value.stageId === stage.id &&
    value.stageVersion === stage.version &&
    value.sourceId === sourceId &&
    value.claimHash === claimHash
}

function isStoredClaimRecord(value: unknown): value is ClaimRecord {
  if (!isRecord(value) || value._cruxRecordType !== 'knowledge-claim') return false
  return typeof value.stageId === 'string' && typeof value.stageVersion === 'number' &&
    typeof value.type === 'string' &&
    (value.direction === undefined || value.direction === 'directed' || value.direction === 'symmetric') &&
    (typeof value.from === 'string' || isKnowledgeLocator(value.from)) &&
    (typeof value.to === 'string' || isKnowledgeLocator(value.to)) &&
    Array.isArray(value.evidence) && value.evidence.every((ref) => typeof ref === 'string') &&
    (value.provenance === 'exact' || value.provenance === 'derived') &&
    typeof value.sourceId === 'string' && typeof value.claimHash === 'string' &&
    (value.status === undefined || value.status === 'ready' || value.status === 'pending')
}

function onlyStringField(value: Record<string, unknown>, key: 'url' | 'title' | 'anchor'): boolean {
  return typeof value[key] === 'string' && Object.keys(value).length === 1 && Boolean(value[key].trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
