import { StorageError } from '@use-crux/core/storage'
import type { ExactFilter, JsonObject, JsonValue } from '@use-crux/core/storage'

export function assertStorageKey(key: string): void {
  if (key.length === 0) {
    throw new StorageError('invalid_key', 'Storage keys must not be empty.')
  }
}

export function cloneJsonObject<T extends JsonObject>(value: T): T {
  assertJsonValue(value)
  if (!isPlainObject(value)) {
    throw new StorageError('invalid_value', 'Record values must be JSON objects.')
  }
  return JSON.parse(JSON.stringify(value)) as T
}

export function assertExactFilter(filter: unknown): asserts filter is ExactFilter {
  if (!isPlainObject(filter)) {
    throw new StorageError('invalid_filter', 'Storage filters must be plain objects.')
  }
  for (const [key, value] of Object.entries(filter)) {
    if (key.includes('.') || !isFilterValue(value)) {
      throw new StorageError('invalid_filter', 'Storage filters support exact top-level scalar equality only.')
    }
  }
}

export function matchesExactFilter(value: JsonObject | ExactFilter | undefined, filter: ExactFilter): boolean {
  if (!value) return false
  return Object.entries(filter).every(([key, expected]) =>
    Object.prototype.hasOwnProperty.call(value, key) ? value[key] === expected : false,
  )
}

export function normalizeTtlMs(ttlMs: number | undefined): number | undefined {
  if (ttlMs === undefined) return undefined
  if (!Number.isFinite(ttlMs) || !Number.isInteger(ttlMs) || ttlMs <= 0) {
    throw new StorageError('invalid_value', 'Record TTL must be a positive integer number of milliseconds.')
  }
  return ttlMs
}

function assertJsonValue(value: unknown): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) {
    value.forEach(assertJsonValue)
    return
  }
  if (isPlainObject(value)) {
    Object.values(value).forEach(assertJsonValue)
    return
  }
  throw new StorageError('invalid_value', 'Record values must be JSON serializable.')
}

function isFilterValue(value: unknown): value is ExactFilter[string] {
  return (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean'
  )
}

function isPlainObject(value: unknown): value is { readonly [key: string]: JsonValue } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
