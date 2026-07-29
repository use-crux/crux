import { parseStrictWireJson } from "@/shared/services/strict-wire-json";

const MAX_DEPTH = 32;
const MAX_NODES = 10_000;
const MAX_KEYS = 5_000;
const MAX_KEY_BYTES = 256;
const MAX_STRING_BYTES = 65_536;
const MAX_WEIGHT = 131_072;
const MAX_RAW_BYTES = 300 * 1024;

const utf8 = new TextEncoder();

/** Parse authoritative raw text with the same structural bounds as Local. */
export function parsePromptPreviewRaw(
  text: string,
): Readonly<Record<string, unknown>> | undefined {
  try {
    const value = parseStrictWireJson(text, MAX_RAW_BYTES);
    if (!isJsonObject(value)) return undefined;
    validateJsonObject(value);
    return value;
  } catch {
    return undefined;
  }
}

/**
 * Serialize form edits without handing an object to `JSON.stringify`, whose
 * integer-index ordering would violate the canonical UTF-16 key order.
 */
export function canonicalPrettyPromptPreviewJson(
  value: Readonly<Record<string, unknown>>,
): string {
  validateJsonObject(value);
  return writeJson(value, 0);
}

/** Encode one validated input object with canonical compact JSON ordering. */
export function canonicalCompactPromptPreviewJson(
  value: Readonly<Record<string, unknown>>,
): string {
  validateJsonObject(value);
  return writeCompactJson(value);
}

function writeCompactJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(writeCompactJson).join(",")}]`;
  }
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${writeCompactJson(value[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("foreign JSON value");
  return encoded;
}

function writeJson(value: unknown, depth: number): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const indent = "  ".repeat(depth + 1);
    return `[\n${value
      .map((item) => `${indent}${writeJson(item, depth + 1)}`)
      .join(",\n")}\n${"  ".repeat(depth)}]`;
  }
  if (isJsonObject(value)) {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) return "{}";
    const indent = "  ".repeat(depth + 1);
    return `{\n${keys
      .map(
        (key) =>
          `${indent}${JSON.stringify(key)}: ${writeJson(value[key], depth + 1)}`,
      )
      .join(",\n")}\n${"  ".repeat(depth)}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("foreign JSON value");
  return encoded;
}

function validateJsonObject(root: Readonly<Record<string, unknown>>): void {
  const counts = { nodes: 0, keys: 0 };
  visitJson(root, 1, counts);
}

function visitJson(
  value: unknown,
  depth: number,
  counts: { nodes: number; keys: number },
): number {
  counts.nodes += 1;
  if (counts.nodes > MAX_NODES) throw new Error("too many JSON nodes");
  if (value === null) return 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("nonfinite JSON number");
    return 8;
  }
  if (typeof value === "string") {
    validateScalarString(value);
    const bytes = utf8.encode(value).byteLength;
    if (bytes > MAX_STRING_BYTES) throw new Error("JSON string too large");
    return bytes;
  }
  if (Array.isArray(value)) {
    if (depth > MAX_DEPTH) throw new Error("JSON too deep");
    let weight = 2 + Math.max(0, value.length - 1);
    for (const child of value) {
      weight += visitJson(
        child,
        isContainer(child) ? depth + 1 : depth,
        counts,
      );
      if (weight > MAX_WEIGHT) throw new Error("JSON too heavy");
    }
    return weight;
  }
  if (isJsonObject(value)) {
    if (depth > MAX_DEPTH) throw new Error("JSON too deep");
    const keys = Object.keys(value);
    counts.keys += keys.length;
    if (counts.keys > MAX_KEYS) throw new Error("too many JSON keys");
    let weight = 2 + Math.max(0, keys.length - 1);
    for (const key of keys) {
      validateScalarString(key);
      const keyBytes = utf8.encode(key).byteLength;
      if (keyBytes > MAX_KEY_BYTES) throw new Error("JSON key too large");
      weight +=
        keyBytes +
        1 +
        visitJson(
          value[key],
          isContainer(value[key]) ? depth + 1 : depth,
          counts,
        );
      if (weight > MAX_WEIGHT) throw new Error("JSON too heavy");
    }
    return weight;
  }
  throw new Error("foreign JSON value");
}

function validateScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) {
        throw new Error("unpaired high surrogate");
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error("unpaired low surrogate");
    }
  }
}

function isJsonObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContainer(value: unknown): boolean {
  return Array.isArray(value) || isJsonObject(value);
}
