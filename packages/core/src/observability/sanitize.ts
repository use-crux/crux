import type { CruxGraphRecord } from './contract'

const MAX_PREVIEW_STRING_LENGTH = 64_000
const MAX_PREVIEW_ARRAY_LENGTH = 200
const MAX_PREVIEW_OBJECT_KEYS = 200
const MAX_PREVIEW_DEPTH = 8

/**
 * Converts arbitrary observability payload values into JSON-safe data.
 *
 * Observability runs on user-code paths, so unsupported JSON values are
 * represented instead of thrown. This function is intentionally shared by the
 * emit pipeline so subscribers, diagnostics channel listeners, and transports
 * all observe the same sanitized record shape.
 */
export function toJsonSafe(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'string' && value.length > MAX_PREVIEW_STRING_LENGTH) {
      return `${value.slice(0, MAX_PREVIEW_STRING_LENGTH)}...[truncated ${value.length - MAX_PREVIEW_STRING_LENGTH} chars]`
    }
    if (typeof value === 'number' && !Number.isFinite(value)) return String(value)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined') return null
  if (typeof value === 'function') return `[Function${value.name ? `: ${value.name}` : ''}]`
  if (typeof value === 'symbol') return String(value)

  if (depth >= MAX_PREVIEW_DEPTH) return '[MaxDepth]'

  if (value instanceof Date) return value.toISOString()

  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    try {
      if (Array.isArray(value)) {
        const items = value.slice(0, MAX_PREVIEW_ARRAY_LENGTH).map((item) => toJsonSafe(item, seen, depth + 1))
        if (value.length > MAX_PREVIEW_ARRAY_LENGTH) {
          items.push(`...[truncated ${value.length - MAX_PREVIEW_ARRAY_LENGTH} items]`)
        }
        return items
      }

      const output: Record<string, unknown> = {}
      const entries = Object.entries(value as Record<string, unknown>)
      for (const [key, entryValue] of entries.slice(0, MAX_PREVIEW_OBJECT_KEYS)) {
        output[key] = toJsonSafe(entryValue, seen, depth + 1)
      }
      if (entries.length > MAX_PREVIEW_OBJECT_KEYS) {
        output.__crux_truncated_keys = entries.length - MAX_PREVIEW_OBJECT_KEYS
      }
      return output
    } finally {
      seen.delete(value)
    }
  }

  return String(value)
}

/** Returns a JSON-safe copy of a graph record before it leaves the SDK. */
export function sanitizeRecord(record: CruxGraphRecord): unknown {
  return toJsonSafe(record)
}
