/**
 * Flow persistence serialization guards.
 *
 * Flow handlers may use arbitrary local values while they are running, but
 * values that cross the persistence boundary must be portable JSON. These
 * helpers reject values JSON would drop, coerce, or fail to represent before
 * they reach a `RecordStore`.
 *
 * @module
 */

import type { JsonValue } from '../storage'
import type { FlowSnapshot } from './types'

/** Persisted flow boundary being validated. */
export type FlowPersistenceBoundary =
  | 'flow input'
  | 'step output'
  | 'signal payload'
  | 'scheduled work input'
  | 'flow snapshot metadata'

/** Context for a flow value that is about to be persisted. */
export interface FlowJsonValueContext {
  /** Public boundary name used in user-facing errors. */
  boundary: FlowPersistenceBoundary
  /** Path to the value within that boundary. Defaults to `$`. */
  path?: string
}

/**
 * Thrown when flow data cannot be represented as JSON persistence data.
 *
 * Flow serialization failures are contract errors, not lifecycle outcomes, so
 * they are thrown instead of being converted into `FlowResult` statuses.
 */
export class FlowSerializationError extends Error {
  readonly boundary: FlowPersistenceBoundary

  constructor(boundary: FlowPersistenceBoundary, reason: string) {
    super(`${formatFlowPersistenceBoundary(boundary)} must be JSON-serializable: ${reason}`)
    this.name = 'FlowSerializationError'
    this.boundary = boundary
  }
}

/** Assert that a value can be safely written to flow persistence. */
export function assertFlowJsonValue(value: unknown, context: FlowJsonValueContext): asserts value is JsonValue {
  const failure = findJsonFailure(value, context.path ?? '$', new WeakSet<object>())
  if (failure) {
    throw new FlowSerializationError(context.boundary, failure)
  }
}

/**
 * Clone one flow-owned JSON value for persistence without operation identity.
 *
 * Only `traceId` and `spanId` fields owned by `_meta` objects are removed.
 * Other metadata and domain fields are preserved, while `raw` subtrees remain
 * opaque. The caller's live value is never mutated.
 */
export function flowValueForPersistence(
  value: unknown,
  context: FlowJsonValueContext,
): JsonValue {
  assertFlowJsonValue(value, context)
  return cloneFlowPersistenceValue(value, true)
}

/** Validate complete flow snapshot metadata before a `RecordStore` write. */
export function assertFlowSnapshotMetadata(snapshot: FlowSnapshot): void {
  assertFlowJsonValue(snapshot, { boundary: 'flow snapshot metadata' })
}

/** Reconstruct a record-store snapshot without invocation-local result data. */
export function flowSnapshotForPersistence(snapshot: FlowSnapshot): FlowSnapshot {
  return flowValueForPersistence(snapshot, {
    boundary: 'flow snapshot metadata',
  }) as FlowSnapshot
}

/** Prepare one user-produced flow value for durable snapshot storage. */
export function flowOutputForPersistence(value: unknown, path: string): JsonValue {
  return flowValueForPersistence(value, { boundary: 'step output', path })
}

/**
 * Prepare completed step state for snapshot persistence.
 *
 * Step results can be arbitrary transient values while a flow is completing,
 * but replay state written to a snapshot must be JSON-serializable.
 *
 * @param completedSteps - In-memory completed step cache keyed by step label.
 * @returns The same cache narrowed to the persisted snapshot shape.
 */
export function completedStepsForSnapshot(
  completedSteps: Record<string, { output: unknown; durationMs: number }>,
): FlowSnapshot['completedSteps'] {
  const persisted: FlowSnapshot['completedSteps'] = {}
  for (const [label, step] of Object.entries(completedSteps)) {
    persisted[label] = {
      output: flowOutputForPersistence(step.output, `step "${label}" output`),
      durationMs: step.durationMs,
    }
  }
  return persisted
}

function findJsonFailure(value: unknown, path: string, seen: WeakSet<object>): string | null {
  if (value === null) return null

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return null
    case 'number':
      return Number.isFinite(value) ? null : `${path} is not a finite number`
    case 'undefined':
      return `${path} is undefined`
    case 'bigint':
      return `${path} is a bigint`
    case 'symbol':
      return `${path} is a symbol`
    case 'function':
      return `${path} is a function`
    case 'object':
      return findJsonObjectFailure(value, path, seen)
  }
  return `${path} has unsupported type`
}

function formatFlowPersistenceBoundary(boundary: FlowPersistenceBoundary): string {
  switch (boundary) {
    case 'flow input':
      return 'Flow input'
    case 'step output':
      return 'Flow step output'
    case 'signal payload':
      return 'Flow signal payload'
    case 'scheduled work input':
      return 'Flow scheduled work input'
    case 'flow snapshot metadata':
      return 'Flow snapshot metadata'
  }
}

function cloneFlowPersistenceValue(
  value: JsonValue,
  sanitizeMetadata: boolean,
): JsonValue {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((item) => cloneFlowPersistenceValue(item, sanitizeMetadata))
  }

  const clone = Object.create(Object.getPrototypeOf(value)) as Record<string, JsonValue>
  for (const [key, item] of Object.entries(value)) {
    // Validation rejects optional properties whose runtime value is undefined;
    // the index signature cannot retain that narrowing across Object.entries().
    const jsonItem = item as JsonValue
    if (key === 'raw') {
      clone[key] = cloneFlowPersistenceValue(jsonItem, false)
      continue
    }
    if (sanitizeMetadata && key === '_meta' && isPlainObject(jsonItem)) {
      const metadata = clonePersistenceMetadata(jsonItem)
      if (Object.keys(metadata).length > 0) clone[key] = metadata
      continue
    }
    clone[key] = cloneFlowPersistenceValue(jsonItem, sanitizeMetadata)
  }
  return clone
}

function clonePersistenceMetadata(
  metadata: Record<string, unknown>,
): Record<string, JsonValue> {
  const clone: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (key === 'traceId' || key === 'spanId') continue
    clone[key] = cloneFlowPersistenceValue(
      value as JsonValue,
      key !== 'raw',
    )
  }
  return clone
}

function findJsonObjectFailure(value: object, path: string, seen: WeakSet<object>): string | null {
  if (seen.has(value)) return `${path} is cyclic`
  seen.add(value)

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const failure = findJsonFailure(item, `${path}[${index}]`, seen)
      if (failure) return failure
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length' || isArrayIndexKey(key)) continue
      if (typeof key === 'symbol') return `${path} has symbol-keyed property`
      return `${path}.${key} is not serialized by JSON arrays`
    }
    seen.delete(value)
    return null
  }

  if (!isPlainObject(value)) return `${path} is not a plain object`

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') return `${path} has symbol-keyed property`
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable) return `${path}.${key} is not enumerable`
    const failure = findJsonFailure((value as Record<string, unknown>)[key], `${path}.${key}`, seen)
    if (failure) return failure
  }
  seen.delete(value)
  return null
}

function isArrayIndexKey(key: string | symbol): boolean {
  if (typeof key === 'symbol' || key === '') return false
  const index = Number(key)
  return Number.isInteger(index) && index >= 0 && index < 2 ** 32 - 1 && String(index) === key
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
