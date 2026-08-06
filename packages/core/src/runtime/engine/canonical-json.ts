/** Shared Runtime canonical JSON serializer for durable digests and comparisons. */

import type { JsonValue } from "../../storage";

/**
 * Encode a JSON value with Runtime persistence semantics.
 *
 * @remarks Object keys are sorted recursively. Undefined object members are
 * omitted. `-0` serializes as JSON `0`. Arrays preserve order. Valid
 * `JsonValue` leaves use `JSON.stringify` for string/number/boolean/null.
 * @internal
 */
export function canonicalRuntimeJson(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalRuntimeJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, JsonValue | undefined>>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalRuntimeJson(record[key]!)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
