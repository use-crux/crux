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
import type { ObserveArtifactOptions } from './observe'

/** Runtime policy for whether observability artifacts include payload previews. */
export interface CruxObservabilityCapturePolicy {
  /**
   * Include input-family artifact previews such as prompt messages and tool
   * arguments.
   *
   * @default true
   */
  readonly recordInputs?: boolean
  /**
   * Include output-family artifact previews such as model responses and tool
   * results.
   *
   * @default true
   */
  readonly recordOutputs?: boolean
}

export type CruxObservabilityArtifactDirection = 'input' | 'output'

type ArtifactOptions = ObserveArtifactOptions

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
  const policy = getRuntime().observabilityCapture
  const shouldRecord = direction === 'input' ? policy?.recordInputs !== false : policy?.recordOutputs !== false
  if (shouldRecord || artifact.preview === undefined) return artifact

  const serialized = serializePreview(artifact.preview)
  const { preview: _preview, ...rest } = artifact
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
      return 'output'
    default:
      return undefined
  }
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
