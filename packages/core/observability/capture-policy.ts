/**
 * Capture policy for privacy-sensitive observability artifacts.
 *
 * The graph contract can carry either inline previews or reference metadata.
 * This module decides, once, whether an input/output payload should keep its
 * preview or be represented by size/hash only.
 *
 * @module
 */

import { getRuntime } from '../runtime/runtime'
import type { CruxAttributes, CruxGraphRecord } from './contract'
import type { ObserveArtifactOptions } from './observe'

/** Capture mode for a privacy-sensitive payload direction. */
export type CruxObservabilityCaptureMode = 'inline' | 'reference' | 'off'

/**
 * Keys whose values can carry prompt, retrieval, generation, or body text.
 *
 * These are stripped from record attributes when either capture direction is
 * disabled, and by the OTel mapper as defense in depth.
 */
export const PAYLOAD_ATTRIBUTE_KEYS = [
  'text',
  'query',
  'prompt',
  'messages',
  'input',
  'output',
  'preview',
  'content',
  'delta',
  'body',
  'filter',
] as const

/** Span event names that may carry payload text in attributes. */
export const PAYLOAD_EVENT_NAMES = ['token.delta', 'token.chunk', 'usage.observed'] as const

/** Runtime policy for how observability payloads are captured. */
export interface CruxObservabilityCapturePolicy {
  /**
   * Capture input-family payloads such as prompt messages and tool arguments.
   *
   * `true` is sugar for `'inline'`; `false` is sugar for `'reference'`.
   *
   * @default true
   */
  readonly recordInputs?: boolean | CruxObservabilityCaptureMode
  /**
   * Capture output-family payloads such as model responses, retrieved content,
   * memory snapshots, token text, and raw error evidence.
   *
   * `true` is sugar for `'inline'`; `false` is sugar for `'reference'`.
   *
   * @default true
   */
  readonly recordOutputs?: boolean | CruxObservabilityCaptureMode
  /**
   * Last-mile record redaction hook.
   *
   * Runs after capture policy and before sanitization. Returning `null` drops
   * the record. Throwing also drops the record, so privacy hooks fail closed.
   */
  readonly redactRecord?: (record: CruxGraphRecord) => CruxGraphRecord | null
}

export type CruxObservabilityArtifactDirection = 'input' | 'output'

type ArtifactOptions = ObserveArtifactOptions

export type ObservabilityCaptureResult =
  | { readonly ok: true; readonly record: CruxGraphRecord }
  | { readonly ok: false; readonly error?: unknown }

interface ResolvedCaptureModes {
  readonly input: CruxObservabilityCaptureMode
  readonly output: CruxObservabilityCaptureMode
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
  const mode = modeForDirection(resolveCaptureModes(), direction)
  if (mode === 'inline' || artifact.preview === undefined) return artifact

  const { preview: _preview, ...rest } = artifact
  if (mode === 'off') {
    const { sizeBytes: _sizeBytes, hash: _hash, uri: _uri, ...offRest } = rest
    return {
      ...offRest,
      encoding: 'reference',
    }
  }

  const serialized = serializePreview(artifact.preview)
  return {
    ...rest,
    encoding: 'reference',
    sizeBytes: artifact.sizeBytes ?? byteLength(serialized),
    hash: artifact.hash ?? hashString(serialized),
  }
}

/** Apply capture policy for known input/output artifact families. */
export function applyConfiguredObservabilityCapturePolicy(artifact: ArtifactOptions): ArtifactOptions {
  const direction = artifactCaptureDirection(artifact.kind)
  return direction ? applyObservabilityCapturePolicy(direction, artifact) : artifact
}

/**
 * Apply capture modes and the optional redaction hook to a graph record.
 *
 * This is the emit-bound privacy gate. Every consumer downstream of `emit()`
 * receives this result: subscribers, diagnostics channel, transports, and the
 * OTel subscriber.
 */
export function applyObservabilityCapturePolicyToRecord(record: CruxGraphRecord): ObservabilityCaptureResult {
  const modes = resolveCaptureModes()
  const policy = getRuntime().observabilityCapture
  const policyRecord = applyCaptureModesToRecord(record, modes)

  try {
    const redacted = policy?.redactRecord ? policy.redactRecord(policyRecord) : policyRecord
    return redacted ? { ok: true, record: redacted } : { ok: false }
  } catch (error) {
    return { ok: false, error }
  }
}

/** Remove known payload-bearing attributes without mutating the input object. */
export function stripPayloadAttributes(attributes: CruxAttributes | undefined): CruxAttributes | undefined {
  if (!attributes) return undefined
  const nextEntries = Object.entries(attributes).filter(([key]) => !isPayloadAttributeKey(key))
  return nextEntries.length > 0 ? Object.fromEntries(nextEntries) : undefined
}

function artifactCaptureDirection(kind: ArtifactOptions['kind']): CruxObservabilityArtifactDirection | undefined {
  switch (kind) {
    case 'input':
    case 'messages':
    case 'system':
    case 'prompt':
    case 'tool.args':
    case 'tool.request':
      return 'input'
    case 'output':
    case 'stream.timeline':
    case 'tool.result':
    case 'retrieval.hits':
    case 'memory.snapshot':
    case 'memory.recall':
    case 'memory.diff':
    case 'error.raw':
      return 'output'
    default:
      return undefined
  }
}

function applyCaptureModesToRecord(record: CruxGraphRecord, modes: ResolvedCaptureModes): CruxGraphRecord {
  const strippedRecord = shouldStripPayloadAttributes(modes) ? stripRecordPayloadAttributes(record) : record
  if (strippedRecord.type !== 'artifact') return strippedRecord

  const direction = artifactCaptureDirection(strippedRecord.kind)
  if (!direction) return strippedRecord

  const mode = modeForDirection(modes, direction)
  if (mode === 'inline' || strippedRecord.preview === undefined) return strippedRecord

  const { preview: _preview, ...rest } = strippedRecord
  if (mode === 'off') {
    const { sizeBytes: _sizeBytes, hash: _hash, uri: _uri, ...offRest } = rest
    return {
      ...offRest,
      encoding: 'reference',
    }
  }

  const serialized = serializePreview(strippedRecord.preview)
  return {
    ...rest,
    encoding: 'reference',
    sizeBytes: strippedRecord.sizeBytes ?? byteLength(serialized),
    hash: strippedRecord.hash ?? hashString(serialized),
  }
}

function stripRecordPayloadAttributes(record: CruxGraphRecord): CruxGraphRecord {
  if (!('attributes' in record) || record.attributes === undefined) return record
  const attributes = stripPayloadAttributes(record.attributes)
  if (attributes) return { ...record, attributes } as CruxGraphRecord

  const { attributes: _attributes, ...rest } = record
  return rest as CruxGraphRecord
}

function resolveCaptureModes(): ResolvedCaptureModes {
  const policy = getRuntime().observabilityCapture
  return {
    input: normalizeCaptureMode(policy?.recordInputs),
    output: normalizeCaptureMode(policy?.recordOutputs),
  }
}

function normalizeCaptureMode(mode: boolean | CruxObservabilityCaptureMode | undefined): CruxObservabilityCaptureMode {
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

function isPayloadAttributeKey(key: string): boolean {
  return (PAYLOAD_ATTRIBUTE_KEYS as readonly string[]).includes(key)
}

function serializePreview(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, stableReplacer()) ?? String(value)
  } catch {
    return String(value)
  }
}

function stableReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>()
  return (_key, value) => {
    if (!value || typeof value !== 'object') return value
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    if (Array.isArray(value)) return value
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
  }
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length
  }
  return value.length
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}
