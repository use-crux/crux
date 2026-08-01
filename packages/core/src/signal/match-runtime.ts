/** Runtime matching for canonical Signal match data. */

import type { JsonValue } from "../storage";

/** Apply recursive partial-object and exact array/scalar Signal matching. */
export function matchesSignalData(
  match: JsonValue,
  payload: JsonValue,
): boolean {
  if (Array.isArray(match)) {
    return (
      Array.isArray(payload) &&
      match.length === payload.length &&
      match.every((value, index) => matchesSignalData(value, payload[index]!))
    );
  }
  if (isJsonRecord(match)) {
    if (!isJsonRecord(payload)) return false;
    return Object.entries(match).every(
      ([key, value]) =>
        value !== undefined &&
        Object.hasOwn(payload, key) &&
        matchesSignalData(value, payload[key]!),
    );
  }
  return Object.is(match, payload);
}

function isJsonRecord(
  value: JsonValue,
): value is { readonly [key: string]: JsonValue | undefined } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
