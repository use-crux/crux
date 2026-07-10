import type { JsonObject, JsonValue } from "../types/tool";

/** Return whether a value is a strict JSON object accepted by private codecs. */
export function isPrivateJsonObject(value: unknown): value is JsonObject {
  return isPlainRecord(value) && Object.values(value).every(isPrivateJsonValue);
}

/** Clone a JSON object while dropping no valid fields. */
export function clonePrivateJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function isPrivateJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isPrivateJsonValue);
  return isPlainRecord(value) && Object.values(value).every(isPrivateJsonValue);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
