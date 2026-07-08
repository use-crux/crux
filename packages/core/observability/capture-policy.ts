/**
 * Capture policy for privacy-sensitive observability artifacts.
 *
 * The graph contract can carry either inline previews or reference metadata.
 * This module decides, once, whether an input/output payload should keep its
 * preview or be represented by size/hash only.
 *
 * @module
 */

import { getHooks } from '../runtime/runtime'
import { type CruxArtifactKind, type CruxGraphRecord } from './contract'
import type { ObserveArtifactOptions } from './observe'
import {
  ARTIFACT_CAPTURE_DECISIONS,
  PAYLOAD_ATTRIBUTE_KEYS,
  isCanonicalArtifactKind,
  type CruxObservabilityArtifactDirection,
  type CruxObservabilityCaptureConfig,
  type CruxObservabilityCaptureLevel,
  type CruxObservabilityCaptureMode,
} from './capture-policy-contract'
import { byteLength, hashString, serializePreview } from './capture-policy-utils'
import { stripRecordPayloadAttributes } from './capture-policy-payload'
import { contentText } from '../content'
import { isContentPart } from '../content/guards'

export { PAYLOAD_ATTRIBUTE_KEYS } from './capture-policy-contract'
export { stripPayloadAttributes } from './capture-policy-payload'
export type {
  CruxObservabilityArtifactDirection,
  CruxObservabilityCaptureConfig,
  CruxObservabilityCaptureLevel,
  CruxObservabilityCaptureMode,
  CruxObservabilityCapturePolicy,
  CruxObservabilityCaptureTarget,
  CruxSafetyArtifactKind,
} from './capture-policy-contract'

type ArtifactOptions = ObserveArtifactOptions

const FULL_CAPTURE_DATA_INLINE_THRESHOLD = 8 * 1024

export type ObservabilityCaptureResult =
  | { readonly ok: true; readonly record: CruxGraphRecord }
  | { readonly ok: false; readonly error?: unknown }

interface ResolvedCaptureModes {
  readonly input: CruxObservabilityCaptureMode
  readonly output: CruxObservabilityCaptureMode
  readonly capture?: ResolvedCaptureConfig
}

interface ResolvedCaptureConfig {
  readonly default?: CruxObservabilityCaptureLevel
  readonly overrides: ReadonlyMap<string, CruxObservabilityCaptureLevel>
  readonly redactRecord?: (record: CruxGraphRecord) => CruxGraphRecord | null
}

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
  return applyCaptureLevelToArtifact(
    captureLevelForDirection(resolveCaptureModes(), direction),
    artifact,
  )
}

/** Apply capture policy for known input/output artifact families. */
export function applyConfiguredObservabilityCapturePolicy(
  artifact: ArtifactOptions,
): ArtifactOptions {
  const modes = resolveCaptureModes()
  const level = captureLevelForArtifact(modes, artifact.kind)
  return level ? applyCaptureLevelToArtifact(level, artifact) : artifact
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
  const modes = resolveCaptureModes()
  const policy = getHooks().observabilityCapture
  const policyRecord = applyCaptureModesToRecord(record, modes)

  try {
    const redactRecord = modes.capture?.redactRecord ?? policy?.redactRecord
    const redacted = redactRecord
      ? redactRecord(policyRecord)
      : policyRecord
    return redacted ? { ok: true, record: redacted } : { ok: false }
  } catch (error) {
    return { ok: false, error }
  }
}

function applyCaptureModesToRecord(
  record: CruxGraphRecord,
  modes: ResolvedCaptureModes,
): CruxGraphRecord {
  const strippedRecord = shouldStripPayloadAttributes(modes)
    ? stripRecordPayloadAttributes(record)
    : record
  if (strippedRecord.type !== 'artifact') return strippedRecord

  const level = captureLevelForArtifact(modes, strippedRecord.kind)
  if (!level) return strippedRecord
  return applyCaptureLevelToRecord(level, strippedRecord)
}

function applyCaptureLevelToArtifact(
  level: CruxObservabilityCaptureLevel,
  artifact: ArtifactOptions,
): ArtifactOptions {
  if (level === 'off') {
    const { preview: _preview, sizeBytes: _sizeBytes, hash: _hash, uri: _uri, ...offRest } = artifact
    return {
      ...offRest,
      encoding: 'reference',
    }
  }

  if (artifact.preview === undefined)
    return artifact

  if (level === 'full' || level === 'safe') {
    return {
      ...artifact,
      preview: sanitizePreviewForCapture(level, artifact.preview),
    }
  }

  const { preview: _preview, ...rest } = artifact
  const serialized = serializePreview(artifact.preview)
  return {
    ...rest,
    encoding: 'reference',
    sizeBytes: artifact.sizeBytes ?? byteLength(serialized),
    hash: artifact.hash ?? hashString(serialized),
  }
}

function applyCaptureLevelToRecord(
  level: CruxObservabilityCaptureLevel,
  record: Extract<CruxGraphRecord, { readonly type: 'artifact' }>,
): CruxGraphRecord {
  if (level === 'off') {
    const { preview: _preview, sizeBytes: _sizeBytes, hash: _hash, uri: _uri, ...offRest } = record
    return {
      ...offRest,
      encoding: 'reference',
    }
  }

  if (record.preview === undefined)
    return record

  if (level === 'full' || level === 'safe') {
    return {
      ...record,
      preview: sanitizePreviewForCapture(level, record.preview),
    }
  }

  const { preview: _preview, ...rest } = record
  const serialized = serializePreview(record.preview)
  return {
    ...rest,
    encoding: 'reference',
    sizeBytes: record.sizeBytes ?? byteLength(serialized),
    hash: record.hash ?? hashString(serialized),
  }
}

