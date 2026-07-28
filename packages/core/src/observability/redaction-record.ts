import type {
  CruxAttributes,
  CruxGraphRecord,
  CruxObservabilityRedactionSurface,
} from './contract'
import type { CruxObservabilityRedactionPattern } from './capture-policy-contract'
import {
  byteLength,
  hashString,
  serializePreview,
} from './capture-policy-utils'
import { redactObservabilityString } from './redaction-patterns'
import { redactObservabilityValue } from './redaction-value'

/** Copy-on-write redaction output with canonical affected surfaces. */
export interface ObservabilityRedactionResult<T> {
  readonly value: T
  readonly surfaces: readonly CruxObservabilityRedactionSurface[]
}

/**
 * Redact approved payload surfaces before capture evidence is derived.
 *
 * The transformation is copy-on-write and leaves the canonical input record
 * unchanged.
 */
export function redactObservabilityRecord(
  record: CruxGraphRecord,
  patterns: readonly CruxObservabilityRedactionPattern[] | undefined,
): CruxGraphRecord {
  return redactObservabilityRecordDetailed(record, patterns).value
}

/** Redact a graph record and report only its affected broad surfaces. */
export function redactObservabilityRecordDetailed(
  record: CruxGraphRecord,
  patterns: readonly CruxObservabilityRedactionPattern[] | undefined,
): ObservabilityRedactionResult<CruxGraphRecord> {
  if (patterns === undefined || patterns.length === 0) {
    return { value: record, surfaces: [] }
  }
  if (record.type === 'artifact') {
    return redactObservabilityArtifactDetailed(record, patterns)
  }
  let redacted = record
  const surfaces: CruxObservabilityRedactionSurface[] = []
  if ('attributes' in redacted && redacted.attributes !== undefined) {
    const attributes = redactObservabilityValue(redacted.attributes, patterns)
    if (attributes !== redacted.attributes) {
      redacted = Object.assign({}, redacted, { attributes })
      surfaces.push('attributes')
    }
  }
  if (
    'error' in redacted &&
    redacted.error !== undefined &&
    typeof redacted.error.message === 'string'
  ) {
    const message = redactObservabilityString(
      redacted.error.message,
      patterns,
    )
    if (message !== redacted.error.message) {
      redacted = Object.assign({}, redacted, {
        error: Object.assign({}, redacted.error, { message }),
      })
      surfaces.push('error.message')
    }
  }
  return { value: redacted, surfaces }
}

/**
 * Redact an artifact string preview while preserving its exact caller-visible
 * type.
 */
export function redactObservabilityArtifact<
  T extends {
    readonly preview?: unknown
    readonly uri?: string
    readonly attributes?: CruxAttributes
    readonly hash?: string
    readonly sizeBytes?: number
  },
>(
  artifact: T,
  patterns: readonly CruxObservabilityRedactionPattern[] | undefined,
): T {
  return redactObservabilityArtifactDetailed(artifact, patterns).value
}

/** Redact artifact payload fields and report affected broad surfaces. */
export function redactObservabilityArtifactDetailed<
  T extends {
    readonly preview?: unknown
    readonly uri?: string
    readonly attributes?: CruxAttributes
    readonly hash?: string
    readonly sizeBytes?: number
  },
>(
  artifact: T,
  patterns: readonly CruxObservabilityRedactionPattern[] | undefined,
): ObservabilityRedactionResult<T> {
  if (patterns === undefined || patterns.length === 0) {
    return { value: artifact, surfaces: [] }
  }
  const preview = redactObservabilityValue(artifact.preview, patterns)
  const uri =
    artifact.uri === undefined
      ? undefined
      : redactObservabilityString(artifact.uri, patterns)
  const attributes = redactObservabilityValue(artifact.attributes, patterns)
  if (
    preview === artifact.preview &&
    uri === artifact.uri &&
    attributes === artifact.attributes
  ) {
    return { value: artifact, surfaces: [] }
  }
  const previewChanged = preview !== artifact.preview
  const serialized = previewChanged ? serializePreview(preview) : undefined
  const value = Object.assign({}, artifact, {
    ...(previewChanged ? { preview } : {}),
    ...(uri !== artifact.uri ? { uri } : {}),
    ...(attributes !== artifact.attributes ? { attributes } : {}),
    ...(serialized !== undefined && artifact.sizeBytes !== undefined
      ? { sizeBytes: byteLength(serialized) }
      : {}),
    ...(serialized !== undefined && artifact.hash !== undefined
      ? { hash: hashString(serialized) }
      : {}),
  })
  const surfaces: CruxObservabilityRedactionSurface[] = []
  if (previewChanged) surfaces.push('artifact.preview')
  if (uri !== artifact.uri) surfaces.push('artifact.uri')
  if (attributes !== artifact.attributes) surfaces.push('attributes')
  return { value, surfaces }
}

/**
 * Redact approved surfaces after arbitrary records become JSON-safe.
 *
 * Graph validation remains authoritative for the returned `unknown` value.
 */
export function redactSanitizedObservabilityRecord(
  record: unknown,
  patterns: readonly CruxObservabilityRedactionPattern[] | undefined,
): unknown {
  return redactSanitizedObservabilityRecordDetailed(record, patterns).value
}

/** Redact a JSON-safe record and report affected broad surfaces. */
export function redactSanitizedObservabilityRecordDetailed(
  record: unknown,
  patterns: readonly CruxObservabilityRedactionPattern[] | undefined,
): ObservabilityRedactionResult<unknown> {
  if (patterns === undefined || patterns.length === 0) {
    return { value: record, surfaces: [] }
  }
  if (!isRecord(record)) return { value: record, surfaces: [] }
  if (isSanitizedArtifact(record)) {
    return redactObservabilityArtifactDetailed(record, patterns)
  }

  let redacted = record
  const surfaces: CruxObservabilityRedactionSurface[] = []
  if ('attributes' in redacted) {
    const attributes = redactObservabilityValue(redacted.attributes, patterns)
    if (attributes !== redacted.attributes) {
      redacted = Object.assign({}, redacted, { attributes })
      surfaces.push('attributes')
    }
  }
  if ('error' in redacted && isRecord(redacted.error)) {
    const message = redacted.error.message
    if (typeof message === 'string') {
      const redactedMessage = redactObservabilityString(message, patterns)
      if (redactedMessage !== message) {
        redacted = Object.assign({}, redacted, {
          error: Object.assign({}, redacted.error, {
            message: redactedMessage,
          }),
        })
        surfaces.push('error.message')
      }
    }
  }
  return { value: redacted, surfaces }
}

function isSanitizedArtifact(value: unknown): value is Record<
  string,
  unknown
> & {
  readonly type: 'artifact'
  readonly preview?: unknown
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'artifact'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
