import { StorageError } from '@use-crux/core/storage'
import type { ExactFilter, JsonObject, JsonValue, SparseVector } from '@use-crux/core/storage'

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

export function cloneExactFilter(filter: unknown): ExactFilter {
  assertExactFilter(filter)
  return { ...filter }
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

export function cloneDenseVector(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    throw new StorageError('invalid_value', 'Dense vectors must be non-empty finite number arrays.')
  }
  return [...value]
}

export function cloneSparseVector(value: unknown): SparseVector {
  if (!value || typeof value !== 'object') {
    throw new StorageError('invalid_value', 'Sparse vectors must include indices and values arrays.')
  }
  const candidate = value as { readonly indices?: unknown; readonly values?: unknown }
  if (!Array.isArray(candidate.indices) || !Array.isArray(candidate.values)) {
    throw new StorageError('invalid_value', 'Sparse vectors must include indices and values arrays.')
  }
  if (candidate.indices.length === 0 || candidate.indices.length !== candidate.values.length) {
    throw new StorageError('invalid_value', 'Sparse vector indices and values must be non-empty and equal length.')
  }
  const seen = new Set<number>()
  for (const index of candidate.indices) {
    if (!Number.isInteger(index) || index < 0 || seen.has(index)) {
      throw new StorageError('invalid_value', 'Sparse vector indices must be unique non-negative integers.')
    }
    seen.add(index)
  }
  if (!candidate.values.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    throw new StorageError('invalid_value', 'Sparse vector values must be finite numbers.')
  }
  return { indices: [...candidate.indices], values: [...candidate.values] }
}

export function exactMetadataFromJson(value: JsonObject): ExactFilter | undefined {
  const entries = Object.entries(value).filter(
    ([key, item]) => key !== 'embedding' && isFilterValue(item),
  ) as [string, string | number | boolean | null][]
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
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
