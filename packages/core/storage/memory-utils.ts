import { StorageError } from './errors'
import type { ExactFilter, JsonObject, JsonValue, RecordListOptions, RecordWriteOptions } from './types'

type JsonContainer = readonly JsonValue[] | { readonly [key: string]: JsonValue }

export function assertValidKey(key: string): void {
  if (key.length === 0) {
    throw new StorageError('invalid_key', 'Storage keys must not be empty.')
  }
}

export function cloneJsonObject<T extends JsonObject>(value: T): T {
  assertJsonObject(value)
  return JSON.parse(JSON.stringify(value)) as T
}

export function cloneExactFilter(filter: ExactFilter | undefined): ExactFilter | undefined {
  if (!filter) return undefined
  assertExactFilter(filter)
  return { ...filter }
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

export function assertRecordWriteOptions(options: RecordWriteOptions | undefined): void {
  if (options?.ttlMs === undefined) return
  if (!Number.isFinite(options.ttlMs) || !Number.isInteger(options.ttlMs) || options.ttlMs <= 0) {
    throw new StorageError('invalid_value', 'Record TTL must be a positive integer number of milliseconds.')
  }
}

export function normalizeRecordListOptions(options: RecordListOptions | undefined): RecordListOptions {
  if (options?.filter) {
    assertExactFilter(options.filter)
  }
  if (options?.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 0)) {
    throw new StorageError('invalid_value', 'Record list limit must be a non-negative integer.')
  }
  return {
    limit: options?.limit,
    cursor: options?.cursor,
    filter: cloneExactFilter(options?.filter),
  }
}

function assertJsonObject(value: unknown): asserts value is JsonObject {
  if (!isPlainObject(value)) {
    throw new StorageError('invalid_value', 'Record values must be JSON objects.')
  }
  assertJsonContainer(value)
}

function assertJsonContainer(value: JsonContainer): void {
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value)
  for (const [, item] of entries) {
    assertJsonValue(item)
  }
}

function assertJsonValue(value: unknown): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new StorageError('invalid_value', 'JSON numbers must be finite.')
    }
    return
  }
  if (Array.isArray(value)) {
    assertJsonContainer(value)
    return
  }
  if (isPlainObject(value)) {
    assertJsonContainer(value)
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
