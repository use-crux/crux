/**
 * Shared redaction primitives for safety, validation feedback, and quality
 * snapshots.
 *
 * These helpers are intentionally conservative and dependency-free. They are
 * not anonymization; they remove common secrets and high-risk identifiers from
 * previews and persisted snapshots before they cross observability or model
 * feedback boundaries.
 *
 * @module
 */

/** Replacement string for structurally redacted values. */
export const REDACTED = '[redacted]'

/** Key names that are always redacted at every object depth. */
export const SENSITIVE_KEY_PATTERN = /^(authorization|proxy[-_]?authorization|api[-_]?key|x[-_]?api[-_]?key|token|secret)$/i

/** Redact common sensitive text patterns from a preview string. */
export function redactSensitiveText(content: string): string {
  return content
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{1,}/gi, '[redacted-email]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[redacted-ssn]')
    .replace(/\b(?:sk|pk|rk|key|token)-[A-Za-z0-9_-]{3,}\b/g, '[redacted-secret]')
    .replace(/\b(?:authorization|proxy-authorization)\s*[:=]\s*bearer\s+[A-Za-z0-9._~+/=-]+\b/gi, '[redacted-authorization]')
}

/** Recursively redact sensitive keys from JSON-like values. */
export function redactSensitiveValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSensitiveText(value)
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item))
  if (!isRecord(value)) return value

  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactSensitiveValue(entry)
  }
  return output
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}
