/**
 * Wake envelope encoding and validation.
 *
 * Wake transports carry this small routing envelope only. Full user payloads,
 * snapshots, and step outputs stay in the durable store so queue dashboards and
 * transport limits never become part of the user payload contract.
 *
 * @module
 */

import type { RuntimeTargetId, WorkId } from '../ports/ids'
import type { RuntimeWork } from '../ports/work'
import { createRuntimeError } from './errors'

/** Maximum portable wake envelope size in bytes. */
export const MAX_WAKE_ENVELOPE_BYTES = 4 * 1024

/** Portable wake message delivered by queue, HTTP, timer, or in-process wake adapters. */
export interface WakeEnvelope {
  /** Wire format version. */
  readonly v: 1
  /** Runtime namespace. */
  readonly ns: string
  /** Work item to load from the durable state port. */
  readonly workId: WorkId
  /** Name-based runtime target id. */
  readonly target: RuntimeTargetId
  /** Work kind used for routing and diagnostics. */
  readonly kind: RuntimeWork['kind']
  /** Stable idempotency key for this delivery. */
  readonly idempotencyKey: string
  /** One-based attempt number. */
  readonly attempt: number
}

/**
 * Encode a wake envelope as JSON after validating shape and size.
 *
 * @throws CruxRuntimeError with `PAYLOAD_NOT_JSON` when the envelope contains
 * non-JSON data, and `CAPABILITY_MISSING` when it exceeds the portable 4 KB
 * wake payload limit.
 */
export function encodeWakeEnvelope(envelope: WakeEnvelope): string {
  assertWakeEnvelope(envelope)
  const encoded = JSON.stringify(envelope)
  assertEnvelopeSize(encoded)
  return encoded
}

/**
 * Decode and validate a wake envelope from JSON text.
 *
 * @throws CruxRuntimeError when the body is invalid JSON, has the wrong shape,
 * or exceeds the portable wake payload limit.
 */
export function decodeWakeEnvelope(encoded: string): WakeEnvelope {
  assertEnvelopeSize(encoded)
  let parsed: unknown
  try {
    parsed = JSON.parse(encoded)
  } catch (cause) {
    throw payloadNotJsonError(
      'wake envelope body',
      'The body is not valid JSON text.',
      cause,
    )
  }
  assertWakeEnvelope(parsed)
  return parsed
}

function assertWakeEnvelope(value: unknown): asserts value is WakeEnvelope {
  const invalidPath = findNonJsonPath(value, 'wake envelope')
  if (invalidPath) {
    throw payloadNotJsonError(
      invalidPath,
      'Wake envelopes must contain only JSON-serializable routing metadata.',
    )
  }

  if (!isRecord(value)) {
    throw payloadNotJsonError(
      'wake envelope',
      'Wake envelope must be a JSON object.',
    )
  }

  if (
    value.v !== 1 ||
    typeof value.ns !== 'string' ||
    typeof value.workId !== 'string' ||
    typeof value.target !== 'string' ||
    !isRuntimeWorkKind(value.kind) ||
    typeof value.idempotencyKey !== 'string' ||
    typeof value.attempt !== 'number' ||
    !Number.isSafeInteger(value.attempt) ||
    value.attempt < 1
  ) {
    throw payloadNotJsonError(
      'wake envelope',
      'Wake envelope is missing required routing fields.',
    )
  }
}

function assertEnvelopeSize(encoded: string): void {
  const size = new TextEncoder().encode(encoded).byteLength
  if (size <= MAX_WAKE_ENVELOPE_BYTES) return

  throw createRuntimeError({
    code: 'CAPABILITY_MISSING',
    whatFailed: 'Wake envelope exceeded the portable 4 KB runtime limit.',
    why: `The encoded envelope is ${size} bytes, but wake transports must carry only routing metadata.`,
    whatStillWorks:
      'Durable payloads can still be stored in the runtime state port.',
    nextStep:
      'Move user payload data into the durable store and keep the wake envelope to ids and routing fields.',
  })
}

function payloadNotJsonError(
  path: string,
  why: string,
  cause?: unknown,
): never {
  throw createRuntimeError({
    code: 'PAYLOAD_NOT_JSON',
    whatFailed: `Runtime wake envelope field \`${path}\` is not JSON-serializable.`,
    why,
    whatStillWorks:
      'Runtime work whose payload is already persisted can still be resumed by a valid wake envelope.',
    nextStep:
      'Pass only strings, numbers, booleans, null, arrays, and plain objects across durable runtime boundaries.',
    cause,
  })
}

function isRuntimeWorkKind(value: unknown): value is RuntimeWork['kind'] {
  return (
    value === 'flow.resume' ||
    value === 'flow.timeout' ||
    value === 'task.run' ||
    value === 'watch.deliver'
  )
}

function findNonJsonPath(
  value: unknown,
  path: string,
  seen = new WeakSet<object>(),
): string | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return null
  if (typeof value === 'number') return Number.isFinite(value) ? null : path
  if (Array.isArray(value)) {
    if (seen.has(value)) return path
    seen.add(value)
    for (let index = 0; index < value.length; index += 1) {
      const invalid = findNonJsonPath(value[index], `${path}[${index}]`, seen)
      if (invalid) return invalid
    }
    seen.delete(value)
    return null
  }
  if (!isRecord(value)) return path
  if (seen.has(value)) return path
  seen.add(value)
  for (const [key, item] of Object.entries(value)) {
    const invalid = findNonJsonPath(item, `${path}.${key}`, seen)
    if (invalid) return invalid
  }
  seen.delete(value)
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
