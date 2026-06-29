/**
 * Deterministic hashing and id generation for indexing.
 *
 * {@link stableHash} produces a stable djb2 hash over a value's
 * order-independent JSON form, used for chunk ids, fingerprints, and cache
 * keys. {@link createGenerationId} produces monotonic generation ids.
 *
 * @module
 */

/** Stable djb2 hash (hex) of any JSON-serializable value. */
export function stableHash(value: unknown): string {
  const input = stableStringify(value)
  let hash = 5381
  for (let index = 0; index < input.length; index++) {
    hash = (hash * 33) ^ input.charCodeAt(index)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Serialize a value to a canonical string with sorted object keys. */
export function stableStringify(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

/** Build a stable id of the form `${prefix}_${hash}`. */
export function createStableId(prefix: string, input: unknown): string {
  return `${prefix}_${stableHash(input)}`
}

let generationCounter = 0

/** Generate a monotonic generation id for a write batch. */
export function createGenerationId(): string {
  return `gen_${Date.now().toString(36)}_${++generationCounter}`
}
