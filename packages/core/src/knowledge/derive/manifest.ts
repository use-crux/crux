/**
 * Claim cache manifest identity helpers for derivation.
 *
 * @module
 */

import type { JsonObject, RecordStore } from '../../storage'
import { knowledgeClaimsKey } from '../keys'
import { EXTRACTION_CONTRACT_VERSION } from './bounds'

const MANIFEST_HASH = '__manifest'

/** Manifest record for one source/stage claim cache entry. */
export interface ClaimManifestRecord extends JsonObject {
  readonly _cruxRecordType: 'knowledge-claim-manifest'
  readonly extractionContractVersion?: number
  readonly sourceHash: string
  readonly stageFingerprint: string
  readonly claimHashes: readonly string[]
  readonly warnings?: readonly string[]
  /** Per-stage target/context role digest; present only for stages with a selector. */
  readonly roleDigest?: string
}

/** Arguments that identify one source/stage claim manifest. */
export interface ClaimManifestKeyArgs {
  readonly indexerId: string
  readonly namespace: string
  readonly stageId: string
  readonly sourceId: string
}

/** Build the stable key for one source/stage claim manifest. */
export function claimManifestKey(args: ClaimManifestKeyArgs): string {
  return knowledgeClaimsKey(args.indexerId, args.namespace, args.stageId, args.sourceId, MANIFEST_HASH)
}

/** Read a valid claim manifest, including legacy manifests from earlier contracts. */
export function readClaimManifest(records: RecordStore, key: string): Promise<ClaimManifestRecord | undefined> {
  return records.get(key).then((value) => isManifestRecord(value) ? value : undefined)
}

/** Return true when a manifest matches the current extraction cache identity. */
export function isCurrentManifest(
  manifest: ClaimManifestRecord | undefined,
  sourceHash: string,
  stageFingerprint: string,
  roleDigest?: string,
): manifest is ClaimManifestRecord {
  return manifest !== undefined &&
    manifest.extractionContractVersion === EXTRACTION_CONTRACT_VERSION &&
    manifest.sourceHash === sourceHash &&
    manifest.stageFingerprint === stageFingerprint &&
    (manifest.roleDigest ?? null) === (roleDigest ?? null)
}

/** Create a current manifest record for persisted claim hashes. */
export function createClaimManifest(args: {
  readonly sourceHash: string
  readonly stageFingerprint: string
  readonly claimHashes: readonly string[]
  readonly warnings: readonly string[]
  readonly roleDigest?: string
}): ClaimManifestRecord {
  return {
    _cruxRecordType: 'knowledge-claim-manifest',
    extractionContractVersion: EXTRACTION_CONTRACT_VERSION,
    sourceHash: args.sourceHash,
    stageFingerprint: args.stageFingerprint,
    claimHashes: [...args.claimHashes].sort(),
    ...(args.warnings.length > 0 ? { warnings: [...args.warnings] } : {}),
    ...(args.roleDigest !== undefined ? { roleDigest: args.roleDigest } : {}),
  }
}

function isManifestRecord(value: unknown): value is ClaimManifestRecord {
  return isRecord(value) &&
    value._cruxRecordType === 'knowledge-claim-manifest' &&
    (value.extractionContractVersion === undefined || typeof value.extractionContractVersion === 'number') &&
    typeof value.sourceHash === 'string' &&
    typeof value.stageFingerprint === 'string' &&
    Array.isArray(value.claimHashes) &&
    value.claimHashes.every((hash) => typeof hash === 'string') &&
    (
      value.warnings === undefined ||
      (Array.isArray(value.warnings) && value.warnings.every((warning) => typeof warning === 'string'))
    ) &&
    (value.roleDigest === undefined || typeof value.roleDigest === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
