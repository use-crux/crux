import { sha256Hex } from "./sha256";

/** Create a SHA-256 fingerprint over canonical, key-sorted JSON. */
export function canonicalFingerprint(value: unknown): string {
  return `sha256:${sha256Hex(new TextEncoder().encode(canonicalJson(value)))}`;
}

/** Serialize JSON-compatible input independently of object insertion order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError("Cannot fingerprint a non-JSON value.");
    }
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
