/**
 * Canonical hashing for Workspace snapshot entries and manifests.
 *
 * @module
 */

import { sha256Hex } from "../../content/sha256";
import type { JsonObject, JsonValue } from "../../storage";

const encoder = new TextEncoder();

/** Hash one canonical snapshot manifest. */
export function snapshotManifestFingerprint(input: {
  readonly id: string;
  readonly workspaceId: string;
  readonly namespace: string;
  readonly path: string;
  readonly createdAt: number;
  readonly entries: readonly {
    readonly path: string;
    readonly fingerprint: string;
  }[];
}): string {
  return hashCanonical({
    format: "workspace-snapshot-manifest:v1",
    id: input.id,
    workspaceId: input.workspaceId,
    namespace: input.namespace,
    path: input.path,
    createdAt: input.createdAt,
    entries: [...input.entries]
      .sort((left, right) => compareText(left.path, right.path))
      .map((entry) => [entry.path, entry.fingerprint]),
  });
}

/** Return stable JSON with recursively sorted object keys. */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (isJsonArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(",")}}`;
}

/** Deep-copy a JSON value while sorting every object key. */
export function canonicalizeJson(value: JsonObject): JsonObject;
export function canonicalizeJson(value: JsonValue): JsonValue;
export function canonicalizeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (isJsonArray(value)) return value.map(canonicalizeJson);
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    const child = value[key];
    if (child !== undefined) result[key] = canonicalizeJson(child);
  }
  return result;
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/** Hash a JSON-compatible value through the canonical serializer. */
export function hashCanonical(value: JsonValue): string {
  return sha256Hex(encoder.encode(canonicalJson(value)));
}

/** Hash exact UTF-8 text content. */
export function hashText(value: string): string {
  return sha256Hex(encoder.encode(value));
}

/** Hash exact binary content. */
export function hashBytes(value: Uint8Array): string {
  return sha256Hex(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
