/**
 * Canonical serialization for static Project Index parity checks.
 *
 * Phase 1 only removes object key insertion order from JSON output. Arrays keep
 * their source order because ordering is still part of the static extraction
 * contract until a later shared parity normalizer declares otherwise.
 *
 * @module
 */

type JsonPrimitive = string | number | boolean | null
type JsonArray = readonly JsonValue[]
type JsonObject = { readonly [key: string]: JsonValue }
type JsonValue = JsonPrimitive | JsonArray | JsonObject

/**
 * Serializes static parity payloads with deterministic object key ordering.
 *
 * This is intentionally conservative: it does not drop fields, normalize values,
 * or sort arrays. Unknown fields remain in the payload and therefore still cause
 * parity failures when their values differ.
 *
 * @param value - Static extraction data to serialize.
 * @returns JSON with stable object key ordering.
 */
export function canonicalStaticJson(value: unknown): string {
  return JSON.stringify(sortObjectKeys(toJsonValue(value)))
}

function sortObjectKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortObjectKeys)
  if (value === null || typeof value !== 'object') return value

  const object = value as JsonObject
  const sorted: Record<string, JsonValue> = {}
  for (const key of Object.keys(object).sort()) {
    sorted[key] = sortObjectKeys(object[key])
  }
  return sorted
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null
  if (Array.isArray(value)) return value.map(toJsonValue)

  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return value
    case 'object': {
      const record = value as Record<string, unknown>
      const object: Record<string, JsonValue> = {}
      for (const key of Object.keys(record)) {
        const child = record[key]
        if (child !== undefined) object[key] = toJsonValue(child)
      }
      return object
    }
    default:
      return null
  }
}
