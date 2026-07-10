/** True when a value is a non-array object record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Return a trimmed non-empty string, if present. */
export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

/** Convert an unknown prompt input into the record shape Crux resolution expects. */
export function toInputRecord(input: unknown): Record<string, unknown> {
  return isRecord(input) ? input : {}
}

/** True when a callback can handle a Convex Agent stream finish result. */
export function isFinishCallback(value: unknown): value is (result: unknown) => unknown | Promise<unknown> {
  return typeof value === 'function'
}
