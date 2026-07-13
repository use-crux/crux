/** Provider-neutral runtime validation for values crossing durable boundaries. */

import type { JsonValue } from '../../storage'
import { createRuntimeError } from './errors'

/** Validate and clone a JSON value so later caller mutation cannot change it. */
export function cloneRuntimeJsonValue<T extends JsonValue>(
  value: T,
  path: string,
): T {
  assertRuntimeJsonValue(value, path)
  return JSON.parse(JSON.stringify(value)) as T
}

/** Assert that an unknown input is a finite, acyclic JSON value. */
export function assertRuntimeJsonValue(
  value: unknown,
  path: string,
  seen = new WeakSet<object>(),
): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw payloadNotJson(path, 'JSON numbers must be finite.')
  }
  if (Array.isArray(value)) {
    if (seen.has(value))
      throw payloadNotJson(path, 'JSON values must not cycle.')
    seen.add(value)
    value.forEach((item, index) =>
      assertRuntimeJsonValue(item, `${path}[${index}]`, seen),
    )
    seen.delete(value)
    return
  }
  if (isPlainObject(value)) {
    if (seen.has(value))
      throw payloadNotJson(path, 'JSON values must not cycle.')
    seen.add(value)
    for (const [key, item] of Object.entries(value)) {
      assertRuntimeJsonValue(item, `${path}.${key}`, seen)
    }
    seen.delete(value)
    return
  }
  throw payloadNotJson(path, 'Durable runtime payloads must be JSON values.')
}

function payloadNotJson(path: string, why: string): never {
  throw createRuntimeError({
    code: 'PAYLOAD_NOT_JSON',
    whatFailed: `Runtime store field \`${path}\` is not JSON-serializable.`,
    why,
    whatStillWorks:
      'Runtime records with JSON payloads can still be persisted and replayed.',
    nextStep:
      'Pass only strings, finite numbers, booleans, null, arrays, and plain objects across durable runtime boundaries.',
  })
}

function isPlainObject(
  value: unknown,
): value is { readonly [key: string]: unknown } {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
