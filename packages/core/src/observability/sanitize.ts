import type { CruxGraphRecord } from './contract'

/** Shared bounds for sanitization and pre-sanitization privacy traversal. */
export const OBSERVABILITY_SANITIZE_LIMITS = Object.freeze({
  stringLength: 64_000,
  arrayLength: 200,
  objectKeys: 200,
  depth: 8,
})

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
    if (typeof value === 'string' && value.length > OBSERVABILITY_SANITIZE_LIMITS.stringLength) {
      return `${value.slice(0, OBSERVABILITY_SANITIZE_LIMITS.stringLength)}...[truncated ${value.length - OBSERVABILITY_SANITIZE_LIMITS.stringLength} chars]`
    }
    if (typeof value === 'number' && !Number.isFinite(value)) return String(value)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined') return null
  if (typeof value === 'function') return `[Function${value.name ? `: ${value.name}` : ''}]`
  if (typeof value === 'symbol') return String(value)

  if (depth >= OBSERVABILITY_SANITIZE_LIMITS.depth) return '[MaxDepth]'

  if (value instanceof Date) return value.toISOString()

  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    try {
      if (Array.isArray(value)) {
        const items = value
          .slice(0, OBSERVABILITY_SANITIZE_LIMITS.arrayLength)
          .map((item) => toJsonSafe(item, seen, depth + 1))
        if (value.length > OBSERVABILITY_SANITIZE_LIMITS.arrayLength) {
          items.push(`...[truncated ${value.length - OBSERVABILITY_SANITIZE_LIMITS.arrayLength} items]`)
        }
        return items
      }

      const output: Record<string, unknown> = {}
      const entries = Object.entries(value as Record<string, unknown>)
      for (const [key, entryValue] of entries.slice(0, OBSERVABILITY_SANITIZE_LIMITS.objectKeys)) {
        output[key] = toJsonSafe(entryValue, seen, depth + 1)
      }
      if (entries.length > OBSERVABILITY_SANITIZE_LIMITS.objectKeys) {
        output.__crux_truncated_keys = entries.length - OBSERVABILITY_SANITIZE_LIMITS.objectKeys
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