function sanitizePreviewForCapture(
  level: Extract<CruxObservabilityCaptureLevel, 'full' | 'safe'>,
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    const out = value.map((item) => sanitizePreviewForCapture(level, item, seen))
    seen.delete(value)
    return out
  }
  if (!isRecord(value)) return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (isContentPart(value) && 'data' in value && shouldReplaceData(level, value.data)) {
    seen.delete(value)
    return {
      ...value,
      data: contentText([value]),
    }
  }

  if (isContentPart(value) && 'url' in value && shouldReplaceDataUrl(level, value.url)) {
    seen.delete(value)
    return {
      ...value,
      url: contentText([value]),
    }
  }

  const out = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, sanitizePreviewForCapture(level, child, seen)]),
  )
  seen.delete(value)
  return out
}

function shouldReplaceData(
  level: Extract<CruxObservabilityCaptureLevel, 'full' | 'safe'>,
  data: string,
): boolean {
  return level === 'safe' || data.length > FULL_CAPTURE_DATA_INLINE_THRESHOLD
}

function shouldReplaceDataUrl(
  level: Extract<CruxObservabilityCaptureLevel, 'full' | 'safe'>,
  url: string,
): boolean {
  return isBase64DataUrl(url) && shouldReplaceData(level, url)
}

function isBase64DataUrl(value: string): boolean {
  return /^data:[^,;]*(?:;[^,;]*)*;base64,/i.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function captureLevelForArtifact(
  modes: ResolvedCaptureModes,
  kind: CruxArtifactKind,
): CruxObservabilityCaptureLevel | undefined {
  if (kind.startsWith('custom.')) {
    if (!shouldStripPayloadAttributes(modes)) return undefined
    return 'evidence'
  }
  if (!isCanonicalArtifactKind(kind)) return undefined

  const decision = ARTIFACT_CAPTURE_DECISIONS[kind]
  if (decision === 'exempt') return undefined

  const override = modes.capture?.overrides.get(kind)
  if (override) return override

  if (decision === 'input' || decision === 'output') {
    return captureLevelForDirection(modes, decision)
  }

  return defaultSafetyCaptureLevel(modes)
}

function captureLevelForDirection(
  modes: ResolvedCaptureModes,
  direction: CruxObservabilityArtifactDirection,
): CruxObservabilityCaptureLevel {
  const override = modes.capture?.overrides.get(direction)
  if (override) return override
  if (modes.capture?.default) return modes.capture.default
  return levelFromMode(modeForDirection(modes, direction))
}

function levelFromMode(
  mode: CruxObservabilityCaptureMode,
): CruxObservabilityCaptureLevel {
  switch (mode) {
    case 'inline':
      return 'full'
    case 'reference':
      return 'evidence'
    case 'off':
      return 'off'
  }
}

function defaultSafetyCaptureLevel(
  modes: ResolvedCaptureModes,
): CruxObservabilityCaptureLevel {
  if (modes.capture?.default) return modes.capture.default
  const inputLevel = levelFromMode(modes.input)
  const outputLevel = levelFromMode(modes.output)
  if (inputLevel === 'off' || outputLevel === 'off') return 'off'
  if (inputLevel === 'evidence' || outputLevel === 'evidence')
    return 'evidence'
  return 'safe'
}

function captureModeFromLevel(
  level: CruxObservabilityCaptureLevel | undefined,
): CruxObservabilityCaptureMode | undefined {
  switch (level) {
    case 'full':
    case 'safe':
      return 'inline'
    case 'evidence':
      return 'reference'
    case 'off':
      return 'off'
    case undefined:
      return undefined
  }
}

function resolveCaptureModes(): ResolvedCaptureModes {
  const policy = getHooks().observabilityCapture
  const capture = normalizeCaptureConfig(policy?.capture)
  return {
    input:
      captureModeFromLevel(capture?.overrides.get('input') ?? capture?.default) ??
      normalizeCaptureMode(policy?.recordInputs),
    output:
      captureModeFromLevel(capture?.overrides.get('output') ?? capture?.default) ??
      normalizeCaptureMode(policy?.recordOutputs),
    ...(capture ? { capture } : {}),
  }
}

function normalizeCaptureConfig(
  config: CruxObservabilityCaptureConfig | undefined,
): ResolvedCaptureConfig | undefined {
  if (!config) return undefined
  if (typeof config === 'string') {
    return { default: config, overrides: new Map() }
  }

  return {
    ...(config.default ? { default: config.default } : {}),
    overrides: new Map(Object.entries(config.overrides ?? {})),
    ...(config.redactRecord ? { redactRecord: config.redactRecord } : {}),
  }
}

function normalizeCaptureMode(
  mode: boolean | CruxObservabilityCaptureMode | undefined,
): CruxObservabilityCaptureMode {
  if (mode === false) return 'reference'
  if (mode === true || mode === undefined) return 'inline'
  return mode
}

function modeForDirection(
  modes: ResolvedCaptureModes,
  direction: CruxObservabilityArtifactDirection,
): CruxObservabilityCaptureMode {
  return direction === 'input' ? modes.input : modes.output
}

function shouldStripPayloadAttributes(modes: ResolvedCaptureModes): boolean {
  return modes.input !== 'inline' || modes.output !== 'inline'
}
