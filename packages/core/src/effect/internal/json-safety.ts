/**
 * JSON-safety probe for retained recovery state.
 *
 * @internal
 * @module
 */

/** Report whether a value is finite JSON data without cycles. */
export function isEffectJsonSafe(value: unknown): boolean {
  return isJsonValue(value, new WeakSet<object>());
}

function isJsonValue(
  value: unknown,
  ancestors: WeakSet<object>,
): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (typeof value !== "object") return false;

  const prototype = Object.getPrototypeOf(value);
  if (
    (!Array.isArray(value) &&
      prototype !== Object.prototype &&
      prototype !== null) ||
    ancestors.has(value)
  ) {
    return false;
  }

  ancestors.add(value);
  try {
    const entries = Array.isArray(value) ? value : Object.values(value);
    return entries.every(
      (entry) =>
        entry !== undefined && isJsonValue(entry, ancestors),
    );
  } finally {
    ancestors.delete(value);
  }
}
