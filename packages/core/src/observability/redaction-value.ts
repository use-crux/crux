import type { CruxObservabilityRedactionPattern } from './capture-policy-contract'
import { redactObservabilityString } from './redaction-patterns'
import { OBSERVABILITY_SANITIZE_LIMITS } from './sanitize'

/** Redact strings in one bounded observability payload value. */
export function redactObservabilityValue<T>(
  value: T,
  patterns: readonly CruxObservabilityRedactionPattern[] | undefined,
): T {
  return redactValue(value, patterns, new WeakMap(), 0)
}

function redactValue<T>(
  value: T,
  patterns: readonly CruxObservabilityRedactionPattern[] | undefined,
  seen: WeakMap<object, unknown>,
  depth: number,
): T
function redactValue(
  value: unknown,
  patterns: readonly CruxObservabilityRedactionPattern[] | undefined,
  seen: WeakMap<object, unknown>,
  depth: number,
): unknown {
  if (typeof value === 'string') {
    return redactObservabilityString(value, patterns)
  }
  if (value === null || typeof value !== 'object' || value instanceof Date) {
    return value
  }
  if (depth >= OBSERVABILITY_SANITIZE_LIMITS.depth) return value

  const known = seen.get(value)
  if (known !== undefined) return known

  if (Array.isArray(value)) {
    const output = cloneArray(value)
    seen.set(value, output)
    let changed = false
    const count = Math.min(
      value.length,
      OBSERVABILITY_SANITIZE_LIMITS.arrayLength,
    )
    for (let index = 0; index < count; index += 1) {
      const entryValue = value[index]
      const item = redactValue(entryValue, patterns, seen, depth + 1)
      defineClonedValue(output, String(index), item)
      if (item !== entryValue) changed = true
    }
    if (changed) return output
    seen.set(value, value)
    return value
  }

  const output = cloneRecord(value)
  seen.set(value, output)
  let changed = false
  const keys = Object.keys(value).slice(
    0,
    OBSERVABILITY_SANITIZE_LIMITS.objectKeys,
  )
  for (const key of keys) {
    const entryValue = (value as Record<string, unknown>)[key]
    const redacted = redactValue(entryValue, patterns, seen, depth + 1)
    defineClonedValue(output, key, redacted)
    if (redacted !== entryValue) changed = true
  }
  if (changed) return output
  seen.set(value, value)
  return value
}

function cloneArray(value: readonly unknown[]): unknown[] {
  const output = new Array(value.length)
  copyEnumerableDescriptors(value, output)
  return output
}

function cloneRecord(value: object): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  copyEnumerableDescriptors(value, output)
  return output
}

function copyEnumerableDescriptors(source: object, target: object): void {
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (!descriptor?.enumerable) continue
    Object.defineProperty(target, key, {
      ...descriptor,
      configurable: true,
    })
  }
}

function defineClonedValue(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  })
}
