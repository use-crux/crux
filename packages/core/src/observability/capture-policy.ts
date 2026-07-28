/**
 * Capture policy for privacy-sensitive observability artifacts.
 *
 * The graph contract can carry either inline previews or reference metadata.
 * This module orchestrates the shared privacy gate before records fan out.
 *
 * @module
 */

import { getHooks } from '../runtime/runtime'
import type { CruxGraphRecord } from './contract'
import type { ObserveArtifactOptions } from './observe'
import type { CruxObservabilityArtifactDirection } from './capture-policy-contract'
import {
  applyCaptureLevelToArtifact,
  applyCaptureLevelToRecord,
  captureLevelForArtifact,
  captureLevelForDirection,
  captureRedactRecord,
  prepareObservabilityRecordForCapture,
  resolveCaptureModes,
} from './capture-levels'
import {
  redactObservabilityArtifactDetailed,
  redactObservabilityRecordDetailed,
} from './redaction-record'
import {
  canonicalizeObservabilityRedactionSurfaces,
  consumeObservabilityRedactionMarker,
  markArtifactRedactionEvidence,
  stripObservabilityRedactionMetadata,
} from './redaction-evidence'
import type { CruxObservabilityRedactionSurface } from './contract'
import { normalizeObservabilityRedactionPatterns } from './redaction-patterns'

export { PAYLOAD_ATTRIBUTE_KEYS } from './capture-policy-contract'
export { stripPayloadAttributes } from './capture-policy-payload'
export type {
  CruxObservabilityArtifactDirection,
  CruxObservabilityCaptureConfig,
  CruxObservabilityCaptureLevel,
  CruxObservabilityCaptureMode,
  CruxObservabilityCapturePolicy,
  CruxObservabilityCaptureTarget,
  CruxObservabilityRedactionPattern,
  CruxSafetyArtifactKind,
} from './capture-policy-contract'

type ArtifactOptions = ObserveArtifactOptions

export type ObservabilityCaptureResult =
  | {
      readonly ok: true
      readonly record: CruxGraphRecord
      readonly redactionSurfaces: readonly CruxObservabilityRedactionSurface[]
    }
  | { readonly ok: false; readonly error?: unknown }

/**
 * Apply the configured capture policy to an artifact before emission.
 *
 * Disabled directions are emitted as `reference` artifacts with deterministic
 * size/hash metadata and no inline preview.
 */
export function applyObservabilityCapturePolicy(
  direction: CruxObservabilityArtifactDirection,
  artifact: ArtifactOptions,
): ArtifactOptions {
  const policy = getHooks().observabilityCapture
  const modes = resolveCaptureModes(policy)
  const patterns = normalizeObservabilityRedactionPatterns(
    policy?.redactPatterns,
  )
  const redacted = redactObservabilityArtifactDetailed(artifact, patterns)
  const captured = applyCaptureLevelToArtifact(
    captureLevelForDirection(modes, direction),
    redacted.value,
  )
  return markArtifactRedactionEvidence(captured, redacted.surfaces)
}

/** Apply capture policy for known input/output artifact families. */
export function applyConfiguredObservabilityCapturePolicy(
  artifact: ArtifactOptions,
): ArtifactOptions {
  const policy = getHooks().observabilityCapture
  const modes = resolveCaptureModes(policy)
  const level = captureLevelForArtifact(modes, artifact.kind)
  const patterns = normalizeObservabilityRedactionPatterns(
    policy?.redactPatterns,
  )
  const redacted = redactObservabilityArtifactDetailed(artifact, patterns)
  const captured = level
    ? applyCaptureLevelToArtifact(level, redacted.value)
    : redacted.value
  return markArtifactRedactionEvidence(captured, redacted.surfaces)
}

/**
 * Apply capture modes and the optional redaction hook to a graph record.
 *
 * This is the emit-bound privacy gate. Every consumer downstream of `emit()`
 * receives this result: subscribers, diagnostics channel, transports, and the
 * OTel subscriber.
 */
export function applyObservabilityCapturePolicyToRecord(
  record: CruxGraphRecord,
): ObservabilityCaptureResult {
  const policy = getHooks().observabilityCapture

  try {
    const patterns = normalizeObservabilityRedactionPatterns(
      policy?.redactPatterns,
    )
    const modes = resolveCaptureModes(policy)
    const marker = consumeObservabilityRedactionMarker(record)
    const prepared = prepareObservabilityRecordForCapture(marker.record, modes)
    const patternRedacted = redactObservabilityRecordDetailed(
      prepared,
      patterns,
    )
    const policyRecord = applyCaptureLevelToRecord(
      patternRedacted.value,
      modes,
    )
    const redactRecord = captureRedactRecord(modes) ?? policy?.redactRecord
    const redacted = redactRecord ? redactRecord(policyRecord) : policyRecord
    return redacted
      ? {
          ok: true,
          record: stripObservabilityRedactionMetadata(redacted),
          redactionSurfaces: canonicalizeObservabilityRedactionSurfaces([
            ...marker.surfaces,
            ...patternRedacted.surfaces,
          ]),
        }
      : { ok: false }
  } catch (error) {
    return { ok: false, error }
  }
}
