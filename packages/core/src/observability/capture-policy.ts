/**
 * Capture policy for privacy-sensitive observability artifacts.
 *
 * The graph contract can carry either inline previews or reference metadata.
 * This module orchestrates the shared privacy gate before records fan out.
 *
 * @module
 */

import { getHooks } from '../runtime/runtime'
import type {
  CruxGraphRecord,
  CruxObservabilityRedactionSurface,
} from './contract'
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
  type ResolvedCaptureModes,
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

/** Result of the last-mile record privacy hook. */
export type ObservabilityCaptureResult =
  | {
      readonly ok: true
      readonly record: CruxGraphRecord
      readonly redactionSurfaces: readonly CruxObservabilityRedactionSurface[]
    }
  | { readonly ok: false; readonly error?: unknown }

/** Capture-only preparation and its bounded redaction evidence. @internal */
export interface ObservabilityCaptureModesResult {
  readonly record: CruxGraphRecord
  readonly redactionSurfaces: readonly CruxObservabilityRedactionSurface[]
}

/**
 * Apply the configured capture policy to an artifact before emission.
 *
 * Disabled directions are emitted as reference artifacts with deterministic
 * size/hash metadata and no inline preview.
 */
export function applyObservabilityCapturePolicy(
  direction: CruxObservabilityArtifactDirection,
  artifact: ArtifactOptions,
): ArtifactOptions {
  try {
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
  } catch {
    return failClosedArtifact()
  }
}

/** Apply capture policy for known input/output artifact families. */
export function applyConfiguredObservabilityCapturePolicy(
  artifact: ArtifactOptions,
): ArtifactOptions {
  try {
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
  } catch {
    return failClosedArtifact()
  }
}

/**
 * Apply capture modes, configured patterns, and the optional redaction hook.
 *
 * Prefer the split capture/redaction functions when a producer must apply
 * data-only path redaction between those two steps.
 */
export function applyObservabilityCapturePolicyToRecord(
  record: CruxGraphRecord,
): ObservabilityCaptureResult {
  const captured = applyObservabilityCaptureModesToRecord(record)
  const privacy = applyObservabilityRedactionToRecord(captured.record)
  return privacy.ok
    ? {
        ...privacy,
        redactionSurfaces: canonicalizeObservabilityRedactionSurfaces([
          ...captured.redactionSurfaces,
          ...privacy.redactionSurfaces,
        ]),
      }
    : privacy
}

/** Apply capture levels without invoking the user redaction hook. @internal */
export function applyObservabilityCaptureModesToRecord(
  record: CruxGraphRecord,
): ObservabilityCaptureModesResult {
  const policy = getHooks().observabilityCapture
  const modes = resolveCaptureModes(policy)
  const patterns = normalizeObservabilityRedactionPatterns(
    policy?.redactPatterns,
  )
  const marker = consumeObservabilityRedactionMarker(record)
  const prepared = prepareObservabilityRecordForCapture(marker.record, modes)
  const patternRedacted = redactObservabilityRecordDetailed(prepared, patterns)
  return {
    record: applyCaptureLevelToRecord(patternRedacted.value, modes),
    redactionSurfaces: canonicalizeObservabilityRedactionSurfaces([
      ...marker.surfaces,
      ...patternRedacted.surfaces,
    ]),
  }
}

/** Invoke the configured last-mile record redactor exactly once. @internal */
export function applyObservabilityRedactionToRecord(
  record: CruxGraphRecord,
  modes = resolveCaptureModes(getHooks().observabilityCapture),
): ObservabilityCaptureResult {
  const policy = getHooks().observabilityCapture
  try {
    const redactRecord = captureRedactRecord(modes) ?? policy?.redactRecord
    const redacted = redactRecord ? redactRecord(record) : record
    return redacted
      ? {
          ok: true,
          record: stripObservabilityRedactionMetadata(redacted),
          redactionSurfaces: [],
        }
      : { ok: false }
  } catch (error) {
    return { ok: false, error }
  }
}

/** Return a content-free artifact without rereading a potentially hostile input. */
function failClosedArtifact(): ArtifactOptions {
  return {
    kind: 'custom.redaction-failure',
    contentType: 'application/octet-stream',
    encoding: 'reference',
  }
}
