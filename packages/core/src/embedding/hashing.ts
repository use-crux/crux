/**
 * Stable serialization and hashing for embedding cache keys + fingerprints.
 *
 * {@link stableStringify} produces a deterministic JSON string (sorted keys,
 * undefined dropped) for governance fingerprints; {@link hashString} is an FNV-1a
 * hash used in cache keys and span attributes. Internal helpers.
 *
 * @module
 */

/** Deterministically serialize a value (sorted keys, undefined dropped). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

/** FNV-1a hash of a string, returned as a zero-padded 8-char hex digest. */
export function hashString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
