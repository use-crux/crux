/**
 * Deterministic JSON helpers for private Signal state.
 *
 * @internal
 * @module
 */

import type { JsonValue } from "../storage/types";
import { cloneRuntimeJsonValue } from "../runtime/engine/json-value";
import { createRuntimeError } from "../runtime/engine/errors";

/** Clone one Signal value while keeping JSON errors payload-safe. */
export function cloneSignalJson<T extends JsonValue>(
  value: T,
  subject: "match" | "normalized output",
): T {
  try {
    return cloneRuntimeJsonValue(value, "signal value");
  } catch {
    return signalPayloadNotJson(subject);
  }
}

/** Rebuild JSON with recursively sorted object keys and stable array order. */
export function canonicalizeSignalJson<T extends JsonValue>(
  value: T,
  subject: "match" | "normalized output",
): T {
  try {
    return canonicalizeSignalJsonValue(value) as T;
  } catch {
    return signalPayloadNotJson(subject);
  }
}

/** Encode validated JSON with recursively sorted object keys. */
export function canonicalSignalJson(value: JsonValue): string {
  try {
    return encodeCanonicalSignalJson(value);
  } catch {
    return signalPayloadNotJson("normalized output");
  }
}

function encodeCanonicalSignalJson(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(encodeCanonicalSignalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<
      Record<string, JsonValue | undefined>
    >;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${encodeCanonicalSignalJson(record[key]!)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Recursively freeze a detached, validated Signal JSON value. */
export function freezeSignalJson<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    for (const child of value) freezeSignalJson(child);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      if (child !== undefined) freezeSignalJson(child);
    }
    return Object.freeze(value);
  }
  return value;
}

function canonicalizeSignalJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(canonicalizeSignalJsonValue);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<
      Record<string, JsonValue | undefined>
    >;
    const canonical: Record<string, JsonValue> = {};
    for (const key of Object.keys(record).sort()) {
      canonical[key] = canonicalizeSignalJsonValue(record[key]!);
    }
    return canonical;
  }
  return value;
}

function signalPayloadNotJson(
  subject: "match" | "normalized output",
): never {
  throw createRuntimeError({
    code: "PAYLOAD_NOT_JSON",
    whatFailed: `Signal ${subject} is not JSON-serializable.`,
    why: "Signal values must contain only finite, acyclic plain JSON data.",
    whatStillWorks: "Signals with JSON-safe values can still be published.",
    nextStep:
      "Normalize dates and class instances to plain JSON, and remove functions, non-finite numbers, and cycles.",
  });
}
