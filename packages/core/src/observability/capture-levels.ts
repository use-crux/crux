import type { CruxArtifactKind, CruxGraphRecord } from './contract'
import type { ObserveArtifactOptions } from './observe'
import {
  ARTIFACT_CAPTURE_DECISIONS,
  isCanonicalArtifactKind,
  type CruxObservabilityArtifactDirection,
  type CruxObservabilityCaptureConfig,
  type CruxObservabilityCaptureLevel,
  type CruxObservabilityCaptureMode,
  type CruxObservabilityCapturePolicy,
} from './capture-policy-contract'
import { stripRecordPayloadAttributes } from './capture-policy-payload'
import {
  byteLength,
  hashString,
  serializePreview,
} from './capture-policy-utils'
import { sanitizeMediaPreview } from './media-preview'

type ArtifactOptions = ObserveArtifactOptions

export interface ResolvedCaptureModes {
  readonly input: CruxObservabilityCaptureMode
  readonly output: CruxObservabilityCaptureMode
  readonly capture?: ResolvedCaptureConfig
}

interface ResolvedCaptureConfig {
  readonly default?: CruxObservabilityCaptureLevel
  readonly overrides: ReadonlyMap<string, CruxObservabilityCaptureLevel>
  readonly redactRecord?: (record: CruxGraphRecord) => CruxGraphRecord | null
}

/** Resolve capture defaults and overrides from one policy snapshot. */
export function resolveCaptureModes(
  policy: CruxObservabilityCapturePolicy | undefined,
): ResolvedCaptureModes {
  const capture = normalizeCaptureConfig(policy?.capture)
  return {
    input:
      captureModeFromLevel(
        capture?.overrides.get('input') ?? capture?.default,
      ) ?? normalizeCaptureMode(policy?.recordInputs),
    output:
      captureModeFromLevel(
        capture?.overrides.get('output') ?? capture?.default,
      ) ?? normalizeCaptureMode(policy?.recordOutputs),
    ...(capture ? { capture } : {}),
  }
}

/** Media-sanitize and remove payload attributes disabled by capture policy. */
export function prepareObservabilityRecordForCapture(
  record: CruxGraphRecord,
  modes: ResolvedCaptureModes,
): CruxGraphRecord {
  const mediaSafeRecord = sanitizeMediaPreview(record) as CruxGraphRecord
  return shouldStripPayloadAttributes(modes)
    ? stripRecordPayloadAttributes(mediaSafeRecord)
    : mediaSafeRecord
}

/** Apply the resolved capture level to an artifact record, if governed. */
export function applyCaptureLevelToRecord(
  record: CruxGraphRecord,
  modes: ResolvedCaptureModes,
): CruxGraphRecord {
  if (record.type !== 'artifact') return record
  const level = captureLevelForArtifact(modes, record.kind)
  if (!level) return record

  if (level === 'off') {
    const {
      preview: _preview,
      sizeBytes: _sizeBytes,
      hash: _hash,
      uri: _uri,
      ...offRest
    } = record
    return {
      ...offRest,
      encoding: 'reference',
    }
  }

  if (record.preview === undefined) return record

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

/** Apply one capture level to public artifact options. */
export function applyCaptureLevelToArtifact(
  level: CruxObservabilityCaptureLevel,
  artifact: ArtifactOptions,
): ArtifactOptions {
  if (level === 'off') {
    const {
      preview: _preview,
      sizeBytes: _sizeBytes,
      hash: _hash,
      uri: _uri,
      ...offRest
    } = artifact
    return {
      ...offRest,
      encoding: 'reference',
    }
  }

  if (artifact.preview === undefined) return artifact

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

/** Resolve the capture level for an input or output artifact family. */
export function captureLevelForDirection(
  modes: ResolvedCaptureModes,
  direction: CruxObservabilityArtifactDirection,
): CruxObservabilityCaptureLevel {
  const override = modes.capture?.overrides.get(direction)
  if (override) return override
  if (modes.capture?.default) return modes.capture.default
  return levelFromMode(modeForDirection(modes, direction))
}

/** Resolve the capture level for one canonical or custom artifact kind. */
export function captureLevelForArtifact(
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

/** Return the capture-nested hook, which takes precedence over the policy hook. */
export function captureRedactRecord(
  modes: ResolvedCaptureModes,
): ((record: CruxGraphRecord) => CruxGraphRecord | null) | undefined {
  return modes.capture?.redactRecord
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
  if (inputLevel === 'evidence' || outputLevel === 'evidence') {
    return 'evidence'
  }
  return 'safe'
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

function sanitizePreviewForCapture(
  _level: Extract<CruxObservabilityCaptureLevel, 'full' | 'safe'>,
  value: unknown,
): unknown {
  return value
}
