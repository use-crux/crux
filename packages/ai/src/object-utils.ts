/** Return a string property from a record-like value. */
export function readString(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const property = value?.[key]
  return typeof property === 'string' ? property : undefined
}

/** Narrow unknown input to a non-array object record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
