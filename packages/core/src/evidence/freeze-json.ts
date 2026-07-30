/**
 * Detached immutable copies of retained evidence JSON.
 *
 * @internal
 * @module
 */

import type { JsonValue } from "../storage";

/** Clone and recursively freeze one already-validated JSON value. */
export function cloneAndFreezeEvidenceJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneAndFreezeEvidenceJson));
  }
  if (value !== null && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          item === undefined
            ? undefined
            : cloneAndFreezeEvidenceJson(item),
        ]),
      ),
    );
  }
  return value;
}
